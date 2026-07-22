/**
 * Hanwha e-Sales dispatch scraper.
 *
 * Keeps the existing return shape used by dispatch/actions.ts:
 * destination row -> line rows -> material/quantity/rawCells.
 */
import path from 'path';
import { chromium, type Page } from 'playwright';
import { markHanwhaDispatchCompletionStatus } from '@/lib/hanwha-dispatch';
import { installPlaywrightEvaluateNameShim } from '@/lib/playwright-evaluate-shim';

export interface ScrapedLine {
    materialNameRaw: string | null;
    materialName: string | null;
    quantityKg: number | null;
    rawCells: string[];
}

export interface ScrapedIndoChi {
    indoChiIndex: number;
    indoChiName: string;
    lines: ScrapedLine[];
}

export type ScrapeErrorCode = 'AUTH_FAILED' | 'TIMEOUT' | 'NO_DATE_INPUT' | 'UNKNOWN' | 'NO_CREDENTIALS';

export interface ScrapeResult {
    ok: boolean;
    rows: ScrapedIndoChi[];
    error?: string;
    errorCode?: ScrapeErrorCode;
}

export interface ScrapeOptions {
    username?: string | null;
    password?: string | null;
}

const ESALES_LOGIN_URL = 'https://esales.hanwhasolutions.com/esplus/resources/login.html';
const REMOTE_DEBUGGING_PORT = 9224;
const dialogHandlerPages = new WeakSet<Page>();

type AcquiredESalesPage = {
    page: Page;
};

function chromePath() {
    return process.env.CHROME_PATH?.trim() || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
}

function controlledProfileDir() {
    return path.join(process.cwd(), 'tmp', 'hanwha-esales-controlled-profile');
}

function controlledChromeLogFile() {
    return path.join(process.cwd(), 'tmp', 'hanwha-esales-chrome.log');
}

function controlledChromeLauncher() {
    return path.join(process.cwd(), 'scripts', 'launch-hanwha-controlled-chrome.cjs');
}

function isExpiredESalesPageUrl(url: string) {
    return /session(?:30)?out/i.test(url);
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isoToYmd(isoDate: string) {
    return isoDate.replace(/\D/g, '');
}

function convertMaterialName(name: string): string {
    if (!name) return name;
    let s = name.trim();
    if (s.startsWith('MF_')) s = s.slice(3);
    s = s.replace(/_/g, ' ');
    const map: Record<string, string> = {
        LD: 'LDPE',
        LLD: 'LLDPE',
        MLLD: 'mLLDPE',
        HD: 'HDPE',
        EVA: 'EVA',
    };
    const parts = s.split(/\s+/);
    const family = map[parts[0]?.toUpperCase()];
    if (family && parts[1]) return `${family}<${parts[1]}>`;
    return s;
}

function parseQuantityKg(value: string | null | undefined) {
    const raw = (value ?? '').replace(/,/g, '').trim();
    if (!raw || !/^-?\d+(\.\d+)?$/.test(raw)) return null;
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : null;
}

function findColumnIndex(headers: string[], patterns: RegExp[], fallback = -1) {
    const index = headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
    return index >= 0 ? index : fallback;
}

async function launchControlledChrome() {
    const { spawn } = await import('child_process');
    const child = spawn(process.execPath, [controlledChromeLauncher()], {
        detached: false,
        stdio: 'ignore',
        windowsHide: true,
        env: {
            ...process.env,
            CHROME_PATH: chromePath(),
            HANWHA_ESALES_CDP_PORT: String(REMOTE_DEBUGGING_PORT),
            HANWHA_ESALES_PROFILE_DIR: controlledProfileDir(),
            HANWHA_ESALES_LOGIN_URL: ESALES_LOGIN_URL,
            CHROME_LOG_FILE: controlledChromeLogFile(),
        },
    });
    child.unref();
}

async function waitForCdp() {
    const endpoint = `http://127.0.0.1:${REMOTE_DEBUGGING_PORT}/json/version`;
    for (let i = 0; i < 40; i += 1) {
        try {
            const response = await fetch(endpoint);
            if (response.ok) return;
        } catch {
            // Chrome is still starting.
        }
        await sleep(250);
    }
    throw new Error('Chrome remote debugging endpoint did not start.');
}

async function isCdpOpen() {
    try {
        const response = await fetch(`http://127.0.0.1:${REMOTE_DEBUGGING_PORT}/json/version`);
        return response.ok;
    } catch {
        return false;
    }
}

async function connectToControlledChrome() {
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt += 1) {
        if (!await isCdpOpen()) {
            await launchControlledChrome();
        }
        await waitForCdp();
        try {
            return await chromium.connectOverCDP(
                `http://127.0.0.1:${REMOTE_DEBUGGING_PORT}`,
                { timeout: 30_000 },
            );
        } catch (error) {
            lastError = error;
            if (attempt === 0) await sleep(1000);
        }
    }

    throw lastError instanceof Error
        ? lastError
        : new Error('한화 e-Sales Chrome 연결에 실패했습니다.');
}

