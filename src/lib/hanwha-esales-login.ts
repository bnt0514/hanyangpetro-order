import type { Page } from 'playwright';

import path from 'path';

export type HanwhaESalesLoginResult =
    | { ok: true; message: string; orderNo?: string | null }
    | {
        ok: false;
        error: string;
        manualAction?: 'PRODUCT_SELECTION';
        manualTitle?: string;
        manualButtonLabel?: string;
        rowIndex?: number;
    };

export type HanwhaESalesOrderItem = {
    productName: string;
    productCode?: string | null;
    materialName: string;
    itemCode: string;
    quantity: number;
};

export type HanwhaESalesOrderInput = {
    username: string | null;
    password: string | null;
    shipToName: string;
    shipToAddress?: string | null;
    customerName?: string | null;
    orderDateYmd?: string | null;
    poDateYmd?: string | null;
    deliveryDateYmd: string;
    driverCustomerNotice?: string | null;
    orderExtraRequest?: string | null;
    items: HanwhaESalesOrderItem[];
    approveAfterOrder?: boolean;
};

export type HanwhaESalesOrderStatusResult =
    | { ok: true; message: string; status: string; rowText?: string }
    | { ok: false; error: string };

export type HanwhaESalesOrderStatusItem = {
    materialName: string;
    itemCode?: string | null;
    quantity: number;
};

const ESALES_LOGIN_URL = 'https://esales.hanwhasolutions.com/esplus/resources/login.html';
const REMOTE_DEBUGGING_PORT = 9224;
const AUTOMATION_WINDOW_NAME_PREFIX = 'hanyangpetro-esales-automation:';
const dialogHandlerPages = new WeakSet<Page>();

function chromePath() {
    return process.env.CHROME_PATH?.trim() || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
}