async function hasLoggedInESalesShell(page: Page) {
    return page.evaluate(() => {
        function exposed(el: Element | null): el is HTMLElement {
            if (!el || !(el instanceof HTMLElement)) return false;
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            if (
                rect.width <= 0
                || rect.height <= 0
                || style.display === 'none'
                || style.visibility === 'hidden'
                || rect.right <= 0
                || rect.bottom <= 0
                || rect.left >= innerWidth
                || rect.top >= innerHeight
            ) return false;
            const x = Math.min(innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
            const y = Math.min(innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
            const top = document.elementFromPoint(x, y);
            return Boolean(top && (top === el || el.contains(top) || top.contains(el)));
        }
        function textOf(el: Element | null) {
            return (el?.textContent || '').replace(/\s+/g, ' ').trim();
        }
        const shellSelectors = [
            'div[id*="frameLeft.form.divLeft.form.grdTree"]',
            'div[id*="frameNavi.form.divTab"]',
            'div[id*="POP_ORDER_REG"]',
            'div[id*="ESD_PARTNER_INFO_V"]',
            'div[id*="ESD_SALES_ITEM_V"]',
        ];
        if (shellSelectors.some((selector) => Array.from(document.querySelectorAll(selector)).some(exposed))) {
            return true;
        }
        if (exposed(document.querySelector('input[id*="frameLogin"][id*="edtId"]'))) return false;
        const visibleText = Array.from(document.querySelectorAll('div,button,[role="button"],[role="treeitem"]'))
            .filter(exposed)
            .map(textOf)
            .join(' ');
        if (
            visibleText.includes('주문입력(대리점)')
            || visibleText.includes('주문 진행 조회')
            || visibleText.includes('배차 조회')
            || visibleText.includes('대리점오더 등록')
            || visibleText.includes('입차예정일')
            || visibleText.includes('Header 정보')
            || visibleText.includes('Line 정보')
        ) return true;
        return Array.from(document.querySelectorAll([
            'div[id*="POP_ORDER_REG"]',
            'div[id*="ESD_PARTNER_INFO_V"]',
            'div[id*="ESD_SALES_ITEM_V"]',
        ].join(','))).some(exposed);
    }).catch(() => false);
}

async function getDispatchESalesPage(): Promise<AcquiredESalesPage> {
    const cdpWasOpen = await isCdpOpen();
    if (!cdpWasOpen) {
        await launchControlledChrome();
    }
    const browser = await connectToControlledChrome();
    const context = browser.contexts()[0] ?? await browser.newContext();

    const esalesPages = context.pages().filter((candidate) => candidate.url().includes('esales.hanwhasolutions.com'));
    for (const candidate of esalesPages) {
        await installPlaywrightEvaluateNameShim(candidate);
        if (!await hasLoggedInESalesShell(candidate)) continue;
        registerDialogHandler(candidate);
        await candidate.bringToFront().catch(() => undefined);
        await candidate.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined);
        return { page: candidate };
    }

    // When the controlled Chrome was lost, Chrome has already opened one tab.
    // Reuse that tab for recovery instead of creating another e-Sales tab.
    const existingESalesPage = esalesPages.find((candidate) => candidate.url().includes('/login.html'))
        ?? esalesPages[0]
        ?? context.pages()[0];
    const page = existingESalesPage ?? await context.newPage();
    await installPlaywrightEvaluateNameShim(page);
    registerDialogHandler(page);
    if (!existingESalesPage || !cdpWasOpen || isExpiredESalesPageUrl(page.url())) {
        // A newly launched Chrome reports CDP before Nexacro has rendered.
        // Put the same existing tab on the login page before searching controls.
        await page.goto(ESALES_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    }
    await page.waitForLoadState('domcontentloaded', { timeout: 60_000 }).catch(() => undefined);
    await page.bringToFront();
    return { page };
}

function registerDialogHandler(page: Page) {
    if (dialogHandlerPages.has(page)) return;
    dialogHandlerPages.add(page);
    page.on('dialog', async (dialog) => {
        try {
            await dialog.accept();
        } catch {
            // Nexacro dialogs may already be gone by the time Playwright responds.
        }
    });
}

async function clickNexacro(page: Page, selector: string, timeoutMs = 20_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const target = await page.evaluate((selector) => {
            function visible(el: Element | null): el is HTMLElement {
                if (!el || !(el instanceof HTMLElement) || el.offsetParent === null) return false;
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            }
            const el = Array.from(document.querySelectorAll(selector)).find(visible) as HTMLElement | undefined;
            if (!el) return null;
            const host = el.id.includes(':icontext')
                ? document.getElementById(el.id.replace(':icontext', ''))
                : el;
            const target = visible(host) ? host : el;
            const rect = target.getBoundingClientRect();
            return {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2,
            };
        }, selector);
        if (target) {
            await page.mouse.move(target.x, target.y);
            await page.mouse.down();
            await page.mouse.up();
            await page.waitForTimeout(300);
            return;
        }
        await page.waitForTimeout(300);
    }
    throw new Error(`e-Sales element not found: ${selector}`);
}

async function focusNexacroWindowTab(page: Page, windowCode: string) {
    await clickNexacro(page, `div[id*="frameNavi.form.divTab.form.TAB_${windowCode}"]`, 2_000)
        .catch(() => undefined);
    await page.waitForTimeout(200);
}

async function closeVisibleESalesPopups(page: Page) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const clicked = await page.evaluate(() => {
            function visible(el: Element | null): el is HTMLElement {
                if (!el || !(el instanceof HTMLElement) || el.offsetParent === null) return false;
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            }
            function fireMouse(el: HTMLElement) {
                for (const type of ['mouseover', 'mousemove', 'mousedown', 'mouseup', 'click']) {
                    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
                }
            }
            function clickElement(el: HTMLElement) {
                const linked = (el as HTMLElement & { _linked_element?: { linkedcontrol?: { click?: () => void } } })._linked_element;
                const comp = linked?.linkedcontrol;
                const click = comp?.click;
                if (typeof click === 'function') click.call(comp);
                else fireMouse(el);
            }
            function popupRoot(el: Element) {
                return el.closest('div[id*="POP_"], div[id*="ESD_PARTNER_INFO_V"], div[id*="ESD_SALES_ITEM_V"]') as HTMLElement | null;
            }
            const closeButton = Array.from(document.querySelectorAll('div,button,[role="button"]'))
                .find((el): el is HTMLElement => {
                    if (!visible(el)) return false;
                    const root = popupRoot(el);
                    if (!root || !visible(root)) return false;
                    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
                    const id = el.id.toLowerCase();
                    return id.includes('closebutton') || id.endsWith('form.btnclose') || text === '닫기';
                });
            if (!closeButton) return false;
            clickElement(closeButton);
            return true;
        });
        if (!clicked) return;
        await page.waitForTimeout(500);
    }
}

async function clickVisibleNexacroOk(page: Page, timeoutMs = 1_500) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const target = await page.evaluate(() => {
            function visible(el: Element | null): el is HTMLElement {
                if (!el || !(el instanceof HTMLElement)) return false;
                const rect = el.getBoundingClientRect();
                const style = getComputedStyle(el);
                return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
            }
            const buttons = Array.from(document.querySelectorAll([
                'div[id*="comCONFIRM"][id$="form.divBtnConfirm.form.btnOk"]',
                'div[id*="comALERT"][id$="form.divBtnAlert.form.btnOk"]',
                'div[id*="comALERT"][id$="form.divBtnConfirm.form.btnOk"]',
                'div[id$="form.divBtnConfirm.form.btnOk"]',
                'div[id$="form.divBtnAlert.form.btnOk"]',
            ].join(',')))
                .filter((el): el is HTMLElement => visible(el))
                .map((el) => {
                    const rect = el.getBoundingClientRect();
                    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, left: rect.left };
                })
                .sort((a, b) => b.left - a.left);
            return buttons[0] ?? null;
        });
        if (target) {
            await page.mouse.click(target.x, target.y, { delay: 80 });
            await page.waitForTimeout(500);
            return true;
        }
        await page.waitForTimeout(200);
    }
    return false;
}

async function closeAllNexacroWorkTabs(page: Page) {
    await page.bringToFront().catch(() => undefined);
    await closeVisibleESalesPopups(page);

    for (let attempt = 0; attempt < 20; attempt += 1) {
        const target = await page.evaluate(() => {
            function visible(el: Element | null): el is HTMLElement {
                if (!el || !(el instanceof HTMLElement)) return false;
                const rect = el.getBoundingClientRect();
                const style = getComputedStyle(el);
                return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
            }
            const buttons = Array.from(document.querySelectorAll('div[id*="frameNavi.form.divTab.form.EXTRA_TAB_"]'))
                .filter((el): el is HTMLElement => visible(el) && !el.id.includes(':icontext'))
                .map((el) => {
                    const rect = el.getBoundingClientRect();
                    return {
                        x: rect.left + rect.width / 2,
                        y: rect.top + rect.height / 2,
                        left: rect.left,
                    };
                })
                .sort((a, b) => b.left - a.left);
            return buttons[0] ?? null;
        });
        if (!target) break;
        await page.mouse.click(target.x, target.y, { delay: 80 });
        await page.waitForTimeout(500);
        await clickVisibleNexacroOk(page);
    }

    await closeVisibleESalesPopups(page);
}

async function clickByText(page: Page, texts: string[], timeoutMs = 20_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const clicked = await page.evaluate((texts) => {
            function visible(el: Element | null): el is HTMLElement {
                return !!el && el instanceof HTMLElement && el.offsetParent !== null;
            }
            function textOf(el: Element | null) {
                return (el?.textContent || '').replace(/\s+/g, ' ').trim();
            }
            function fireMouse(el: HTMLElement) {
                for (const type of ['mouseover', 'mousemove', 'mousedown', 'mouseup', 'click']) {
                    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
                }
            }
            const candidates = Array.from(document.querySelectorAll('div,button,[role="button"],[role="treeitem"]'))
                .filter(visible) as HTMLElement[];
            const el = candidates.find((candidate) => texts.some((text) => textOf(candidate) === text || textOf(candidate).includes(text)));
            if (!el) return false;
            const comp = (el as HTMLElement & { _linked_element?: { linkedcontrol?: { click?: () => void } } })._linked_element?.linkedcontrol;
            if (typeof comp?.click === 'function') {
                comp.click();
                return true;
            }
            fireMouse(el);
            return true;
        }, texts);
        if (clicked) return;
        await page.waitForTimeout(300);
    }
    throw new Error(`${texts.join(', ')} 메뉴/버튼을 찾지 못했습니다.`);
}

async function hasVisibleSelector(page: Page, selector: string) {
    return page.evaluate((selector) => {
        return Array.from(document.querySelectorAll(selector))
            .some((el) => el instanceof HTMLElement && el.offsetParent !== null);
    }, selector).catch(() => false);
}

async function fillInput(page: Page, selector: string, value: string) {
    await page.waitForSelector(selector, { state: 'visible', timeout: 20_000 });
    const locator = page.locator(selector).first();
    await locator.click({ force: true });
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText(value);
    await page.waitForTimeout(150);
    if (await locator.inputValue().catch(() => '') !== value) {
        await locator.fill(value, { force: true }).catch(() => undefined);
    }
    if (await locator.inputValue().catch(() => '') !== value) {
        await page.evaluate(({ selector, value }) => {
            const input = document.querySelector(selector) as HTMLInputElement | null;
            if (!input) return;
            const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            valueSetter?.call(input, value);
            input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }, { selector, value });
    }
}