function controlledProfileDir() {
    return path.join(process.cwd(), 'tmp', 'hanwha-esales-controlled-profile');
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatYmd(value: string | null | undefined) {
    const digits = (value ?? '').replace(/\D/g, '');
    return digits.length === 8 ? digits : '';
}

function sameDateDigits(a: string | null | undefined, b: string | null | undefined) {
    const left = (a ?? '').replace(/\D/g, '');
    const right = (b ?? '').replace(/\D/g, '');
    return left.length === 8 && left === right;
}

function normalizeText(value: string | null | undefined) {
    return (value ?? '')
        .replace(/\s+/g, '')
        .replace(/[()]/g, '')
        .toUpperCase();
}

function hasBrokenKoreanEncoding(value: string) {
    return /\?{2,}|釉|熬|嚥|癲|袁|轅|雍|關|紐|吏|ル|毓|沅|濡|쒗|꾩|븐|덈|놁|뒿|묒|諛/.test(value);
}

function displayErrorMessage(error: unknown, fallback: string) {
    if (!(error instanceof Error) || !error.message.trim()) return fallback;
    return hasBrokenKoreanEncoding(error.message) ? fallback : error.message;
}

function materialConfirmationKeys(materialName: string | null | undefined) {
    const normalized = normalizeText(materialName);
    const keys = new Set<string>();
    if (normalized) keys.add(normalized);

    const bagBase = normalized.match(/^(.*?_(?:FFS|FB500|FB700|FB750))(?:_.+)?$/i)?.[1];
    if (bagBase && bagBase.length >= 10) keys.add(bagBase);

    return Array.from(keys);
}

function productGradeKeys(item: HanwhaESalesOrderItem) {
    const keys = new Set<string>();
    for (const value of [item.materialName, item.productName, item.productCode]) {
        const matches = (value ?? '').matchAll(/(?:^|[^A-Z0-9])(\d{3,5}[A-Z]?)(?=$|[^A-Z0-9])/gi);
        for (const match of matches) {
            const normalized = normalizeText(match[1]);
            if (normalized.length >= 3) keys.add(normalized);
        }
    }
    return Array.from(keys);
}

function productMatchKeys(item: HanwhaESalesOrderItem) {
    const keys = new Set<string>();
    const itemCode = normalizeText(item.itemCode);
    const productName = normalizeText(item.productName);
    if (itemCode) keys.add(itemCode);
    for (const materialName of materialConfirmationKeys(item.materialName)) keys.add(materialName);
    for (const grade of productGradeKeys(item)) keys.add(grade);
    if (productName) keys.add(productName);
    return Array.from(keys);
}

function productSearchTerms(item: HanwhaESalesOrderItem) {
    const terms = new Set<string>();
    for (const value of [item.itemCode, item.materialName]) {
        const trimmed = value?.trim();
        if (trimmed) terms.add(trimmed);
    }
    for (const grade of productGradeKeys(item)) terms.add(grade);
    const productName = item.productName?.trim();
    if (productName) terms.add(productName);
    return Array.from(terms);
}

function normalizeOrderMatchText(value: string | null | undefined) {
    return (value ?? '')
        .replace(/[\s()[\]{}.,/\\_-]/g, '')
        .toUpperCase();
}

class ManualProductSelectionRequiredError extends Error {
    rowIndex: number;

    constructor(message: string, rowIndex: number) {
        super(message);
        this.name = 'ManualProductSelectionRequiredError';
        this.rowIndex = rowIndex;
    }
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

async function launchControlledChrome() {
    const { spawn } = await import('child_process');
    const child = spawn(chromePath(), [
        `--remote-debugging-port=${REMOTE_DEBUGGING_PORT}`,
        `--user-data-dir=${controlledProfileDir()}`,
        '--no-first-run',
        '--disable-session-crashed-bubble',
        '--hide-crash-restore-bubble',
        '--new-window',
        ESALES_LOGIN_URL,
    ], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
    });
    child.unref();
}

async function ensureCdp() {
    if (!await isCdpOpen()) {
        await launchControlledChrome();
    }
    await waitForCdp();
}

async function hasVisibleSelector(page: Page, selector: string) {
    return page.evaluate((selector) => {
        return Array.from(document.querySelectorAll(selector))
            .some((el) => el instanceof HTMLElement && el.offsetParent !== null);
    }, selector).catch(() => false);
}

async function hasLoggedInESalesShell(page: Page) {
    return page.evaluate(() => {
        function visible(el: Element | null): el is HTMLElement {
            if (!el || !(el instanceof HTMLElement)) return false;
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        }
        function textOf(el: Element | null) {
            return (el?.textContent || '').replace(/\s+/g, ' ').trim();
        }
        const shellSelectors = [
            'div[id*="winESDMY-10-400"]',
            'div[id*="frameLeft.form.divLeft"]',
            'div[id*="frameNavi.form.divTab"]',
            'div[id*="frameBottom.form.btnExtension"]',
            'div[id*="frameBottom.form.staTime"]',
            'div[id*="frameTop"]',
            'div[id*="POP_ORDER_REG"]',
            'div[id*="ESD_PARTNER_INFO_V"]',
            'div[id*="ESD_SALES_ITEM_V"]',
        ];
        if (shellSelectors.some((selector) => Array.from(document.querySelectorAll(selector)).some(visible))) {
            return true;
        }
        const visibleText = Array.from(document.querySelectorAll('div,button,[role="button"],[role="treeitem"]'))
            .filter(visible)
            .map(textOf)
            .join(' ');
        if (
            /order|dispatch|header|line/i.test(visibleText)
            || visibleText.includes('주문')
            || visibleText.includes('배차')
            || visibleText.includes('대리점')
            || visibleText.includes('오더')
            || visibleText.includes('입차')
        ) return true;
        return false;
    }).catch(() => false);
}

async function getESalesPage() {
    await ensureCdp();

    const { chromium } = await import('playwright');
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${REMOTE_DEBUGGING_PORT}`);
    const context = browser.contexts()[0] ?? await browser.newContext();
    const esalesPages = context.pages().filter((candidate) => candidate.url().includes('esales.hanwhasolutions.com'));
    let page: Page | undefined;
    for (const candidate of esalesPages) {
        if (await hasLoggedInESalesShell(candidate)) {
            page = candidate;
            break;
        }
    }
    page ??= esalesPages[0];
    if (!page) {
        page = await context.newPage();
        await page.goto(ESALES_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    }
    await page.bringToFront();
    await page.waitForLoadState('domcontentloaded', { timeout: 60_000 }).catch(() => undefined);
    registerDialogHandler(page);
    return page;
}

function registerDialogHandler(page: Page) {
    if (dialogHandlerPages.has(page)) return;
    dialogHandlerPages.add(page);
    page.on('dialog', async (dialog) => {
        try {
            await dialog.accept();
        } catch {
            // The dialog can be auto-closed by Nexacro before Playwright accepts it.
        }
    });
}

async function getFreshESalesPage(taskName = 'order-status') {
    const page = await getESalesPage();
    await markAutomationPage(page, taskName);
    return page;
}

async function markAutomationPage(page: Page, taskName: string) {
    await page.evaluate(({ prefix, taskName }) => {
        window.name = `${prefix}${taskName}:${Date.now()}`;
    }, { prefix: AUTOMATION_WINDOW_NAME_PREFIX, taskName }).catch(() => undefined);
}

async function clickNexacro(page: Page, selector: string, timeoutMs = 20_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const target = await page.evaluate((selector) => {
            function visible(el: Element | null): el is HTMLElement {
                if (!el || !(el instanceof HTMLElement)) return false;
                const rect = el.getBoundingClientRect();
                const style = getComputedStyle(el);
                return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
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
                if (!el || !(el instanceof HTMLElement)) return false;
                const rect = el.getBoundingClientRect();
                const style = getComputedStyle(el);
                return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
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
            function zIndexOf(el: HTMLElement) {
                const z = Number(window.getComputedStyle(el).zIndex);
                return Number.isFinite(z) ? z : 0;
            }
            function popupRoot(el: Element) {
                return el.closest('div[id*="POP_"], div[id*="ESD_PARTNER_INFO_V"], div[id*="ESD_SALES_ITEM_V"]') as HTMLElement | null;
            }

            const buttons = Array.from(document.querySelectorAll('div,button,[role="button"]'))
                .filter((el): el is HTMLElement => {
                    if (!visible(el)) return false;
                    const root = popupRoot(el);
                    if (!root || !visible(root)) return false;
                    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
                    const id = el.id.toLowerCase();
                    return id.includes('closebutton') || id.endsWith('form.btnclose') || text === 'close';
                })
                .sort((a, b) => zIndexOf(popupRoot(b) ?? b) - zIndexOf(popupRoot(a) ?? a));

            const button = buttons[0];
            if (!button) return false;
            clickElement(button);
            return true;
        });
        if (!clicked) return;
        await page.waitForTimeout(500);
    }
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
        await clickVisibleAlertOk(page, 1_500);
    }

    await closeVisibleESalesPopups(page);
}

async function componentClick(page: Page, selector: string) {
    const clicked = await page.evaluate((targetSelector) => {
        function visible(el: Element | null): el is HTMLElement {
            return !!el && el instanceof HTMLElement && el.offsetParent !== null;
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
            if (typeof click === 'function') {
                click.call(comp);
                return true;
            }
            fireMouse(el);
            return true;
        }

        const el = Array.from(document.querySelectorAll(targetSelector)).find(visible) as HTMLElement | undefined;
        return el ? clickElement(el) : false;
    }, selector);
    if (!clicked) throw new Error(`e-Sales ?????????????釉먮폁???????? ????釉먮폁??????????????????? ${selector}`);
}

async function forceClickFirst(page: Page, selectors: string[], timeoutMs = 10_000) {
    const started = Date.now();
    let lastSelector = selectors[0] ?? '';
    while (Date.now() - started < timeoutMs) {
        for (const selector of selectors) {
            lastSelector = selector;
            const locator = page.locator(selector).first();
            if (await locator.count().catch(() => 0)) {
                await locator.click({ force: true, timeout: 3000 });
                return;
            }
        }
        await page.waitForTimeout(250);
    }
    throw new Error(`e-Sales ???????????????? ????釉먮폁??????????????????? ${lastSelector}`);
}

async function clickBySuffixOrText(page: Page, suffixes: string[], texts: string[], timeoutMs = 10_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const clicked = await page.evaluate(({ suffixes, texts }) => {
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
            function clickElement(el: HTMLElement) {
                const linked = (el as HTMLElement & { _linked_element?: { linkedcontrol?: { click?: () => void } } })._linked_element;
                const comp = linked?.linkedcontrol;
                const click = comp?.click;
                if (typeof click === 'function') {
                    click.call(comp);
                    return true;
                }
                fireMouse(el);
                return true;
            }

            const all = Array.from(document.querySelectorAll('div,button,[role="button"]')).filter(visible) as HTMLElement[];
            const byId = all.find((el) => suffixes.some((suffix) => el.id.endsWith(suffix) || el.id.includes(suffix)));
            if (byId) return clickElement(byId);
            const byText = all.find((el) => texts.some((text) => textOf(el) === text || textOf(el).includes(text)));
            return byText ? clickElement(byText) : false;
        }, { suffixes, texts });
        if (clicked) return;
        await page.waitForTimeout(500);
    }
    throw new Error(`${texts.join(', ') || suffixes.join(', ')} ????????????釉먮폁???????? ????釉먮폁???????????????????`);
}

async function fillInput(page: Page, selector: string, value: string, pressEnter = false) {
    await page.waitForSelector(selector, { state: 'visible', timeout: 20_000 });
    const locator = page.locator(selector).first();
    await locator.click({ force: true });
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText(value);
    await page.waitForTimeout(150);

    const currentValue = await locator.inputValue().catch(() => '');
    if (currentValue !== value && !sameDateDigits(currentValue, value)) {
        await locator.fill(value, { force: true }).catch(() => undefined);
        await page.waitForTimeout(150);
    }

    await page.evaluate(({ selector, value }) => {
            const input = document.querySelector(selector) as HTMLInputElement | null;
            if (!input) return;
            const proto = window.HTMLInputElement.prototype;
            const valueSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            valueSetter?.call(input, value);
            input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('blur', { bubbles: true }));

            const ownerId = input.id.endsWith(':input') ? input.id.slice(0, -':input'.length) : input.id;
            const owner = document.getElementById(ownerId) as (HTMLElement & {
                _linked_element?: {
                    linkedcontrol?: {
                        set_value?: (value: string) => void;
                        setValue?: (value: string) => void;
                        value?: string;
                        text?: string;
                    };
                };
            }) | null;
            const comp = owner?._linked_element?.linkedcontrol;
            if (comp?.set_value) comp.set_value(value);
            else if (comp?.setValue) comp.setValue(value);
            else if (comp) {
                comp.value = value;
                comp.text = value;
            }
        }, { selector, value });
    await page.waitForTimeout(150);

    const verifiedValue = await locator.inputValue().catch(() => '');
    if (verifiedValue !== value && !sameDateDigits(verifiedValue, value)) {
        throw new Error(`e-Sales ??????????살몝????????????????????????? ????釉먮폁??????????????????? ??????????살몝??? ${value}`);
    }
    if (pressEnter) await page.keyboard.press('Enter');
}

async function fillNexacroSearchInput(page: Page, selector: string, value: string) {
    await page.waitForSelector(selector, { state: 'visible', timeout: 20_000 });
    const ok = await page.evaluate(({ selector, value }) => {
        const input = Array.from(document.querySelectorAll(selector))
            .find((el): el is HTMLInputElement => el instanceof HTMLInputElement && el.offsetParent !== null);
        if (!input) return { ok: false, value: '', reason: 'input-not-found' };

        const ownerId = input.id.endsWith(':input') ? input.id.slice(0, -':input'.length) : input.id;
        const owner = document.getElementById(ownerId) as (HTMLElement & {
            _linked_element?: {
                linkedcontrol?: {
                    setFocus?: () => void;
                    set_value?: (value: string) => void;
                    setValue?: (value: string) => void;
                    value?: string;
                    text?: string;
                };
            };
        }) | null;
        const comp = owner?._linked_element?.linkedcontrol;
        owner?.click();
        input.click();
        input.focus();
        comp?.setFocus?.();

        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, '');
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '', inputType: 'deleteContentBackward' }));
        setter?.call(input, value);
        if (comp?.set_value) comp.set_value(value);
        else if (comp?.setValue) comp.setValue(value);
        else if (comp) {
            comp.value = value;
            comp.text = value;
        }
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: input.value === value, value: input.value, reason: '' };
    }, { selector, value });

    if (!ok.ok) {
        const locator = page.locator(selector).first();
        await locator.click({ force: true });
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
        await page.keyboard.insertText(value);
        await page.waitForTimeout(200);
        const actual = await locator.inputValue().catch(() => '');
        if (actual !== value) {
            throw new Error(`e-Sales ???뀀맩鍮???癲??????????????살몝????????????????袁⑸즴筌?씛彛?????????????곌떽釉붾????????? ????釉먮폁??????????????????? ??????????살몝??? ${value}, ??????熬곣뫖利당춯??쎾퐲??????????щ첉?? ${actual || ok.value || ok.reason}`);
        }
    }
}

async function setNexacroValue(page: Page, selector: string, value: string) {
    const ok = await page.evaluate(({ selector, value }) => {
        const el = document.querySelector(selector) as (HTMLElement & {
            _linked_element?: {
                linkedcontrol?: {
                    set_value?: (value: string) => void;
                    setValue?: (value: string) => void;
                    value?: string;
                    text?: string;
                };
            };
        }) | null;
        const comp = el?._linked_element?.linkedcontrol;
        if (comp?.set_value) {
            comp.set_value(value);
            return true;
        }
        if (comp?.setValue) {
            comp.setValue(value);
            return true;
        }
        if (comp) {
            comp.value = value;
            comp.text = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }
        return false;
    }, { selector, value });
    if (ok) return;
    await fillInput(page, selector, value);
}

async function setNexacroValues(page: Page, values: Array<{ selector: string; value: string }>) {
    const pending = values.filter((item) => item.value.trim());
    if (pending.length === 0) return;

    const missing = await page.evaluate((values) => {
        const missing: string[] = [];
        for (const { selector, value } of values) {
            const el = document.querySelector(selector) as (HTMLElement & {
                _linked_element?: {
                    linkedcontrol?: {
                        set_value?: (value: string) => void;
                        setValue?: (value: string) => void;
                        value?: string;
                        text?: string;
                    };
                };
            }) | null;
            const comp = el?._linked_element?.linkedcontrol;
            if (comp?.set_value) {
                comp.set_value(value);
            } else if (comp?.setValue) {
                comp.setValue(value);
            } else if (comp) {
                comp.value = value;
                comp.text = value;
            } else {
                missing.push(selector);
                continue;
            }
            el?.dispatchEvent(new Event('input', { bubbles: true }));
            el?.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return missing;
    }, pending);

    for (const selector of missing) {
        const value = pending.find((item) => item.selector === selector)?.value;
        if (value) await fillInput(page, selector, value);
    }
}

async function loginAndSendOtp(page: Page, input: { username: string; password: string }) {
    await page.waitForTimeout(1500);
    if (await hasLoggedInESalesShell(page)) return false;

    const userSelector = 'input[id$="frameLogin.form.divLogin.form.edtId:input"]';
    const passwordSelector = 'input[id$="frameLogin.form.divLogin.form.edtPw:input"]';
    const hasLoginForm = await hasVisibleSelector(page, userSelector);
    if (!hasLoginForm) return false;

    await fillInput(page, userSelector, input.username);
    await fillInput(page, passwordSelector, input.password);
    await clickBySuffixOrText(page, ['btnLogin'], ['login']);
    await page.waitForTimeout(1500);
    if (await hasLoggedInESalesShell(page)) return false;
    await clickBySuffixOrText(page, ['POP_LOGIN_OTP_NOTI.form.btnClose'], ['close'], 4000).catch(() => undefined);
    await page.waitForTimeout(800);
    if (await hasLoggedInESalesShell(page)) return false;

    const otpVisible = await page.locator('div[id$="frm_LoginOTP.form.btnSendOTP"]').first().isVisible().catch(() => false);
    if (!otpVisible) return false;
    await clickBySuffixOrText(page, ['frm_LoginOTP.form.btnSendOTP'], ['send']);
    await page.waitForTimeout(1000);
    return true;
}

async function waitForOrderMenu(page: Page) {
    const menuSelector = 'div[id$="frameLeft.form.divLeft.form.grdTree.body.gridrow_1.cell_1_0"]';
    for (let attempt = 0; attempt < 61; attempt += 1) {
        const visible = await page.locator(menuSelector).first().isVisible().catch(() => false);
        if (visible) return;
        if (attempt < 60) await page.waitForTimeout(3000);
    }
    throw new Error('OTP ?????븐뼐????????雅?퍔瑗띌걡??猿딅튉??????????꾩룆梨???耀붾굝????????⑤챶裕???????????살몝???????????ル뵁????? ????釉먮폁?????????????援쏂굜????우뒭亦낆쥋援??룰큿??? ?????? ??????關?쒎첎?嫄???????? ?????븐뼐????????雅?퍔瑗띌걡??猿딅튉??????遺얘턁?????????????????????熬곣몿???????遺얘턁???????????????꾩룆梨??????????');
}

async function openNewOrderPopup(page: Page) {
    await openOrderInputList(page);
    await clickNexacro(page, [
        'div[id*="winESDMY-10-400"][id$="form.divTitle.form.btnAdd"]',
        'div[id*="winESDMY-10-400"][id*="form.divTitle.form.btnAdd"]',
    ].join(','), 10_000);
    await page.waitForSelector('div[id*="POP_ORDER_REG"]', { state: 'visible', timeout: 20_000 });
    await page.waitForTimeout(1000);
}

async function openOrderInputList(page: Page) {
    await closeAllNexacroWorkTabs(page);
    await focusNexacroWindowTab(page, 'winESDMY-10-400');
    const hasOrderList = await page.locator('div[id*="winESDMY-10-400"]').first().isVisible().catch(() => false);
    if (hasOrderList) return;

    await waitForOrderMenu(page);
    await componentClick(page, 'div[id$="frameLeft.form.divLeft.form.grdTree.body.gridrow_1.cell_1_0"]');
    await page.waitForSelector('div[id*="winESDMY-10-400"]', { state: 'visible', timeout: 20_000 });
    await focusNexacroWindowTab(page, 'winESDMY-10-400');
    await page.waitForTimeout(800);
}

async function selectShipTo(page: Page, input: HanwhaESalesOrderInput) {
    await clickBySuffixOrText(page, ['POP_ORDER_REG.form.divOrder.form.btnShipTo'], []);
    await fillInput(page, 'input[id$="ESD_PARTNER_INFO_V.form.Div01.form.edtSearchText:input"]', input.shipToName, true);
    await page.waitForSelector('div[id*="ESD_PARTNER_INFO_V.form.Grid00.body.gridrow_"]', { state: 'attached', timeout: 8_000 }).catch(() => undefined);
    await page.waitForTimeout(250);

    const rows = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('div[id*="ESD_PARTNER_INFO_V.form.Grid00.body.gridrow_"]'))
            .filter((el): el is HTMLElement => el instanceof HTMLElement && el.offsetParent !== null)
            .map((row) => ({
                id: row.id,
                text: (row.textContent || '').replace(/\s+/g, ' ').trim(),
            }));
    });
    if (rows.length === 0) throw new Error(`?????븐뼐??????????쇰뮡??袁④텛??????거?????'${input.shipToName}' ???뀀맩鍮???癲???????뀀맩鍮???癲??????饔낅떽?????? ??????嚥싲갭큔?????????????ㅼ굣塋? e-Sales ???????諛몃마嶺뚮?????????雍??????????釉먮폁????????????????????????????????嚥싲갭큔?????????釉먮폁????????饔낅떽???????????嚥싲갭큔?댁쉩???????遺얘턁????????`);

    const targetAddress = normalizeText(input.shipToAddress);
    const targetName = normalizeText(input.shipToName);
    const targetCustomer = normalizeText(input.customerName);
    const scored = rows
        .map((row) => {
            const text = normalizeText(row.text);
            let score = 0;
            if (targetAddress && text.includes(targetAddress)) score += 100;
            if (targetName && text.includes(targetName)) score += 70;
            if (targetCustomer && text.includes(targetCustomer)) score += 10;
            return { ...row, score };
        })
        .sort((a, b) => b.score - a.score);

    const selectedRow = scored[0];
    if (rows.length > 1 && selectedRow.score < 50) {
        throw new Error('?????븐뼐??????????쇰뮡??袁④텛??????거????????????꾩룆梨????????釉먮폁????????????????븐뼐??????????? ????釉먮폁??????????????????? e-Sales ???????諛몃마嶺뚮?????????雍??????????釉먮폁?????????????븐뼐??????????쇰뮡??袁④텛??????거??????嚥싲갭큔?댁빆?????? ????????????????????????嚥싲갭큔?????????釉먮폁????????饔낅떽???????????嚥싲갭큔?댁쉩???????遺얘턁????????');
    }

    await page.locator(`[id="${selectedRow.id}"]`).click({ force: true });
    await page.waitForTimeout(150);
    await clickBySuffixOrText(page, ['ESD_PARTNER_INFO_V.form.btnSelect'], ['select'], 5000).catch(async () => {
        await page.keyboard.press('Enter');
    });
    await page.waitForSelector('div[id*="ESD_PARTNER_INFO_V"]', { state: 'hidden', timeout: 5_000 }).catch(() => undefined);
    await page.waitForSelector('div[id$="POP_ORDER_REG.form.btnAdd"]', { state: 'attached', timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(250);
}

async function fillPurchaseRequestDateAfterShipTo(page: Page, poDateYmd: string) {
    const value = formatYmd(poDateYmd);
    const selector = 'input[id$="POP_ORDER_REG.form.divOrder.form.calCustRefDate.calendaredit:input"]';
    const shipToSelector = 'input[id$="POP_ORDER_REG.form.divOrder.form.edtShipToNm:input"]';
    if (!value) return;

    await page.locator(shipToSelector).first().click({ force: true, timeout: 3_000 }).catch(() => undefined);
    await page.waitForTimeout(150);
    await pressTab(page, 2);

    const isDateInputFocused = await page.evaluate((selector) => {
        const active = document.activeElement;
        return active instanceof HTMLInputElement && active.matches(selector);
    }, selector).catch(() => false);

    if (!isDateInputFocused) {
        await fillInput(page, selector, value);
        return;
    }

    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText(value);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    const currentValue = await page.locator(selector).first().inputValue().catch(() => '');
    if (!sameDateDigits(currentValue, value)) {
        await fillInput(page, selector, value);
    }
}

async function fillOrderHeader(page: Page, input: HanwhaESalesOrderInput) {
    if (input.poDateYmd) {
        await fillPurchaseRequestDateAfterShipTo(page, input.poDateYmd);
    }
    await setNexacroValues(page, [
        {
            selector: 'div[id$="POP_ORDER_REG.form.divOrder.form.txaDeliveryNote"]',
            value: input.driverCustomerNotice?.trim() ?? '',
        },
        {
            selector: 'div[id$="POP_ORDER_REG.form.divOrder.form.txaShippingNote"]',
            value: input.orderExtraRequest?.trim() ?? '',
        },
    ]);
}

async function clickProductSearchButton(page: Page, rowIndex: number) {
    const rowSelector = `div[id*="POP_ORDER_REG.form.grdOrderItem.body.gridrow_${rowIndex}"]`;
    const productCellSelector = `div[id*="POP_ORDER_REG.form.grdOrderItem.body.gridrow_${rowIndex}.cell_${rowIndex}_3"]`;
    const expandSelector = `div[id*="POP_ORDER_REG.form.grdOrderItem.body.gridrow_${rowIndex}.cell_${rowIndex}_3.cellexpandbutton"]`;
    const looseExpandSelector = `${rowSelector} div[id*="cellexpandbutton"]`;

    await page.waitForSelector(rowSelector, { state: 'attached', timeout: 15_000 });
    await forceClickFirst(page, [productCellSelector, rowSelector], 5000);
    await page.waitForTimeout(300);
    await forceClickFirst(page, [expandSelector, looseExpandSelector], 10_000);
    await page.waitForSelector('input[id$="ESD_SALES_ITEM_V.form.Div01.form.edtSearchText:input"]', { state: 'visible', timeout: 15_000 });
}

async function waitForProductSearchResultRow(page: Page, item: HanwhaESalesOrderItem, timeoutMs = 6_000) {
    const started = Date.now();
    const targetCode = normalizeText(item.itemCode);
    const targetMaterial = normalizeText(item.materialName);
    const targetProduct = normalizeText(item.productName);
    const targetGrades = productGradeKeys(item);

    while (Date.now() - started < timeoutMs) {
        const row = await page.evaluate(({ targetCode, targetMaterial, targetProduct, targetGrades }) => {
            function visible(el: Element | null): el is HTMLElement {
                if (!el || !(el instanceof HTMLElement)) return false;
                const rect = el.getBoundingClientRect();
                const style = getComputedStyle(el);
                return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
            }
            function normalize(value: string) {
                return value.replace(/\s+/g, '').replace(/[()]/g, '').toUpperCase();
            }

            const rows = Array.from(document.querySelectorAll('div[id*="ESD_SALES_ITEM_V.form.Grid00.body.gridrow_"]'))
                .filter((el): el is HTMLElement => visible(el) && el.classList.contains('GridRowControl') && /\.body\.gridrow_\d+$/.test(el.id))
                .map((row) => {
                    const cells = Array.from(row.querySelectorAll('[id*=".cell_"]')).map((cell) => (cell.textContent || '').trim());
                    const text = (row.textContent || '').replace(/\s+/g, ' ').trim();
                    const normalizedCells = cells.map(normalize);
                    const exactCode = !!targetCode && normalizedCells.some((cell) => cell === targetCode);
                    const exactMaterial = !!targetMaterial && normalizedCells.some((cell) => cell === targetMaterial);
                    const exactProduct = !!targetProduct && normalizedCells.some((cell) => cell === targetProduct);
                    const exactGrade = targetGrades.some((grade) => normalizedCells.some((cell) => cell === grade));
                    const hasProduct = !!targetProduct && normalize(text).includes(targetProduct);
                    const hasGrade = targetGrades.some((grade) => normalize(text).includes(grade));
                    let score = 0;
                    if (exactCode) score += 120;
                    if (exactMaterial) score += 60;
                    if (exactProduct) score += 50;
                    if (exactGrade) score += 45;
                    if (hasProduct) score += 35;
                    if (hasGrade) score += 30;
                    return { id: row.id, text, score, exactCode, exactMaterial, exactProduct, exactGrade, hasProduct, hasGrade };
                })
                .sort((a, b) => b.score - a.score);

            return rows.find((candidate) => candidate.score > 0) ?? null;
        }, { targetCode, targetMaterial, targetProduct, targetGrades }).catch(() => null);
        if (row?.id) return row;
        await page.waitForTimeout(150);
    }

    return null;
}

async function readVisibleProductSearchRows(page: Page) {
    return page.evaluate(() => {
        return Array.from(document.querySelectorAll('div[id*="ESD_SALES_ITEM_V.form.Grid00.body.gridrow_"]'))
            .filter((el): el is HTMLElement => el instanceof HTMLElement && el.offsetParent !== null && el.classList.contains('GridRowControl') && /\.body\.gridrow_\d+$/.test(el.id))
            .map((row) => {
                const cells = Array.from(row.querySelectorAll('[id*=".cell_"]')).map((cell) => (cell.textContent || '').trim());
                return {
                    id: row.id,
                    text: (row.textContent || '').replace(/\s+/g, ' ').trim(),
                    cells,
                };
            });
    });
}

function scoreProductSearchRow(row: { id: string; text: string; cells: string[] }, item: HanwhaESalesOrderItem) {
    const text = normalizeText(row.text);
    const cells = row.cells.map(normalizeText);
    const targetCode = normalizeText(item.itemCode);
    const targetMaterial = normalizeText(item.materialName);
    const targetProduct = normalizeText(item.productName);
    const gradeKeys = productGradeKeys(item);
    const exactCode = !!targetCode && cells.some((cell) => cell === targetCode);
    const exactMaterial = !!targetMaterial && cells.some((cell) => cell === targetMaterial);
    const exactProduct = !!targetProduct && cells.some((cell) => cell === targetProduct);
    const exactGrade = gradeKeys.some((grade) => cells.some((cell) => cell === grade));
    const hasGrade = gradeKeys.some((grade) => text.includes(grade));
    let score = 0;
    if (exactCode) score += 120;
    if (targetCode && text.includes(targetCode)) score += 80;
    if (exactMaterial) score += 65;
    if (targetMaterial && text.includes(targetMaterial)) score += 60;
    if (exactProduct) score += 55;
    if (targetProduct && text.includes(targetProduct)) score += 45;
    if (exactGrade) score += 40;
    if (hasGrade) score += 30;
    return { ...row, score, exactCode, exactMaterial, exactProduct, exactGrade, hasGrade };
}

async function selectProduct(page: Page, item: HanwhaESalesOrderItem, rowIndex: number) {
    const beforeCells = await readOrderItemRowCells(page, rowIndex).catch(() => []);
    await clickProductSearchButton(page, rowIndex);
    const productSearchInput = 'input[id$="ESD_SALES_ITEM_V.form.Div01.form.edtSearchText:input"]';
    let liveMatchedRow: { id: string; text: string; score: number } | null = null;
    let rows: Awaited<ReturnType<typeof readVisibleProductSearchRows>> = [];
    let singleRowFromExactSearch: Awaited<ReturnType<typeof readVisibleProductSearchRows>>[number] | null = null;
    const searchTerms = productSearchTerms(item);
    const exactSearchTerms = new Set([
        item.itemCode?.trim(),
        item.materialName?.trim(),
    ].filter(Boolean));

    for (const searchTerm of searchTerms) {
        await fillNexacroSearchInput(page, productSearchInput, searchTerm);
        await page.waitForTimeout(200);
        await clickBySuffixOrText(page, ['ESD_SALES_ITEM_V.form.Div01.form.btnSearch'], ['search'], 5000);

        const quickStarted = Date.now();
        while (Date.now() - quickStarted < 1_500) {
            rows = await readVisibleProductSearchRows(page).catch(() => []);
            const best = rows
                .map((row) => scoreProductSearchRow(row, item))
                .sort((a, b) => b.score - a.score)
                .find((row) => row.score > 0);
            if (best) {
                liveMatchedRow = { id: best.id, text: best.text, score: best.score };
                break;
            }
            if (rows.length === 1 && exactSearchTerms.has(searchTerm.trim())) {
                singleRowFromExactSearch = rows[0];
                break;
            }
            await page.waitForTimeout(120);
        }

        if (liveMatchedRow || singleRowFromExactSearch) break;

        liveMatchedRow = await waitForProductSearchResultRow(page, item, 1_500);
        await page.waitForTimeout(liveMatchedRow ? 100 : 200);
        rows = await readVisibleProductSearchRows(page);
        if (!liveMatchedRow && rows.length === 1 && exactSearchTerms.has(searchTerm.trim())) {
            singleRowFromExactSearch = rows[0];
            break;
        }
        if (liveMatchedRow || rows.some((row) => scoreProductSearchRow(row, item).score > 0)) break;
    }
    if (!liveMatchedRow && rows.length === 0) {
        throw new ManualProductSelectionRequiredError(
            `???????????袁⑸즴筌?씛彛????'${item.itemCode}' (${item.materialName}) ???뀀맩鍮???癲???????뀀맩鍮???癲??????饔낅떽?????? ??????嚥싲갭큔?????????????ㅼ굣塋? e-Sales ???? ???????諛몃마嶺뚮?????????雍?????????????????釉먮폁????????????????????????????????????노륭????????????쇨덧????????????????????????熬곣뫖利당춯??쎾퐲????????????????뀀맩鍮????Β?節뗪텤????????`,
            rowIndex,
        );
    }

    const scored = rows
        .map((row) => scoreProductSearchRow(row, item))
        .sort((a, b) => b.score - a.score);

    const exactScoredRow = scored.find((row) => row.score > 0);
    const selectedRowId = liveMatchedRow?.id ?? exactScoredRow?.id ?? singleRowFromExactSearch?.id;
    if (!selectedRowId) {
        const sample = rows.slice(0, 5).map((row) => row.text).join(' / ');
        throw new ManualProductSelectionRequiredError(
            `Could not confirm e-Sales product row. sample=${sample}`,
            rowIndex,
        );
    }
    await page.locator(`[id="${selectedRowId}"]`).click({ force: true }).catch(async () => {
        const refreshedRow = await waitForProductSearchResultRow(page, item, 3_000);
        if (!refreshedRow?.id) throw new ManualProductSelectionRequiredError(
            `e-Sales product row disappeared before selection. itemCode=${item.itemCode}, material=${item.materialName}`,
            rowIndex,
        );
        await page.locator(`[id="${refreshedRow.id}"]`).click({ force: true });
    });
    await page.waitForTimeout(300);
    await clickBySuffixOrText(page, ['ESD_SALES_ITEM_V.form.btnSelect'], ['select']);
    await page.waitForSelector('div[id*="ESD_SALES_ITEM_V"]', { state: 'hidden', timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(600);
    const confirmed = await waitForOrderItemProduct(page, item, rowIndex, 5_000, beforeCells);
    if (!confirmed) {
        throw new ManualProductSelectionRequiredError(
            `e-Sales product selection was not applied to row ${rowIndex + 1}. itemCode=${item.itemCode}, material=${item.materialName}`,
            rowIndex,
        );
    }
}

async function readOrderItemRowCells(page: Page, rowIndex: number) {
    return page.evaluate((rowIndex) => {
        function visible(el: Element | null): el is HTMLElement {
            if (!el || !(el instanceof HTMLElement)) return false;
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        }
        function textOf(el: Element | null) {
            if (!el) return '';
            const inputValue = el instanceof HTMLInputElement ? el.value : '';
            const linked = (el as HTMLElement & {
                _linked_element?: {
                    linkedcontrol?: {
                        value?: unknown;
                        text?: unknown;
                        displaytext?: unknown;
                    };
                };
            })._linked_element?.linkedcontrol;
            return String(inputValue || linked?.value || linked?.displaytext || linked?.text || el.textContent || '')
                .replace(/\s+/g, ' ')
                .trim();
        }
        function cellIndex(id: string) {
            const match = id.match(/\.cell_-?\d+_(\d+)/);
            return match ? Number(match[1]) : 0;
        }

        const rows = Array.from(document.querySelectorAll(`div[id*="POP_ORDER_REG.form.grdOrderItem.body.gridrow_${rowIndex}"]`))
            .filter((el): el is HTMLElement => visible(el) && el.classList.contains('GridRowControl') && /\.body\.gridrow_\d+$/.test(el.id));
        const row = rows[rows.length - 1];
        if (!row) return [];

        const byIndex = new Map<number, string>();
        for (const cell of Array.from(row.querySelectorAll('[id*=".cell_"]'))) {
            if (!visible(cell)) continue;
            const text = textOf(cell);
            if (!text) continue;
            const index = cellIndex((cell as HTMLElement).id);
            const previous = byIndex.get(index) ?? '';
            if (!previous || text.length < previous.length) byIndex.set(index, text);
        }
        const maxIndex = byIndex.size ? Math.max(...Array.from(byIndex.keys())) : -1;
        return Array.from({ length: maxIndex + 1 }, (_, index) => byIndex.get(index) ?? '');
    }, rowIndex);
}

function orderItemProductCellValues(cells: string[]) {
    return [cells[2] ?? '', cells[3] ?? ''].map((cell) => normalizeText(cell)).filter(Boolean);
}

function orderItemRowHasProduct(cells: string[], item: HanwhaESalesOrderItem, previousCells?: string[]) {
    const rowText = normalizeText(cells.join(' '));
    const matchKeys = productMatchKeys(item);
    if (matchKeys.some((key) => key.length >= 3 && rowText.includes(key))) return true;

    const productCells = orderItemProductCellValues(cells);
    if (!productCells.length) return false;
    if (!previousCells) return false;

    const previousProductCells = orderItemProductCellValues(previousCells);
    return productCells.some((cell, index) => cell !== (previousProductCells[index] ?? ''));
}

async function waitForOrderItemProduct(page: Page, item: HanwhaESalesOrderItem, rowIndex: number, timeoutMs = 3_000, previousCells?: string[]) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const cells = await readOrderItemRowCells(page, rowIndex);
        if (orderItemRowHasProduct(cells, item, previousCells)) return true;
        await page.waitForTimeout(250);
    }
    return false;
}

async function fillGridCell(page: Page, selector: string, value: string, pressEnter = true) {
    await page.locator(selector).first().click({ force: true });
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText(value);
    if (pressEnter) await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
}

async function clickVisibleAlertOk(page: Page, timeoutMs = 8_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const target = await page.evaluate(() => {
            function visible(el: Element | null): el is HTMLElement {
                if (!el || !(el instanceof HTMLElement)) return false;
                const rect = el.getBoundingClientRect();
                const style = getComputedStyle(el);
                return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
            }
            function textOf(el: Element | null) {
                if (!el) return '';
                const inputValue = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : '';
                const linked = (el as HTMLElement & {
                    _linked_element?: {
                        linkedcontrol?: {
                            value?: unknown;
                            text?: unknown;
                            displaytext?: unknown;
                        };
                    };
                })._linked_element?.linkedcontrol;
                return String(inputValue || linked?.value || linked?.displaytext || linked?.text || el.textContent || '')
                    .replace(/\s+/g, ' ')
                    .trim();
            }
            function buttonTarget(el: HTMLElement) {
                const rect = el.getBoundingClientRect();
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }
            function isPositivePopupButton(el: HTMLElement) {
                const id = el.id.toLowerCase();
                const text = textOf(el);
                if (!id.includes('comalert') && !id.includes('comconfirm')) return false;
                if (id.endsWith(':icontext')) return false;
                if (id.includes('cancel') || id.includes('cancle') || id.includes('btnno') || id.endsWith('.form.btnno')) return false;
                return id.includes('.btnok')
                    || id.includes('.btnyes')
                    || id.includes('.btnconfirm')
                    || (el.className.toString().includes('btn_pop_yes') && text.length > 0)
                    || text === 'OK'
                    || text === 'OK';
            }
            const popupButtons = Array.from(document.querySelectorAll('div[id*="comALERT"], div[id*="comCONFIRM"], button[id*="comALERT"], button[id*="comCONFIRM"]'))
                .filter((el): el is HTMLElement => visible(el) && isPositivePopupButton(el))
                .sort((a, b) => {
                    const aRect = a.getBoundingClientRect();
                    const bRect = b.getBoundingClientRect();
                    return bRect.top - aRect.top || aRect.left - bRect.left;
                });
            if (popupButtons[0]) return buttonTarget(popupButtons[0]);

            const exactButtons = Array.from(document.querySelectorAll([
                'div[id*="comCONFIRM"][id$="form.divBtnConfirm.form.btnOk"]',
                'div[id*="comCONFIRM"][id$="form.divBtnConfirm.form.btnYes"]',
                'div[id*="comCONFIRM"][id$="form.divBtnConfirm.form.btnConfirm"]',
                'div[id*="comCONFIRM"][id$="form.divBtnConfirm.form.btnOK"]',
                'div[id*="comALERT"][id$="form.divBtnAlert.form.btnOk"]',
                'div[id*="comALERT"][id$="form.divBtnAlert.form.btnOK"]',
                'div[id*="comALERT"][id$="form.divBtnConfirm.form.btnOk"]',
                'div[id*="comALERT"][id$="form.divBtnConfirm.form.btnYes"]',
                'div[id*="comALERT"][id$="form.divBtnConfirm.form.btnConfirm"]',
                'div[id$="form.divBtnConfirm.form.btnOk"]',
                'div[id$="form.divBtnConfirm.form.btnYes"]',
                'div[id$="form.divBtnConfirm.form.btnConfirm"]',
                'div[id$="form.divBtnAlert.form.btnOk"]',
            ].join(',')))
                .filter((el): el is HTMLElement => visible(el))
                .sort((a, b) => {
                    const aRect = a.getBoundingClientRect();
                    const bRect = b.getBoundingClientRect();
                    return bRect.top - aRect.top || bRect.left - aRect.left;
                });
            const exactButton = exactButtons[0];
            if (exactButton) {
                return buttonTarget(exactButton);
            }
            const buttons = Array.from(document.querySelectorAll('div,button,[role="button"]'))
                .filter((el): el is HTMLElement => {
                    if (!visible(el)) return false;
                    const id = el.id.toLowerCase();
                    const text = textOf(el);
                    const isAlert = id.includes('comalert')
                        || id.includes('comconfirm')
                        || Boolean(el.closest('div[id*="comALERT"], div[id*="comCONFIRM"]'));
                    const isOk = id.includes('btnok')
                        || id.includes('btn_ok')
                        || id.includes('btnyes')
                        || id.includes('btnconfirm')
                        || text === 'OK'
                        || text.includes('OK')
                        || text === 'OK';
                    return isAlert && isOk;
                })
                .sort((a, b) => {
                    const az = Number(getComputedStyle(a).zIndex);
                    const bz = Number(getComputedStyle(b).zIndex);
                    return (Number.isFinite(bz) ? bz : 0) - (Number.isFinite(az) ? az : 0);
                });
            const button = buttons[0];
            if (!button) return null;
            return buttonTarget(button);
        });
        if (target) {
            await page.mouse.click(target.x, target.y, { delay: 80 });
            await page.waitForTimeout(900);
            return true;
        }
        await page.waitForTimeout(250);
    }
    return false;
}

async function clickVisibleAlertOkWithText(page: Page, timeoutMs = 8_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const target = await page.evaluate(() => {
            function visible(el: Element | null): el is HTMLElement {
                if (!el || !(el instanceof HTMLElement)) return false;
                const rect = el.getBoundingClientRect();
                const style = getComputedStyle(el);
                return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
            }
            function textOf(el: Element | null) {
                if (!el) return '';
                const inputValue = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : '';
                const linked = (el as HTMLElement & {
                    _linked_element?: {
                        linkedcontrol?: {
                            value?: unknown;
                            text?: unknown;
                            displaytext?: unknown;
                        };
                    };
                })._linked_element?.linkedcontrol;
                return String(inputValue || linked?.value || linked?.displaytext || linked?.text || el.textContent || '')
                    .replace(/\s+/g, ' ')
                    .trim();
            }
            function zIndexOf(el: HTMLElement) {
                const z = Number(getComputedStyle(el).zIndex);
                return Number.isFinite(z) ? z : 0;
            }
            function popupRootFor(el: HTMLElement) {
                const rootId = el.id.includes('.form.') ? el.id.slice(0, el.id.indexOf('.form.')) : '';
                return (rootId ? document.getElementById(rootId) : null) as HTMLElement | null;
            }
            function isPositivePopupButton(el: HTMLElement) {
                const id = el.id.toLowerCase();
                const text = textOf(el);
                if (!id.includes('comalert') && !id.includes('comconfirm')) return false;
                if (id.endsWith(':icontext')) return false;
                if (id.includes('cancel') || id.includes('cancle') || id.includes('btnno') || id.endsWith('.form.btnno')) return false;
                return id.includes('.btnok')
                    || id.includes('.btnyes')
                    || id.includes('.btnconfirm')
                    || (el.className.toString().includes('btn_pop_yes') && text.length > 0)
                    || text === 'OK'
                    || text === 'OK';
            }
            const directButtons = Array.from(document.querySelectorAll('div[id*="comALERT"], div[id*="comCONFIRM"], button[id*="comALERT"], button[id*="comCONFIRM"]'))
                .filter((el): el is HTMLElement => visible(el) && isPositivePopupButton(el))
                .sort((a, b) => {
                    const ar = a.getBoundingClientRect();
                    const br = b.getBoundingClientRect();
                    return zIndexOf(popupRootFor(b) ?? b) - zIndexOf(popupRootFor(a) ?? a)
                        || br.top - ar.top
                        || ar.left - br.left;
                });
            const directButton = directButtons[0] ?? null;
            if (directButton) {
                const rect = directButton.getBoundingClientRect();
                const root = popupRootFor(directButton) ?? directButton.closest('div[id*="comALERT"], div[id*="comCONFIRM"]') as HTMLElement | null;
                return {
                    text: textOf(root ?? directButton),
                    x: rect.left + rect.width / 2,
                    y: rect.top + rect.height / 2,
                };
            }
            const popups = Array.from(document.querySelectorAll('div[id*="comALERT"], div[id*="comCONFIRM"]'))
                .filter((el): el is HTMLElement => visible(el))
                .sort((a, b) => zIndexOf(b) - zIndexOf(a));
            const popup = popups[0] ?? null;
            if (!popup) return null;
            const buttons = Array.from(popup.querySelectorAll('div,button,[role="button"]'))
                .filter((el): el is HTMLElement => {
                    if (!visible(el)) return false;
                    const id = el.id.toLowerCase();
                    const text = textOf(el);
                    return id.includes('btnok')
                        || id.includes('btn_ok')
                        || id.includes('btnyes')
                        || id.includes('btnconfirm')
                        || text === 'OK'
                        || text.includes('OK')
                        || text === 'OK';
                })
                .sort((a, b) => {
                    const aRect = a.getBoundingClientRect();
                    const bRect = b.getBoundingClientRect();
                    return bRect.top - aRect.top || bRect.left - aRect.left;
                });
            const button = buttons[0] ?? null;
            if (!button) return null;
            const rect = button.getBoundingClientRect();
            return {
                text: textOf(popup),
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2,
            };
        });
        if (target) {
            await page.mouse.click(target.x, target.y, { delay: 80 });
            await page.waitForTimeout(900);
            return { clicked: true as const, text: target.text };
        }
        await page.waitForTimeout(250);
    }
    return { clicked: false as const, text: '' };
}

function isApprovalFailureMessage(message: string) {
    const text = message.replace(/\s+/g, '');
    return /fail|error|reject|failed|denied|반려|거부|실패|오류|에러|불가/i.test(text);
}

function isApprovalSuccessMessage(message: string) {
    const text = message.replace(/\s+/g, '');
    return /success|complete|completed|ok|done|승인|요청|완료|성공|처리|상신/i.test(text);
}

async function confirmPopupByEnterOrButton(page: Page, timeoutMs = 20_000) {
    const clicked = await clickBySuffixOrText(
        page,
        ['btn_ok', 'btnOk', 'btnConfirm', 'btnYes', 'btn_OK'],
        ['OK'],
        timeoutMs,
    ).then(() => true).catch(() => false);
    if (!clicked) {
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);
    }
}

async function readVisibleOrderNo(page: Page) {
    return page.evaluate(() => {
        function visible(el: Element | null): el is HTMLElement {
            if (!el || !(el instanceof HTMLElement)) return false;
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        }
        function textOf(el: Element | null) {
            if (!el) return '';
            const inputValue = el instanceof HTMLInputElement ? el.value : '';
            const linked = (el as HTMLElement & {
                _linked_element?: {
                    linkedcontrol?: {
                        value?: unknown;
                        text?: unknown;
                        displaytext?: unknown;
                    };
                };
            })._linked_element?.linkedcontrol;
            return String(inputValue || linked?.value || linked?.displaytext || linked?.text || el.textContent || '')
                .replace(/\s+/g, ' ')
                .trim();
        }

        return Array.from(document.querySelectorAll('input,div,span'))
            .filter(visible)
            .map(textOf)
            .map((text) => text.match(/\b\d{10}\b/)?.[0] ?? null)
            .find(Boolean) ?? null;
    }).catch(() => null);
}

async function readOrderNoFromOrderPopup(page: Page) {
    const orderNo = await page.evaluate(() => {
        function visible(el: Element | null): el is HTMLElement {
            if (!el || !(el instanceof HTMLElement)) return false;
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        }
        function textOf(el: Element | null) {
            if (!el) return '';
            const inputValue = el instanceof HTMLInputElement ? el.value : '';
            const linked = (el as HTMLElement & {
                _linked_element?: {
                    linkedcontrol?: {
                        value?: unknown;
                        text?: unknown;
                        displaytext?: unknown;
                    };
                };
            })._linked_element?.linkedcontrol;
            return String(inputValue || linked?.value || linked?.displaytext || linked?.text || el.textContent || '')
                .replace(/\s+/g, ' ')
                .trim();
        }
        const popup = Array.from(document.querySelectorAll('div[id*="POP_ORDER_REG"]')).find(visible);
        if (!popup) return null;

        const direct = Array.from(popup.querySelectorAll('input,div,span'))
            .filter(visible)
            .map(textOf)
            .map((text) => text.match(/\b\d{10}\b/)?.[0] ?? null)
            .find(Boolean);
        if (direct) return direct;

        const orderNoLabel = Array.from(popup.querySelectorAll('div,span'))
            .filter(visible)
            .find((el) => textOf(el) === 'orderNo') as HTMLElement | undefined;
        if (!orderNoLabel) return null;
        const labelRect = orderNoLabel.getBoundingClientRect();
        const candidates = Array.from(popup.querySelectorAll('input,div,span'))
            .filter((el): el is HTMLElement => {
                if (!visible(el) || el === orderNoLabel) return false;
                const rect = el.getBoundingClientRect();
                return Math.abs(rect.top - labelRect.top) < 16 && rect.left > labelRect.right;
            })
            .map((el) => {
                const rect = el.getBoundingClientRect();
                return { text: textOf(el), distance: rect.left - labelRect.right };
            })
            .sort((a, b) => a.distance - b.distance);
        return candidates
            .map((candidate) => candidate.text.match(/\b\d{10}\b/)?.[0] ?? null)
            .find(Boolean) ?? null;
    }).catch(() => null);
    return orderNo?.trim() || null;
}

async function closeOrderRegistrationPopup(page: Page) {
    await clickBySuffixOrText(page, [
        'POP_ORDER_REG.form.btnClose',
        'POP_ORDER_REG.titlebar.closebutton',
    ], [], 8_000);
    await page.waitForSelector('div[id*="POP_ORDER_REG"]', { state: 'hidden', timeout: 8_000 }).catch(() => undefined);
    await page.waitForTimeout(500);
}

async function saveOrderPopup(page: Page) {
    await clickBySuffixOrText(page, ['POP_ORDER_REG.form.btnSave'], ['save']);
    await confirmPopupByEnterOrButton(page, 20_000);
    await confirmPopupByEnterOrButton(page, 30_000);
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const orderNo = await readOrderNoFromOrderPopup(page) ?? await readVisibleOrderNo(page);
        if (orderNo) {
            await closeOrderRegistrationPopup(page);
            return orderNo;
        }
        await page.waitForTimeout(500);
    }
    await closeOrderRegistrationPopup(page).catch(() => undefined);
    return null;
}

async function fillOrderListDateRange(page: Page, orderDateFromYmd: string, orderDateToYmd = orderDateFromYmd) {
    const selectors = await page.evaluate(() => {
        function visible(el: Element | null): el is HTMLElement {
            return !!el && el instanceof HTMLElement && el.offsetParent !== null;
        }

        const exactIds = [
            'form.divWork.form.divSearch.form.calFrDt.calendaredit:input',
            'form.divWork.form.divSearch.form.calToDt.calendaredit:input',
        ];
        const exact = exactIds
            .map((suffix) => Array.from(document.querySelectorAll(`input[id$="${suffix}"]`))
                .find((el): el is HTMLInputElement => el instanceof HTMLInputElement && visible(el)))
            .filter((el): el is HTMLInputElement => !!el);
        if (exact.length >= 2) return exact.slice(0, 2).map((el) => `input[id="${el.id}"]`);

        const candidates = Array.from(document.querySelectorAll('input[id$="calendaredit:input"], input.nexainput'))
            .filter((el): el is HTMLInputElement => {
                if (!(el instanceof HTMLInputElement) || !visible(el)) return false;
                if (el.id.includes('POP_ORDER_REG') || el.id.includes('frm_LoginOTP')) return false;
                const id = el.id.toLowerCase();
                if (!id.includes('framesetwork') || !id.includes('winesdmy-10-400')) return false;
                if (id.includes('popup') || id.includes('pop_')) return false;
                return id.includes('date') || id.includes('cal') || id.includes('dt');
            })
            .map((el) => {
                const rect = el.getBoundingClientRect();
                return { id: el.id, left: rect.left, top: rect.top };
            })
            .sort((a, b) => a.top - b.top || a.left - b.left);

        const top = candidates[0]?.top;
        const firstRow = top == null ? candidates : candidates.filter((candidate) => Math.abs(candidate.top - top) < 20);
        return firstRow
            .sort((a, b) => a.left - b.left)
            .slice(0, 2)
            .map((candidate) => `input[id="${candidate.id}"]`);
    });

    if (selectors.length < 2) {
        throw new Error(`???????꾩룆梨???耀붾굝????????⑤챶裕???????嚥???癲????沅걔?輿삳뿫遊?????????????살몝??? 2???????????? ????釉먮폁???????? ????釉먮폁??????????????????? (count=${selectors.length})`);
    }

    await fillInput(page, selectors[0], orderDateFromYmd);
    await page.keyboard.press('Tab').catch(() => undefined);
    await page.waitForTimeout(100);
    await fillInput(page, selectors[1], orderDateToYmd);
    await page.waitForTimeout(150);
}

async function requestApprovalForTodayOrders(page: Page, orderDateYmd: string, orderNo?: string | null) {
    await prepareApprovalForTodayOrders(page, orderDateYmd, orderNo);
    await clickNexacro(page, [
        'div[id*="winESDMY-10-400"][id$="form.divWork.form.btnReqOk"]',
        'div[id*="winESDMY-10-400"][id*="form.divWork.form.btnReqOk"]',
        'div[id$="form.divWork.form.btnReqOk"]',
        'div[id*="form.divWork.form.btnReqOk"]',
    ].join(','), 10_000);
    const requestConfirm = await clickVisibleAlertOkWithText(page, 20_000);
    if (!requestConfirm.clicked) {
        throw new Error('??????e-Sales ??????????????????븐뼐??????????????????諛몃마嶺뚮?????????雍???????釉먮폁???????? ????釉먮폁???????????????????');
    }
    if (isApprovalFailureMessage(requestConfirm.text)) {
        throw new Error(`??????e-Sales ??????????????????????怨뺤름?? ${requestConfirm.text}`);
    }

    let successText = '';
    let resultPopupClicked = false;
    for (let i = 0; i < 3; i += 1) {
        const resultPopup = await clickVisibleAlertOkWithText(page, i === 0 ? 15_000 : 5_000);
        if (!resultPopup.clicked) break;
        resultPopupClicked = true;
        if (isApprovalFailureMessage(resultPopup.text)) {
            throw new Error(`??????e-Sales ??????????????????????怨뺤름?? ${resultPopup.text}`);
        }
        if (isApprovalSuccessMessage(resultPopup.text)) {
            successText = resultPopup.text;
        }
    }
    const statusConfirmed = orderNo?.trim()
        ? await waitForApprovalRequestedStatus(page, orderNo)
        : false;
    if (successText || statusConfirmed || resultPopupClicked) return;
    if (!successText && !statusConfirmed) {
        throw new Error('e-Sales 승인요청 완료 여부를 확인하지 못했습니다. e-Sales 주문 진행 조회에서 상태를 확인해주세요.');
    }
}

async function waitForApprovalRequestedStatus(page: Page, orderNo: string, timeoutMs = 15_000) {
    const targetOrderNo = orderNo.trim();
    if (!targetOrderNo) return false;

    return page.waitForFunction((targetOrderNo) => {
        function visible(el: Element | null): el is HTMLElement {
            if (!el || !(el instanceof HTMLElement)) return false;
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        }
        function textOf(el: Element | null) {
            return (el?.textContent || '').replace(/\s+/g, ' ').trim();
        }

        const rows = Array.from(document.querySelectorAll('div[id*="winESDMY-10-400"][id*="form.divWork.form.grdMain.body.gridrow_"]'))
            .filter((el): el is HTMLElement => el instanceof HTMLElement && visible(el) && /\.body\.gridrow_\d+$/.test(el.id));
        return rows.some((row) => {
            const rowText = textOf(row);
            const cells = Array.from(row.querySelectorAll('div[id*=".cell_"]'))
                .filter(visible)
                .map(textOf);
            const isMatch = cells.includes(targetOrderNo) || rowText.includes(targetOrderNo);
            const statusText = cells.join(' ') || rowText;
            return isMatch && (
                /OK|approved|complete|completed|request|done/i.test(statusText)
                || /승인|요청|완료|성공|처리|상신/.test(statusText)
            );
        });
    }, targetOrderNo, { timeout: timeoutMs }).then(() => true).catch(() => false);
}

async function prepareApprovalForTodayOrders(page: Page, orderDateYmd: string, orderNo?: string | null) {
    await focusNexacroWindowTab(page, 'winESDMY-10-400');
    await clickMainSearchButtonAndWaitForRows(page, orderDateYmd, orderDateYmd, orderNo?.trim() || null);
    if (orderNo?.trim()) {
        await clickMainGridOrderCheckbox(page, orderNo);
    } else {
        await clickMainGridHeaderCheckbox(page);
    }
    await page.waitForTimeout(500);
}

async function clickMainSearchButtonAndWaitForRows(
    page: Page,
    orderDateFromYmd: string,
    orderDateToYmd = orderDateFromYmd,
    expectedOrderNo?: string | null,
) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        await focusNexacroWindowTab(page, 'winESDMY-10-400');
        await fillOrderListDateRange(page, orderDateFromYmd, orderDateToYmd);
        await clickMainSearchButton(page);
        const found = expectedOrderNo
            ? await page.waitForFunction((targetOrderNo) => {
                function visible(el: Element | null): el is HTMLElement {
                    if (!el || !(el instanceof HTMLElement)) return false;
                    const rect = el.getBoundingClientRect();
                    const style = getComputedStyle(el);
                    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
                }
                return Array.from(document.querySelectorAll('div[id*="winESDMY-10-400"][id*="form.divWork.form.grdMain.body.gridrow_"]'))
                    .some((row) => visible(row) && (row.textContent || '').includes(targetOrderNo));
            }, expectedOrderNo, { timeout: attempt === 0 ? 12_000 : 6_000 }).then(() => true).catch(() => false)
            : await page.waitForSelector('div[id*="winESDMY-10-400"][id*="form.divWork.form.grdMain.body.gridrow_"]', {
                state: 'attached',
                timeout: attempt === 0 ? 8_000 : 4_000,
            }).then(() => true).catch(() => false);
        if (found) return;
        await page.waitForTimeout(500);
    }
    if (expectedOrderNo) {
        throw new Error(`???????꾩룆梨???耀붾굝????????⑤챶裕???????嚥???癲????沅걔?輿삳뿫遊?????????????????????????꾩룆梨???耀붾굝????????⑤챶裕????????${expectedOrderNo} ??????嚥???癲??轅붽틓?????獄쎼끇??????釉먮폁???????? ????釉먮폁???????????????????`);
    }
    throw new Error('???????꾩룆梨???耀붾굝????????⑤챶裕???????嚥???癲????沅걔?輿삳뿫遊?????????????살몝????????????????????????????꾩룆梨???耀붾굝????????⑤챶裕???????????????????釉먮폇?????썹땟戮?눀筌롢룗爰??⑸역?????????????????????? ??????關?쒎첎?嫄????????');
}

async function clickMainSearchButton(page: Page) {
    await clickNexacro(page, [
        'div[id*="winESDMY-10-400"][id$="form.divTitle.form.btnSearch"]',
        'div[id*="winESDMY-10-400"][id*="form.divTitle.form.btnSearch"]',
    ].join(','), 10_000);
    await page.waitForTimeout(800);
}

async function clickMainGridHeaderCheckbox(page: Page) {
    const clicked = await page.evaluate(() => {
        function visible(el: Element | null): el is HTMLElement {
            return !!el && el instanceof HTMLElement && el.offsetParent !== null;
        }
        function fireMouse(el: HTMLElement) {
            for (const type of ['mouseover', 'mousemove', 'mousedown', 'mouseup', 'click']) {
                el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
            }
        }
        function clickElement(el: HTMLElement) {
            const comp = (el as HTMLElement & {
                _linked_element?: { linkedcontrol?: { click?: () => void } };
            })._linked_element?.linkedcontrol;
            if (typeof comp?.click === 'function') comp.click();
            else fireMouse(el);
        }

        const selectors = [
            'div[id*="winESDMY-10-400"][id$="form.divWork.form.grdMain.head.gridrow_-1.cell_-1_1.cellcheckbox"]',
            'div[id*="winESDMY-10-400"][id*="form.divWork.form.grdMain.head.gridrow_-1.cell_-1_1.cellcheckbox"]',
            'div[id*="winESDMY-10-400"][id$="form.divWork.form.grdMain.head.gridrow_-1.cell_-1_1"]',
            'div[id*="winESDMY-10-400"][id*="form.divWork.form.grdMain.head.gridrow_-1.cell_-1_1"]',
        ];
        const checkbox = selectors
            .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
            .find(visible);
        if (!checkbox) return false;

        const checkedHost = checkbox.closest('[aria-checked]') as HTMLElement | null;
        if (checkedHost?.getAttribute('aria-checked') === 'true') return true;
        clickElement(checkbox);
        return true;
    });
    if (clicked) return;

    await forceClickFirst(page, [
        'div[id*="winESDMY-10-400"][id*="form.divWork.form.grdMain.head.gridrow_-1.cell_-1_1.cellcheckbox"]',
        'div[id*="winESDMY-10-400"][id*="form.divWork.form.grdMain.head.gridrow_-1.cell_-1_1"]',
    ], 10_000);
}

async function clickMainGridOrderCheckbox(page: Page, orderNo: string) {
    const targetOrderNo = orderNo.trim();
    if (!targetOrderNo) {
        await clickMainGridHeaderCheckbox(page);
        return;
    }

    async function readRows() {
        return page.evaluate((targetOrderNo) => {
            function visible(el: Element | null): el is HTMLElement {
                if (!el || !(el instanceof HTMLElement)) return false;
                const rect = el.getBoundingClientRect();
                const style = getComputedStyle(el);
                return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
            }
            function textOf(el: Element | null) {
                return (el?.textContent || '').replace(/\s+/g, ' ').trim();
            }
            function checked(checkbox: HTMLElement) {
                const host = checkbox.closest('[aria-checked]') as HTMLElement | null;
                return (host ?? checkbox).getAttribute('aria-checked') === 'true';
            }
            function centerOf(el: HTMLElement | null) {
                if (!el) return null;
                const rect = el.getBoundingClientRect();
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }

            const rows = Array.from(document.querySelectorAll('div[id*="winESDMY-10-400"][id*="form.divWork.form.grdMain.body.gridrow_"]'))
                .filter((el): el is HTMLElement => el instanceof HTMLElement && visible(el) && /\.body\.gridrow_\d+$/.test(el.id));

            return rows.map((row) => {
                const rowText = textOf(row);
                const cells = Array.from(row.querySelectorAll('div[id*=".cell_"]'))
                    .filter(visible)
                    .map(textOf);
                const checkbox = Array.from(row.querySelectorAll('div[id*=".cell_"][id*="cellcheckbox"]'))
                    .find((el): el is HTMLElement => el instanceof HTMLElement && visible(el)) ?? null;
                const checkboxCell = checkbox?.closest('div[id*=".cell_"]') as HTMLElement | null;
                return {
                    rowText,
                    isMatch: cells.includes(targetOrderNo) || rowText.includes(targetOrderNo),
                    checked: checkbox ? checked(checkbox) : false,
                    clickCenter: centerOf(checkboxCell) ?? centerOf(checkbox),
                };
            });
        }, targetOrderNo);
    }

    async function setCheckboxState(center: { x: number; y: number }, desiredChecked: boolean) {
        await page.mouse.click(center.x, center.y);
        await page.waitForTimeout(150);

        let states = await readRows();
        const focused = states.find((row) => row.clickCenter && Math.abs(row.clickCenter.x - center.x) < 1 && Math.abs(row.clickCenter.y - center.y) < 1);
        if (focused?.checked === desiredChecked) return;

        await page.keyboard.press('Space');
        await page.waitForTimeout(300);

        states = await readRows();
        const afterSpace = states.find((row) => row.clickCenter && Math.abs(row.clickCenter.x - center.x) < 1 && Math.abs(row.clickCenter.y - center.y) < 1);
        if (afterSpace?.checked !== desiredChecked) {
            await page.keyboard.press('Space');
            await page.waitForTimeout(300);
        }
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const rowStates = await readRows();

        const matched = rowStates.find((row) => row.isMatch && row.clickCenter);
        if (!matched) {
            await page.waitForTimeout(500);
            continue;
        }
        const matchedCenter = matched.clickCenter;
        if (!matchedCenter) {
            await page.waitForTimeout(500);
            continue;
        }

        for (const row of rowStates) {
            if (!row.clickCenter || row.isMatch || !row.checked) continue;
            await setCheckboxState(row.clickCenter, false);
        }

        if (!matched.checked) {
            await setCheckboxState(matchedCenter, true);
        }
        await page.waitForTimeout(500);

        const verified = await page.evaluate((targetOrderNo) => {
            function visible(el: Element | null): el is HTMLElement {
                if (!el || !(el instanceof HTMLElement)) return false;
                const rect = el.getBoundingClientRect();
                const style = getComputedStyle(el);
                return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
            }
            function textOf(el: Element | null) {
                return (el?.textContent || '').replace(/\s+/g, ' ').trim();
            }
            function checked(checkbox: HTMLElement) {
                const host = checkbox.closest('[aria-checked]') as HTMLElement | null;
                return (host ?? checkbox).getAttribute('aria-checked') === 'true';
            }
            const rows = Array.from(document.querySelectorAll('div[id*="winESDMY-10-400"][id*="form.divWork.form.grdMain.body.gridrow_"]'))
                .filter((el): el is HTMLElement => el instanceof HTMLElement && visible(el) && /\.body\.gridrow_\d+$/.test(el.id));
            const states = rows.map((row) => {
                const rowText = textOf(row);
                const cells = Array.from(row.querySelectorAll('div[id*=".cell_"]')).filter(visible).map(textOf);
                const checkbox = Array.from(row.querySelectorAll('div[id*=".cell_"][id*="cellcheckbox"]'))
                    .find((el): el is HTMLElement => el instanceof HTMLElement && visible(el));
                return {
                    rowText,
                    isMatch: cells.includes(targetOrderNo) || rowText.includes(targetOrderNo),
                    checked: checkbox ? checked(checkbox) : false,
                };
            });
            return {
                matched: states.find((row) => row.isMatch) ?? null,
                checkedRows: states.filter((row) => row.checked).map((row) => row.rowText),
            };
        }, targetOrderNo);

        if (verified.matched?.checked && verified.checkedRows.length === 1) return;
        throw new Error(`???????꾩룆梨???耀붾굝????????⑤챶裕????????${targetOrderNo} ?????????????????????????? ??????關?쒎첎?嫄???????? ???????????????????? ${verified.checkedRows.length}`);
    }

    throw new Error(`???????꾩룆梨???耀붾굝????????⑤챶裕????????${targetOrderNo} ??????嚥???癲??轅붽틓?????獄쎼끇?????????꾩룆梨???耀붾굝????????⑤챶裕???????????????????釉먮폇?????썹땟戮?눀筌롢룗爰??⑸역??????????????釉먮폁???????? ????釉먮폁???????????????????`);
}

async function findAndOpenOrderStatusRow(page: Page, shipToName: string) {
    const target = normalizeOrderMatchText(shipToName);
    if (!target) throw new Error('?????븐뼐??????????쇰뮡??袁④텛??????거??????嚥싲갭큔?댁빆??????????????????嚥싲갭큔???????????꾩룆梨???耀붾굝????????⑤챶裕???????濾??????????븐뼐????????????????????嚥싲갭큔?????????????ㅼ굣塋?');

    const matched = await page.evaluate((targetText) => {
        function visible(el: Element | null): el is HTMLElement {
            return !!el && el instanceof HTMLElement && el.offsetParent !== null;
        }
        function normalize(value: string | null | undefined) {
            return (value ?? '')
                .replace(/[\s()[\]{}.,/\\_-]/g, '')
                .toUpperCase();
        }
        function textOf(el: Element | null) {
            return (el?.textContent || '').replace(/\s+/g, ' ').trim();
        }

        const rows = Array.from(document.querySelectorAll('div[id*="winESDMY-10-400"][id*="form.divWork.form.grdMain.body.gridrow_"]'))
            .filter((el): el is HTMLElement => el instanceof HTMLElement && visible(el));

        const candidates = rows.map((row) => {
            const cells = Array.from(row.querySelectorAll('div[id*=".cell_"]'))
                .filter(visible)
                .map(textOf);
            const normalizedCells = cells.map(normalize);
            const rowText = textOf(row);
            const normalizedRowText = normalize(rowText);
            const exactCell = normalizedCells.some((cell) => cell === targetText);
            const looseCell = normalizedCells.some((cell) =>
                cell.length >= 4 && (cell.includes(targetText) || targetText.includes(cell))
            );
            const rowHit = normalizedRowText.includes(targetText);
            const score = exactCell ? 100 : looseCell ? 80 : rowHit ? 60 : 0;
            const nonEmptyCells = cells.filter(Boolean);
            return {
                id: row.id,
                rowText,
                cells,
                status: nonEmptyCells.at(-1) ?? '',
                score,
            };
        }).filter((row) => row.score > 0)
            .sort((a, b) => b.score - a.score);

        return candidates[0] ?? null;
    }, target);

    if (!matched) {
        throw new Error(`?????????????????????꾩룆梨???耀붾굝????????⑤챶裕???????????????????釉먮폇?????썹땟戮?눀筌롢룗爰??⑸역???????????????븐뼐??????????쇰뮡??袁④텛??????거??????嚥싲갭큔?댁빆???????????"${shipToName}"????????嚥???癲????繹먮굞議??????留⑶뜮??????猷몄굡???????????嚥???癲??轅붽틓?????獄쎼끇??????釉먮폁???????? ????釉먮폁???????????????????`);
    }
    if (!matched.status) {
        throw new Error(`?????븐뼐??????????쇰뮡??袁④텛??????거??????嚥싲갭큔?댁빆???????????"${shipToName}" ??? ????釉먮폁????????????????????釉먮폁???????????????????泥?????????꾩룆梨???耀붾굝????????⑤챶裕???????濾???????癲꾧퀗?앮틦??????????쎛 ????????????????????????ㅼ굣塋?`);
    }

    await page.locator(`div[id="${matched.id}"]`).first().dblclick({ force: true, timeout: 5_000 }).catch(async () => {
        await page.evaluate((rowId) => {
            const row = document.getElementById(rowId);
            if (!(row instanceof HTMLElement)) return;
            for (const type of ['mousedown', 'mouseup', 'click', 'dblclick']) {
                row.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
            }
        }, matched.id);
    });
    await page.waitForTimeout(800);
    await closeVisibleESalesPopups(page);
    return matched;
}

function normalizeStatusMatchText(value: string | null | undefined) {
    return (value ?? '')
        .replace(/\s+/g, '')
        .replace(/[()[\]{}.,/\\_-]/g, '')
        .toUpperCase();
}

function datesEqual(left: string | null | undefined, right: string | null | undefined) {
    return (left ?? '').replace(/\D/g, '') === (right ?? '').replace(/\D/g, '');
}

type OrderStatusListRow = {
    id: string;
    rowText: string;
    cells: string[];
    status: string;
    score: number;
};

type OrderDetailLine = {
    itemCode: string;
    materialName: string;
    quantity: number | null;
    deliveryDate: string;
    cells: string[];
};

async function findOrderStatusRows(page: Page, shipToName: string) {
    const target = normalizeOrderMatchText(shipToName);
    if (!target) throw new Error('?????븐뼐??????????쇰뮡??袁④텛??????거??????嚥싲갭큔?댁빆??????????????????嚥싲갭큔???????????꾩룆梨???耀붾굝????????⑤챶裕???????濾??????????븐뼐????????????????????嚥싲갭큔?????????????ㅼ굣塋?');

    const candidates = await page.evaluate((targetText) => {
        function visible(el: Element | null): el is HTMLElement {
            return !!el && el instanceof HTMLElement && el.offsetParent !== null;
        }
        function normalize(value: string | null | undefined) {
            return (value ?? '')
                .replace(/[\s()[\]{}.,/\\_-]/g, '')
                .toUpperCase();
        }
        function textOf(el: Element | null) {
            return (el?.textContent || '').replace(/\s+/g, ' ').trim();
        }
        function cellIndex(id: string) {
            const match = id.match(/\.cell_-?\d+_(\d+)$/);
            return match ? Number(match[1]) : 0;
        }
        function isGridCell(el: Element | null): el is HTMLElement {
            return !!el
                && el instanceof HTMLElement
                && visible(el)
                && el.classList.contains('GridCellControl')
                && /\.cell_\d+_\d+$/.test(el.id);
        }

        const rows = Array.from(document.querySelectorAll('div[id*="winESDMY-10-400"][id*="form.divWork.form.grdMain.body.gridrow_"]'))
            .filter((el): el is HTMLElement => el instanceof HTMLElement && visible(el) && /\.body\.gridrow_\d+$/.test(el.id));

        return rows.map((row) => {
            const cells = Array.from(row.querySelectorAll('div[id*=".cell_"]'))
                .filter(isGridCell)
                .sort((a, b) => cellIndex(a.id) - cellIndex(b.id))
                .map(textOf);
            const normalizedCells = cells.map(normalize);
            const rowText = textOf(row);
            const normalizedRowText = normalize(rowText);
            const exactCell = normalizedCells.some((cell) => cell === targetText);
            const looseCell = normalizedCells.some((cell) =>
                cell.length >= 4 && (cell.includes(targetText) || targetText.includes(cell))
            );
            const rowHit = normalizedRowText.includes(targetText);
            const score = exactCell ? 100 : looseCell ? 80 : rowHit ? 60 : 0;
            const nonEmptyCells = cells.filter(Boolean);
            return {
                id: row.id,
                rowText,
                cells,
                status: cells[12] || nonEmptyCells.at(-1) || '',
                score,
            };
        }).filter((row) => row.score > 0)
            .sort((a, b) => b.score - a.score);
    }, target);

    if (candidates.length === 0) {
        throw new Error(`?????????????????????꾩룆梨???耀붾굝????????⑤챶裕???????????????????釉먮폇?????썹땟戮?눀筌롢룗爰??⑸역???????????????븐뼐??????????쇰뮡??袁④텛??????거??????嚥싲갭큔?댁빆???????????"${shipToName}"????????嚥???癲????繹먮굞議??????留⑶뜮??????猷몄굡???????????嚥???癲??轅붽틓?????獄쎼끇??????釉먮폁???????? ????釉먮폁???????????????????`);
    }
    return candidates as OrderStatusListRow[];
}

async function openOrderStatusDetailPopup(page: Page, rowId: string) {
    await closeVisibleESalesPopups(page);
    await page.locator(`div[id="${rowId}"]`).first().dblclick({ force: true, timeout: 5_000 }).catch(async () => {
        await page.evaluate((rowId) => {
            const row = document.getElementById(rowId);
            if (!(row instanceof HTMLElement)) return;
            const rect = row.getBoundingClientRect();
            const options = {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: rect.left + rect.width / 2,
                clientY: rect.top + rect.height / 2,
            };
            for (const type of ['mouseover', 'mousemove', 'mousedown', 'mouseup', 'click', 'mousedown', 'mouseup', 'dblclick']) {
                row.dispatchEvent(new MouseEvent(type, options));
            }
        }, rowId);
    });
    await page.waitForFunction(() => {
        function visible(el: Element | null): el is HTMLElement {
            return !!el && el instanceof HTMLElement && el.offsetParent !== null;
        }
        return Array.from(document.querySelectorAll('div.Grid[id*="POP_ORDER_REG"][id*="grdOrderItem"]')).some(visible);
    }, null, { timeout: 8_000 });
}

async function readOrderStatusDetailLines(page: Page): Promise<OrderDetailLine[]> {
    return page.evaluate(() => {
        function visible(el: Element | null): el is HTMLElement {
            return !!el && el instanceof HTMLElement && el.offsetParent !== null;
        }
        function textOf(el: Element | null) {
            return (el?.textContent || '').replace(/\s+/g, ' ').trim();
        }
        function cellIndex(id: string) {
            const match = id.match(/\.cell_-?\d+_(\d+)$/);
            return match ? Number(match[1]) : 0;
        }
        function rowIndex(id: string) {
            const match = id.match(/gridrow_(-?\d+)/);
            return match ? Number(match[1]) : 0;
        }
        function isGridCell(el: Element | null): el is HTMLElement {
            return !!el
                && el instanceof HTMLElement
                && visible(el)
                && el.classList.contains('GridCellControl')
                && /\.cell_\d+_\d+$/.test(el.id);
        }

        const grid = Array.from(document.querySelectorAll('div.Grid[id*="POP_ORDER_REG"][id*="grdOrderItem"]'))
            .find((el): el is HTMLElement => el instanceof HTMLElement && visible(el));
        if (!grid) return [];
        const rows = Array.from(document.querySelectorAll('div.GridRowControl[id*="POP_ORDER_REG"][id*="grdOrderItem.body.gridrow_"]'))
            .filter((el): el is HTMLElement =>
                el instanceof HTMLElement
                && visible(el)
                && el.id.startsWith(`${grid.id}.body.gridrow_`)
                && /\.body\.gridrow_\d+$/.test(el.id)
            )
            .sort((a, b) => rowIndex(a.id) - rowIndex(b.id));

        return rows.map((row) => {
            const cells = Array.from(row.querySelectorAll('div[id*=".cell_"]'))
                .filter(isGridCell)
                .sort((a, b) => cellIndex(a.id) - cellIndex(b.id))
                .map(textOf);
            const numeric = Number((cells[4] ?? '').replace(/,/g, '').trim());
            return {
                itemCode: cells[2] ?? '',
                materialName: cells[3] ?? '',
                quantity: Number.isFinite(numeric) ? numeric : null,
                deliveryDate: cells[10] ?? '',
                cells,
            };
        }).filter((row) => row.cells.some(Boolean));
    });
}

async function waitForOrderStatusDetailLines(page: Page, timeoutMs = 8_000) {
    const started = Date.now();
    let lastLines: OrderDetailLine[] = [];
    while (Date.now() - started < timeoutMs) {
        lastLines = await readOrderStatusDetailLines(page);
        if (lastLines.length > 0) return lastLines;
        await page.waitForTimeout(250);
    }
    return lastLines;
}

function orderStatusItemsMatch(actualLines: OrderDetailLine[], expectedItems: HanwhaESalesOrderStatusItem[], deliveryDateYmd: string) {
    const used = new Set<number>();
    return expectedItems.every((expected) => {
        const expectedMaterial = normalizeStatusMatchText(expected.materialName);
        const expectedCode = normalizeStatusMatchText(expected.itemCode);
        const matchIndex = actualLines.findIndex((line, index) => {
            if (used.has(index)) return false;
            const materialMatches = expectedMaterial
                ? normalizeStatusMatchText(line.materialName) === expectedMaterial
                : false;
            const codeMatches = expectedCode
                ? normalizeStatusMatchText(line.itemCode) === expectedCode
                : false;
            const quantityMatches = line.quantity != null
                && Math.abs(line.quantity - expected.quantity) < 0.001;
            const dateMatches = datesEqual(line.deliveryDate, deliveryDateYmd);
            return (materialMatches || codeMatches) && quantityMatches && dateMatches;
        });
        if (matchIndex < 0) return false;
        used.add(matchIndex);
        return true;
    });
}

async function findMatchingOrderStatusRow(page: Page, input: {
    shipToName: string;
    deliveryDateYmd: string;
    items: HanwhaESalesOrderStatusItem[];
}) {
    const candidates = await findOrderStatusRows(page, input.shipToName);
    const checkedSummaries: string[] = [];
    for (const candidate of candidates) {
        if (!candidate.status) continue;
        await openOrderStatusDetailPopup(page, candidate.id);
        const detailLines = await waitForOrderStatusDetailLines(page);
        const matched = orderStatusItemsMatch(detailLines, input.items, input.deliveryDateYmd);
        checkedSummaries.push(candidate.status + ': ' + (detailLines.map((line) => line.materialName + '/' + line.quantity + '/' + line.deliveryDate).join(', ') || 'no detail'));
        await closeVisibleESalesPopups(page);
        if (matched) return candidate;
    }

    throw new Error(`?????븐뼐??????????쇰뮡??袁④텛??????거??????嚥싲갭큔?댁빆???????????"${input.shipToName}" ??????熬곣뫖利당춯??쎾퐲????????釉먮폁??????????????????????遺얘턁筌?（??????臾믨땀壤???????饔낅떽??????????????????????嚥???癲?????????嚥???癲????繹먮굞議??????留⑶뜮??????猷몄굡????????????꾩룆梨???耀붾굝????????⑤챶裕???????釉먮폁???????? ????釉먮폁??????????????????? ?????븐뼐??????????????????熬곣뫖利당춯??쎾퐲??? ${checkedSummaries.join(' | ')}`);
}

async function checkOrderStatusFromOrderList(page: Page, input: {
    orderDateFromYmd: string;
    orderDateToYmd: string;
    shipToName: string;
    deliveryDateYmd: string;
    items: HanwhaESalesOrderStatusItem[];
}) {
    await openOrderInputList(page);
    await clickMainSearchButtonAndWaitForRows(page, input.orderDateFromYmd, input.orderDateToYmd);
    return findMatchingOrderStatusRow(page, input);
}

async function fillProductDetailsAfterSelection(page: Page, item: HanwhaESalesOrderItem, rowIndex: number, deliveryDateYmd: string) {
    await fillGridCell(page, `div[id*="POP_ORDER_REG.form.grdOrderItem.body.gridrow_${rowIndex}.cell_${rowIndex}_4"]`, String(item.quantity), false);
    await pressTab(page, 4);
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText(deliveryDateYmd);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
}

async function pressTab(page: Page, count: number) {
    for (let i = 0; i < count; i += 1) {
        await page.keyboard.press('Tab');
        await page.waitForTimeout(120);
    }
}

async function pressShiftTab(page: Page, count: number) {
    await page.keyboard.down('Shift');
    try {
        for (let i = 0; i < count; i += 1) {
            await page.keyboard.press('Tab');
            await page.waitForTimeout(120);
        }
    } finally {
        await page.keyboard.up('Shift');
    }
}

async function fillProductRow(page: Page, item: HanwhaESalesOrderItem, rowIndex: number, deliveryDateYmd: string) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        await selectProduct(page, item, rowIndex);
        await fillProductDetailsAfterSelection(page, item, rowIndex, deliveryDateYmd);
        if (await waitForOrderItemProduct(page, item, rowIndex, 2_000)) return;

        await clickVisibleAlertOk(page, 2_000).catch(() => undefined);
    }

    const cells = await readOrderItemRowCells(page, rowIndex).catch(() => []);
    throw new ManualProductSelectionRequiredError(
        `e-Sales product row was reset after entering details. row=${rowIndex + 1}, itemCode=${item.itemCode}, cells=${cells.join(' | ')}`,
        rowIndex,
    );
}

async function fillOrderItems(page: Page, input: HanwhaESalesOrderInput) {
    for (let i = 0; i < input.items.length; i += 1) {
        await clickBySuffixOrText(page, ['POP_ORDER_REG.form.btnAdd'], ['???????ш끽紐???']);
        await page.waitForSelector(`div[id*="POP_ORDER_REG.form.grdOrderItem.body.gridrow_${i}"]`, { state: 'attached', timeout: 15_000 });
        await page.waitForTimeout(150);
    }
    const deliveryDateYmd = formatYmd(input.deliveryDateYmd);
    for (let i = 0; i < input.items.length; i += 1) {
        await fillProductRow(page, input.items[i], i, deliveryDateYmd);
    }
}

async function resumeOrderAfterProductSelection(page: Page, input: HanwhaESalesOrderInput, rowIndex: number) {
    const deliveryDateYmd = formatYmd(input.deliveryDateYmd);
    await fillProductDetailsAfterSelection(page, input.items[rowIndex], rowIndex, deliveryDateYmd);
    for (let i = rowIndex + 1; i < input.items.length; i += 1) {
        await fillProductRow(page, input.items[i], i, deliveryDateYmd);
    }
    return saveOrderPopup(page);
}

async function automateOrder(page: Page, input: HanwhaESalesOrderInput) {
    await openNewOrderPopup(page);
    await selectShipTo(page, input);
    await fillOrderHeader(page, input);
    await fillOrderItems(page, input);
    return saveOrderPopup(page);
}

export async function openHanwhaESalesLogin(input: {
    username: string | null;
    password: string | null;
}): Promise<HanwhaESalesLoginResult> {
    if (!input.username || !input.password) {
        return { ok: false, error: '한화 e-Sales 계정 정보가 설정되지 않았습니다.' };
    }
    if (process.platform !== 'win32') {
        return { ok: false, error: '한화 e-Sales 자동화는 Windows 업무 PC에서만 실행할 수 있습니다.' };
    }

    try {
        const page = await getESalesPage();
        const otpClicked = await loginAndSendOtp(page, { username: input.username, password: input.password });
        return {
            ok: true,
            message: otpClicked
                ? '한화 e-Sales 로그인 정보를 입력하고 OTP 전송을 눌렀습니다. 인증번호 입력 후 계속 진행해주세요.'
                : '한화 e-Sales 창이 준비되어 있습니다.',
        };
    } catch (error) {
        return {
            ok: false,
            error: displayErrorMessage(error, '한화 e-Sales 창을 준비하는 중 오류가 발생했습니다.'),
        };
    }
}

export async function openHanwhaESalesOrder(input: HanwhaESalesOrderInput): Promise<HanwhaESalesLoginResult> {
    if (!input.username || !input.password) {
        return { ok: false, error: '한화 e-Sales 계정 정보가 설정되지 않았습니다.' };
    }
    if (process.platform !== 'win32') {
        return { ok: false, error: '한화 e-Sales 자동 주문은 Windows 업무 PC에서만 실행할 수 있습니다.' };
    }
    if (!input.shipToName.trim()) {
        return { ok: false, error: '한화 e-Sales 도착지명이 비어 있어 주문을 입력할 수 없습니다.' };
    }
    if (!formatYmd(input.deliveryDateYmd)) {
        return { ok: false, error: '납품요청일 형식이 올바르지 않아 한화 e-Sales 주문을 입력할 수 없습니다.' };
    }
    if (input.items.length === 0) {
        return { ok: false, error: '한화 e-Sales에 입력할 품목이 없습니다.' };
    }

    try {
        const page = await getFreshESalesPage('order');
        await loginAndSendOtp(page, { username: input.username, password: input.password });
        const orderNo = await automateOrder(page, input);
        return {
            ok: true,
            message: `한화 e-Sales 대리점오더 입력을 완료했습니다. 품목 ${input.items.length}건을 저장했습니다.`,
            orderNo,
        };
    } catch (error) {
        if (error instanceof ManualProductSelectionRequiredError) {
            return {
                ok: false,
                error: error.message,
                manualAction: 'PRODUCT_SELECTION',
                manualTitle: 'Product selection required',
                manualButtonLabel: 'Selection complete',
                rowIndex: error.rowIndex,
            };
        }
        return {
            ok: false,
            error: displayErrorMessage(error, '한화 e-Sales 주문 입력 중 오류가 발생했습니다.'),
        };
    }
}

export async function resumeHanwhaESalesOrderAfterProductSelection(
    input: HanwhaESalesOrderInput,
    rowIndex: number,
): Promise<HanwhaESalesLoginResult> {
    if (!input.username || !input.password) {
        return { ok: false, error: '한화 e-Sales 계정 정보가 설정되지 않았습니다.' };
    }
    if (process.platform !== 'win32') {
        return { ok: false, error: '한화 e-Sales 자동 주문은 Windows 업무 PC에서만 실행할 수 있습니다.' };
    }

    try {
        const page = await getESalesPage();
        const orderNo = await resumeOrderAfterProductSelection(page, input, rowIndex);
        return {
            ok: true,
            message: '수동 품목 선택 이후 한화 e-Sales 주문 입력을 완료했습니다.',
            orderNo,
        };
    } catch (error) {
        if (error instanceof ManualProductSelectionRequiredError) {
            return {
                ok: false,
                error: error.message,
                manualAction: 'PRODUCT_SELECTION',
                manualTitle: 'Product selection required',
                manualButtonLabel: 'Selection complete',
                rowIndex: error.rowIndex,
            };
        }
        return {
            ok: false,
            error: displayErrorMessage(error, '한화 e-Sales 수동 선택 이후 처리 중 오류가 발생했습니다.'),
        };
    }
}

export async function requestHanwhaESalesApprovalForOrders(input: {
    username: string | null;
    password: string | null;
    orderDateYmd: string;
    orderNo?: string | null;
}): Promise<HanwhaESalesLoginResult> {
    if (!input.username || !input.password) {
        return { ok: false, error: '한화 e-Sales 계정 정보가 설정되지 않았습니다.' };
    }
    if (process.platform !== 'win32') {
        return { ok: false, error: '한화 e-Sales 승인요청은 Windows 업무 PC에서만 실행할 수 있습니다.' };
    }

    try {
        const page = await getESalesPage();
        await loginAndSendOtp(page, { username: input.username, password: input.password });
        await requestApprovalForTodayOrders(page, formatYmd(input.orderDateYmd), input.orderNo);
        return {
            ok: true,
            message: input.orderNo
                ? `한화 e-Sales 주문 ${input.orderNo} 승인요청을 완료했습니다.`
                : '한화 e-Sales 당일 미승인 오더 승인요청을 완료했습니다.',
        };
    } catch (error) {
        return {
            ok: false,
            error: displayErrorMessage(error, '한화 e-Sales 승인요청 중 오류가 발생했습니다.'),
        };
    }
}

export async function prepareHanwhaESalesApprovalForOrders(input: {
    username: string | null;
    password: string | null;
    orderDateYmd: string;
    orderNo?: string | null;
}): Promise<HanwhaESalesLoginResult> {
    if (!input.username || !input.password) {
        return { ok: false, error: '한화 e-Sales 계정 정보가 설정되지 않았습니다.' };
    }
    if (process.platform !== 'win32') {
        return { ok: false, error: '한화 e-Sales 주문 조회/체크는 Windows 업무 PC에서만 실행할 수 있습니다.' };
    }

    try {
        const page = await getESalesPage();
        await loginAndSendOtp(page, { username: input.username, password: input.password });
        await prepareApprovalForTodayOrders(page, formatYmd(input.orderDateYmd), input.orderNo);
        return {
            ok: true,
            message: input.orderNo
                ? `한화 e-Sales 주문 ${input.orderNo}을 조회하고 체크했습니다.`
                : '한화 e-Sales 당일 주문을 조회하고 체크했습니다.',
        };
    } catch (error) {
        return {
            ok: false,
            error: displayErrorMessage(error, '한화 e-Sales 주문 조회/체크 중 오류가 발생했습니다.'),
        };
    }
}

export async function checkHanwhaESalesOrderStatus(input: {
    username: string | null;
    password: string | null;
    orderDateYmd?: string;
    orderDateFromYmd?: string;
    orderDateToYmd?: string;
    shipToName: string;
    deliveryDateYmd?: string;
    items?: HanwhaESalesOrderStatusItem[];
}): Promise<HanwhaESalesOrderStatusResult> {
    if (!input.username || !input.password) {
        return { ok: false, error: '한화 e-Sales 계정 정보가 설정되지 않았습니다.' };
    }
    if (process.platform !== 'win32') {
        return { ok: false, error: '한화 e-Sales 주문상태 확인은 Windows 업무 PC에서만 실행할 수 있습니다.' };
    }
    const orderDateFromYmd = formatYmd(input.orderDateFromYmd) || formatYmd(input.orderDateYmd);
    const orderDateToYmd = formatYmd(input.orderDateToYmd) || orderDateFromYmd;
    const deliveryDateYmd = formatYmd(input.deliveryDateYmd) || orderDateToYmd;
    if (!orderDateFromYmd || !orderDateToYmd) {
        return { ok: false, error: '한화 e-Sales 주문상태 확인에 필요한 주문일자 범위가 없습니다.' };
    }
    if (!input.shipToName.trim()) {
        return { ok: false, error: '한화 e-Sales 주문상태 확인에 필요한 도착지명이 없습니다.' };
    }

    if (!input.items?.length) {
        return { ok: false, error: '한화 e-Sales 주문상태 확인에 필요한 품목 정보가 없습니다.' };
    }

    try {
        const page = await getFreshESalesPage();
        await loginAndSendOtp(page, { username: input.username, password: input.password });
        const matched = await checkOrderStatusFromOrderList(page, {
            orderDateFromYmd,
            orderDateToYmd,
            shipToName: input.shipToName,
            deliveryDateYmd,
            items: input.items,
        });
        return {
            ok: true,
            status: matched.status,
            rowText: matched.rowText,
            message: `???????꾩룆梨???耀붾굝????????⑤챶裕????????濾?????${matched.status}????????嶺??`,
        };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : '??????e-Sales ???????꾩룆梨???耀붾굝????????⑤챶裕???????濾?????????븐뼐???????????????????????살몝???????????? ??????꾩룆梨띰쭕?뚢뵾?????????ル뭽癲ル슢????????????????????????ㅼ굣塋?',
        };
    }
}