async function clickLoginButton(page: Page) {
    await clickNexacro(page, [
        'div[id$="frameLogin.form.divLogin.form.btnLogin"]',
        'div[id*="frameLogin"][id*="btnLogin"]',
        'div[id$="btnLogin"]',
        'div[id*="btnLogin"]',
    ].join(','), 5_000).catch(async (error) => {
        if (await hasLoggedInESalesShell(page)) return;
        await clickByText(page, ['로그인'], 5_000).catch(() => {
            throw error;
        });
    });
}

async function waitForDispatchLoginState(page: Page, userSelectors: string[], forceLogin = false) {
    // Nexacro completes its DOM work after domcontentloaded. A fresh browser
    // can otherwise be mistaken for a missing login screen before it renders.
    for (let attempt = 0; attempt < 120; attempt += 1) {
        if (!forceLogin && await hasLoggedInESalesShell(page)) return { state: 'ACTIVE' as const };
        const otpVisible = await page.locator('div[id$="frm_LoginOTP.form.btnSendOTP"]').first().isVisible().catch(() => false);
        if (otpVisible) return { state: 'OTP' as const };
        for (const selector of userSelectors) {
            if (await hasVisibleSelector(page, selector)) return { state: 'LOGIN' as const };
        }
        await page.waitForTimeout(250);
    }
    throw new Error('Hanwha e-Sales login screen did not become ready.');
}

async function loginAndSendOtpIfNeeded(page: Page, username: string, password: string, forceLogin = false) {

    const userSelectors = [
        'input[id$="frameLogin.form.divLogin.form.edtId:input"]',
        'input[id*="frameLogin"][id*="edtId"][id$=":input"]',
        'input[id*="edtId"][id$=":input"]',
    ];
    const passwordSelectors = [
        'input[id$="frameLogin.form.divLogin.form.edtPw:input"]',
        'input[id*="frameLogin"][id*="edtPw"][id$=":input"]',
        'input[id*="edtPw"][id$=":input"]',
    ];
    const initialState = await waitForDispatchLoginState(page, userSelectors, forceLogin);
    if (initialState.state === 'ACTIVE') return false;
    if (initialState.state === 'OTP') return true;
    const userSelector = await (async () => {
        for (const selector of userSelectors) {
            if (await hasVisibleSelector(page, selector)) return selector;
        }
        return null;
    })();
    if (!userSelector) throw new Error('한화 e-Sales 로그인 화면을 찾지 못했습니다.');
    const passwordSelector = await (async () => {
        for (const selector of passwordSelectors) {
            if (await hasVisibleSelector(page, selector)) return selector;
        }
        return null;
    })();
    if (!passwordSelector) throw new Error('비밀번호 입력란을 찾지 못했습니다.');

    await fillInput(page, userSelector, username);
    await fillInput(page, passwordSelector, password);
    await clickLoginButton(page);
    await page.waitForTimeout(1500);
    await clickNexacro(page, 'div[id$="POP_LOGIN_OTP_NOTI.form.btnClose"]', 4000).catch(() => undefined);
    await page.waitForTimeout(800);
    for (let attempt = 0; attempt < 40; attempt += 1) {
        if (!forceLogin && await hasLoggedInESalesShell(page)) return false;
        if (await page.locator('div[id$="frm_LoginOTP.form.btnSendOTP"]').first().isVisible().catch(() => false)) {
            await clickNexacro(page, 'div[id$="frm_LoginOTP.form.btnSendOTP"]');
            return true;
        }
        await page.waitForTimeout(250);
    }
    return false;
}

async function forceDispatchLogin(page: Page, username: string, password: string) {
    // A Nexacro shell can retain a client-side countdown after the server
    // session has died. This path is used only after its navigation menu is
    // missing, so clearing the dedicated controlled profile is intentional.
    await page.context().clearCookies().catch(() => undefined);
    await page.evaluate(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
    }).catch(() => undefined);
    await page.goto(ESALES_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(800);
    return loginAndSendOtpIfNeeded(page, username, password, true);
}

async function waitForDispatchMenu(page: Page) {
    for (let attempt = 0; attempt < 61; attempt += 1) {
        const found = await page.evaluate(() => {
            function visible(el: Element | null): el is HTMLElement {
                return !!el && el instanceof HTMLElement && el.offsetParent !== null;
            }
            return Array.from(document.querySelectorAll('div,button,[role="button"],[role="treeitem"]'))
                .filter(visible)
                .some((el) => {
                    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
                    const title = el.getAttribute('title') || '';
                    const aria = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('aria-description') || ''}`;
                    return text.includes('주문 진행 조회')
                        || text.includes('배차 조회')
                        || title.includes('주문 진행 조회')
                        || title.includes('배차 조회')
                        || aria.includes('주문 진행 조회')
                        || aria.includes('배차 조회');
                });
        });
        if (found) return;
        await page.waitForTimeout(3000);
    }
    throw new Error('OTP 인증 후 주문 진행 조회/배차 조회 메뉴가 나타나지 않았습니다.');
}

async function openDispatchProgressPage(page: Page) {
    const alreadyOpen = await page.evaluate(() => {
        function visible(el: Element | null): el is HTMLElement {
            return !!el && el instanceof HTMLElement && el.offsetParent !== null;
        }
        const visibleText = Array.from(document.querySelectorAll('div,span,button,[role="button"]'))
            .filter(visible)
            .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
            .join(' ');
        return visibleText.includes('입차예정일')
            || visibleText.includes('Line 정보')
            || visibleText.includes('Header 정보')
            || Array.from(document.querySelectorAll('div[id*="form.divWork.form.grdMainLine"]')).some(visible);
    }).catch(() => false);
    if (alreadyOpen) return;

    await waitForDispatchMenu(page);
    await clickDispatchProgressMenu(page);
    await page.waitForFunction(() => {
        function visible(el: Element | null): el is HTMLElement {
            return !!el && el instanceof HTMLElement && el.offsetParent !== null;
        }
        const visibleText = Array.from(document.querySelectorAll('div,span,button,[role="button"]'))
            .filter(visible)
            .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
            .join(' ');
        return visibleText.includes('입차예정일')
            || visibleText.includes('Line 정보')
            || visibleText.includes('Header 정보')
            || Array.from(document.querySelectorAll('div[id*="form.divWork.form.grdMainLine"]')).some(visible);
    }, null, { timeout: 20_000 });
}

async function clickDispatchProgressMenu(page: Page) {
    const clicked = await page.evaluate(() => {
        const labels = ['주문 진행 조회', '배차 조회'];
        function visible(el: Element | null): el is HTMLElement {
            return !!el && el instanceof HTMLElement && el.offsetParent !== null;
        }
        function textOf(el: Element | null) {
            if (!el) return '';
            return [
                el.textContent || '',
                el.getAttribute('title') || '',
                el.getAttribute('aria-label') || '',
                el.getAttribute('aria-description') || '',
            ].join(' ').replace(/\s+/g, ' ').trim();
        }
        function fireMouse(el: HTMLElement) {
            for (const type of ['mouseover', 'mousemove', 'mousedown', 'mouseup', 'click']) {
                el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
            }
        }
        const candidates = Array.from(document.querySelectorAll([
            'div[id*="frameLeft.form.divLeft.form.grdTree.body.gridrow_9.cell_9_0"]',
            'div[id*="frameLeft.form.divLeft.form.grdTree"] [role="treeitem"]',
            'div[id*="frameLeft.form.divLeft.form.grdTree"] .treeitemtext',
            'div[id*="frameLeft.form.divLeft.form.grdTree.body.gridrow_"]',
            'div,button,[role="button"],[role="treeitem"],[title],[aria-label],[aria-description]',
        ].join(',')))
            .filter(visible) as HTMLElement[];
        const menu = candidates.find((el) => labels.some((label) => textOf(el) === label))
            ?? candidates.find((el) => labels.some((label) => textOf(el).includes(label)));
        if (!menu) return false;
        const target = menu.closest('div.GridCellControl') as HTMLElement | null
            ?? menu.closest('div[id*="frameLeft.form.divLeft.form.grdTree.body.gridrow_"]') as HTMLElement | null
            ?? menu;
        target.scrollIntoView({ block: 'center', inline: 'nearest' });
        const comp = (target as HTMLElement & { _linked_element?: { linkedcontrol?: { click?: () => void } } })._linked_element?.linkedcontrol;
        if (typeof comp?.click === 'function') comp.click();
        else fireMouse(target);
        return true;
    });
    if (!clicked) throw new Error('주문 진행 조회/배차 조회 메뉴를 클릭하지 못했습니다.');
}

async function isDispatchProgressPageFast(page: Page) {
    return page.evaluate(() => {
        function visible(el: Element | null): el is HTMLElement {
            return !!el && el instanceof HTMLElement && el.offsetParent !== null;
        }
        const text = Array.from(document.querySelectorAll('div,span,button,[role="button"]'))
            .filter(visible)
            .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
            .join(' ');
        return text.includes('입차예정일')
            || text.includes('Header 정보')
            || text.includes('Line 정보')
            || Array.from(document.querySelectorAll('div[id*="form.divWork.form.grdMainLine"]')).some(visible);
    }).catch(() => false);
}

async function hasDispatchProgressMenuFast(page: Page) {
    return page.evaluate(() => {
        function visible(el: Element | null): el is HTMLElement {
            return !!el && el instanceof HTMLElement && el.offsetParent !== null;
        }
        return Array.from(document.querySelectorAll([
            'div[id$="frameLeft.form.divLeft.form.grdTree.body.gridrow_9.cell_9_0"]',
            'div[id*="frameLeft.form.divLeft.form.grdTree.body.gridrow_9.cell_9_0"]',
            'div[id$="frameLeft.form.divLeft.form.grdTree.body.gridrow_5.cell_5_0"]',
            'div[id*="frameLeft.form.divLeft.form.grdTree.body.gridrow_5.cell_5_0"]',
            'div[id$="celltreeitem.treeitemtext"]',
            'div[id$="celltreeitem.treeitemtext:text"]',
            'div',
            'button',
            '[role="button"]',
            '[role="treeitem"]',
            '[title]',
            '[aria-label]',
            '[aria-description]',
        ].join(','))).some((el) => {
            if (!visible(el)) return false;
            const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
            const title = el.getAttribute('title') || '';
            const aria = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('aria-description') || ''}`;
            return text.includes('주문 진행 조회')
                || text.includes('배차 조회')
                || title.includes('주문 진행 조회')
                || title.includes('배차 조회')
                || aria.includes('주문 진행 조회')
                || aria.includes('배차 조회');
        });
    }).catch(() => false);
}

async function clickDispatchProgressMenuFast(page: Page) {
    const clicked = await page.evaluate(() => {
        const labels = ['주문 진행 조회', '배차 조회'];
        function visible(el: Element | null): el is HTMLElement {
            return !!el && el instanceof HTMLElement && el.offsetParent !== null;
        }
        function textOf(el: Element | null) {
            if (!el) return '';
            return [
                el.textContent || '',
                el.getAttribute('title') || '',
                el.getAttribute('aria-label') || '',
                el.getAttribute('aria-description') || '',
            ].join(' ').replace(/\s+/g, ' ').trim();
        }
        function fireMouse(el: HTMLElement) {
            for (const type of ['mouseover', 'mousemove', 'mousedown', 'mouseup', 'click']) {
                el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
            }
        }
        function clickElement(el: HTMLElement) {
            const comp = (el as HTMLElement & { _linked_element?: { linkedcontrol?: { click?: () => void } } })._linked_element?.linkedcontrol;
            if (typeof comp?.click === 'function') comp.click();
            else fireMouse(el);
        }

        const exactSelectors = [
            'div[id$="frameLeft.form.divLeft.form.grdTree.body.gridrow_9.cell_9_0"]',
            'div[id*="frameLeft.form.divLeft.form.grdTree.body.gridrow_9.cell_9_0"]',
            'div[id$="frameLeft.form.divLeft.form.grdTree.body.gridrow_9.cell_9_0.celltreeitem"]',
            'div[id*="frameLeft.form.divLeft.form.grdTree.body.gridrow_9.cell_9_0.celltreeitem"]',
            'div[id$="frameLeft.form.divLeft.form.grdTree.body.gridrow_9.cell_9_0.celltreeitem.treeitemtext"]',
            'div[id*="frameLeft.form.divLeft.form.grdTree.body.gridrow_9.cell_9_0.celltreeitem.treeitemtext"]',
            'div[id$="frameLeft.form.divLeft.form.grdTree.body.gridrow_5.cell_5_0"]',
            'div[id*="frameLeft.form.divLeft.form.grdTree.body.gridrow_5.cell_5_0"]',
            'div[id$="frameLeft.form.divLeft.form.grdTree.body.gridrow_5.cell_5_0.celltreeitem"]',
            'div[id*="frameLeft.form.divLeft.form.grdTree.body.gridrow_5.cell_5_0.celltreeitem"]',
            'div[id$="frameLeft.form.divLeft.form.grdTree.body.gridrow_5.cell_5_0.celltreeitem.treeitemtext"]',
            'div[id*="frameLeft.form.divLeft.form.grdTree.body.gridrow_5.cell_5_0.celltreeitem.treeitemtext"]',
        ];
        for (const selector of exactSelectors) {
            const el = Array.from(document.querySelectorAll(selector)).find(visible) as HTMLElement | undefined;
            if (el) {
                clickElement(el);
                return true;
            }
        }

        const candidates = Array.from(document.querySelectorAll('div,button,[role="button"],[role="treeitem"],[title],[aria-label],[aria-description]'))
            .filter(visible) as HTMLElement[];
        const menu = candidates.find((el) => labels.some((label) => textOf(el) === label))
            ?? candidates.find((el) => labels.some((label) => textOf(el).includes(label)));
        if (!menu) return false;
        const target = menu.closest('div.GridCellControl') as HTMLElement | null
            ?? menu.closest('div[id*="frameLeft.form.divLeft.form.grdTree.body.gridrow_"]') as HTMLElement | null
            ?? menu;
        target.scrollIntoView({ block: 'center', inline: 'nearest' });
        clickElement(target);
        return true;
    });
    if (!clicked) throw new Error('주문 진행 조회/배차 조회 메뉴를 클릭하지 못했습니다.');
}

async function openDispatchProgressPageFast(page: Page, waitingForOtp = false) {
    if (await isDispatchProgressPageFast(page)) return;
    const maxAttempts = waitingForOtp ? 180 : 60;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (await hasDispatchProgressMenuFast(page)) break;
        await page.waitForTimeout(1000);
        if (attempt === maxAttempts - 1) throw new Error('OTP 인증 후 주문 진행 조회/배차 조회 메뉴가 나타나지 않았습니다.');
    }
    await clickDispatchProgressMenuFast(page);
    await page.waitForFunction(() => {
        function visible(el: Element | null): el is HTMLElement {
            return !!el && el instanceof HTMLElement && el.offsetParent !== null;
        }
        const text = Array.from(document.querySelectorAll('div,span,button,[role="button"]'))
            .filter(visible)
            .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
            .join(' ');
        return text.includes('입차예정일')
            || text.includes('Header 정보')
            || text.includes('Line 정보')
            || Array.from(document.querySelectorAll('div[id*="form.divWork.form.grdMainLine"]')).some(visible);
    }, null, { timeout: 20_000 });
}

async function fillArrivalDateRange(page: Page, ymd: string) {
    await focusNexacroWindowTab(page, 'winESDMY-10-145');
    const selectorGroups = [
        [
            'input[id*="winESDMY-10-145"][id$="form.divWork.form.divSearch.form.calETDAT_FROM.calendaredit:input"]',
            'input[id*="winESDMY-10-145"][id*="form.divWork.form.divSearch.form.calETDAT_FROM.calendaredit:input"]',
        ],
        [
            'input[id*="winESDMY-10-145"][id$="form.divWork.form.divSearch.form.calETDAT_TO.calendaredit:input"]',
            'input[id*="winESDMY-10-145"][id*="form.divWork.form.divSearch.form.calETDAT_TO.calendaredit:input"]',
        ],
    ];

    for (const selectors of selectorGroups) {
        let input = null;
        for (const selector of selectors) {
            const candidate = page.locator(selector).first();
            if (await candidate.isVisible().catch(() => false)) {
                input = candidate;
                break;
            }
        }
        if (!input) continue;

        await input.click({ force: true });
        await page.waitForTimeout(150);
        await input.press('Control+A');
        await page.waitForTimeout(50);
        await input.press('Backspace');
        await page.waitForTimeout(50);
        await input.fill('');
        await input.type(ymd, { delay: 20 });
        await page.waitForTimeout(150);
    }
}

type GridData = {
    headers: string[];
    rows: Array<{ id: string; cells: string[]; text: string }>;
};

async function readGrid(page: Page, gridName: string): Promise<GridData> {
    return page.evaluate((gridName) => {
        function visible(el: Element | null): el is HTMLElement {
            return !!el && el instanceof HTMLElement && el.offsetParent !== null;
        }
        function isGridCell(el: Element | null): el is HTMLElement {
            return !!el
                && el instanceof HTMLElement
                && el.classList.contains('GridCellControl')
                && /\.cell_-?\d+_\d+$/.test(el.id);
        }
        function isHeaderCell(el: Element | null): el is HTMLElement {
            return !!el
                && el instanceof HTMLElement
                && el.classList.contains('GridCellControl')
                && /\.cell_-1_\d+$/.test(el.id);
        }
        function cellIndex(id: string) {
            const match = id.match(/\.cell_-?\d+_(\d+)$/);
            return match ? Number(match[1]) : 0;
        }
        function rowIndex(id: string) {
            const match = id.match(/gridrow_(-?\d+)/);
            return match ? Number(match[1]) : 0;
        }
        function isGridRow(el: Element): el is HTMLElement {
            if (!visible(el)) return false;
            return el instanceof HTMLElement
                && el.classList.contains('GridRowControl')
                && /\.body\.gridrow_\d+$/.test(el.id);
        }
        function cellsOf(row: Element) {
            return Array.from(row.querySelectorAll('div'))
                .filter((cell) => visible(cell) && isGridCell(cell))
                .sort((a, b) => cellIndex(a.id) - cellIndex(b.id))
                .map((cell) => (cell.textContent || '').replace(/\s+/g, ' ').trim());
        }

        const headers = Array.from(document.querySelectorAll(`div[id*="${gridName}.head.gridrow_-1.cell_-1_"]`))
            .filter((cell) => visible(cell) && isHeaderCell(cell))
            .sort((a, b) => cellIndex(a.id) - cellIndex(b.id))
            .map((cell) => (cell.textContent || '').replace(/\s+/g, ' ').trim());
        const rows = Array.from(document.querySelectorAll(`div[id*="${gridName}.body.gridrow_"]`))
            .filter(isGridRow)
            .sort((a, b) => rowIndex(a.id) - rowIndex(b.id))
            .map((row) => ({
                id: row.id,
                cells: cellsOf(row),
                text: (row.textContent || '').replace(/\s+/g, ' ').trim(),
            }))
            .filter((row) => row.cells.some(Boolean));
        return { headers, rows };
    }, gridName);
}

async function findLineGridName(page: Page) {
    const visible = await page.locator('div[id*="form.divWork.form.grdMainLine"]').first().isVisible().catch(() => false);
    return visible ? 'form.divWork.form.grdMainLine' : null;
}

async function waitForMainGridSearchResult(page: Page) {
    const started = Date.now();
    while (Date.now() - started < 10_000) {
        const state = await page.evaluate(() => {
            function visible(el: Element | null): el is HTMLElement {
                return !!el && el instanceof HTMLElement && el.offsetParent !== null;
            }
            function isGridRow(el: Element): el is HTMLElement {
                return el instanceof HTMLElement
                    && visible(el)
                    && el.classList.contains('GridRowControl')
                    && /\.body\.gridrow_\d+$/.test(el.id);
            }
            function rowHasText(row: Element) {
                return Array.from(row.querySelectorAll('div'))
                    .some((cell) => visible(cell) && (cell.textContent || '').replace(/\s+/g, ' ').trim());
            }
            const gridExists = Array.from(document.querySelectorAll('div[id*="form.divWork.form.grdMain"]')).some(visible);
            const rowCount = Array.from(document.querySelectorAll('div[id*="form.divWork.form.grdMain.body.gridrow_"]'))
                .filter(isGridRow)
                .filter(rowHasText)
                .length;
            const visibleText = Array.from(document.querySelectorAll('div,span,[role="alert"]'))
                .filter(visible)
                .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
                .join(' ');
            const noData = /조회.*(없|0건)|데이터.*없|검색.*없|No Data/i.test(visibleText);
            return { gridExists, rowCount, noData };
        });

        if (state.rowCount > 0) return 'ROWS' as const;
        if (state.noData) return 'EMPTY' as const;
        if (state.gridExists && Date.now() - started > 5_000) return 'EMPTY' as const;
        await page.waitForTimeout(250);
    }
    return 'EMPTY' as const;
}

function lineFromCells(headers: string[], cells: string[]): ScrapedLine {
    const materialIndex = findColumnIndex(headers, [/자재이름/, /품목명/, /제품명/, /자재명/, /아이템/], 3);
    const quantityIndex = findColumnIndex(headers, [/출고수량/, /수량/], 8);
    const materialRaw = cells[materialIndex]?.trim() || null;
    return {
        materialNameRaw: materialRaw,
        materialName: materialRaw ? convertMaterialName(materialRaw) : null,
        quantityKg: parseQuantityKg(cells[quantityIndex]),
        rawCells: cells,
    };
}

async function hasUsableDispatchNavigation(page: Page, timeoutMs = 5_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (await isDispatchProgressPageFast(page) || await hasDispatchProgressMenuFast(page)) return true;
        await page.waitForTimeout(250);
    }
    return false;
}

function dispatchCompletionStatusFromMainRow(headers: string[], cells: string[]): string | null {
    const statusIndex = findColumnIndex(headers, [/출고완료여부/, /출고.*완료.*여부/, /완료여부/], -1);
    const fallbackIndex = cells.length - 1;
    const index = statusIndex >= 0 ? statusIndex : fallbackIndex;
    const header = headers[index] ?? '';
    const raw = cells[index]?.trim() || '';
    if (!raw) return null;
    if (statusIndex >= 0 || /출고|완료|여부/.test(header) || /^(Y|N|예|아니오|완료|미완료|출고완료|출고전)$/i.test(raw)) {
        return raw;
    }
    return null;
}

async function scrapeHanwhaDispatchOnce(
    isoDate: string,
    opts: ScrapeOptions = {},
): Promise<ScrapeResult> {
    const username = opts.username ?? process.env.HANWHA_USERNAME;
    const password = opts.password ?? process.env.HANWHA_PASSWORD;
    if (!username || !password) {
        return { ok: false, rows: [], error: '한화 계정 정보가 설정되지 않았습니다.', errorCode: 'NO_CREDENTIALS' };
    }

    let page: Page | null = null;
    try {
        const acquired = await getDispatchESalesPage();
        page = acquired.page;
        let otpRequested = await loginAndSendOtpIfNeeded(page, username, password);
        // The visible countdown alone is not a valid session check. If the
        // dispatch page/menu cannot be reached, immediately begin a clean
        // login instead of waiting for a later menu timeout.
        if (!otpRequested && !await hasUsableDispatchNavigation(page)) {
            otpRequested = await forceDispatchLogin(page, username, password);
        }
        await closeAllNexacroWorkTabs(page);
        await openDispatchProgressPageFast(page, otpRequested);
        await focusNexacroWindowTab(page, 'winESDMY-10-145');

        const ymd = isoToYmd(isoDate);
        await fillArrivalDateRange(page, ymd);
        await clickNexacro(page, [
            'div[id*="winESDMY-10-145"][id$="form.divTitle.form.btnSearch"]',
            'div[id*="winESDMY-10-145"][id*="form.divTitle.form.btnSearch"]',
        ].join(','));
        await page.waitForTimeout(700);
        const searchResult = await waitForMainGridSearchResult(page);
        if (searchResult === 'EMPTY') {
            return { ok: true, rows: [] };
        }
        await page.waitForTimeout(1200);

        const mainGrid = await readGrid(page, 'form.divWork.form.grdMain');
        const indoChiIndex = findColumnIndex(mainGrid.headers, [/인도처/, /납품처/, /도착지/, /거래처/, /고객/], 5);
        const result: ScrapedIndoChi[] = [];

        for (let idx = 0; idx < mainGrid.rows.length; idx += 1) {
            const mainRow = mainGrid.rows[idx];
            await page.locator(`[id="${mainRow.id}"]`).click({ force: true });
            await page.waitForTimeout(900);

            const lineGridName = await findLineGridName(page);
            const lineGrid = lineGridName ? await readGrid(page, lineGridName) : { headers: [], rows: [] };
            const dispatchCompletionStatus = dispatchCompletionStatusFromMainRow(mainGrid.headers, mainRow.cells);
            const lines = lineGrid.rows.length > 0
                ? lineGrid.rows.map((row) => ({
                    ...lineFromCells(lineGrid.headers, row.cells),
                    rawCells: markHanwhaDispatchCompletionStatus(row.cells, dispatchCompletionStatus),
                }))
                : [{
                    ...lineFromCells(mainGrid.headers, mainRow.cells),
                    rawCells: markHanwhaDispatchCompletionStatus(mainRow.cells, dispatchCompletionStatus),
                }];
            const indoChiName = mainRow.cells[indoChiIndex]?.trim()
                || mainRow.cells.find((cell) => /[가-힣]/.test(cell) && cell.length >= 2)
                || `행 ${idx + 1}`;
            result.push({
                indoChiIndex: idx + 1,
                indoChiName,
                lines,
            });
        }

        return { ok: true, rows: result };
    } catch (error) {
        return {
            ok: false,
            rows: [],
            error: error instanceof Error ? error.message : String(error),
            errorCode: 'UNKNOWN',
        };
    }
}

export async function scrapeHanwhaDispatch(
    isoDate: string,
    opts: ScrapeOptions = {},
): Promise<ScrapeResult> {
    const first = await scrapeHanwhaDispatchOnce(isoDate, opts);
    if (first.ok || !/target page, context or browser has been closed/i.test(first.error ?? '')) {
        return first;
    }

    // Chrome can disappear while a user or Windows closes the previous
    // controlled process. Reconnect once so this request starts its login
    // recovery instead of failing without ever opening the e-Sales screen.
    await sleep(750);
    return scrapeHanwhaDispatchOnce(isoDate, opts);
}
