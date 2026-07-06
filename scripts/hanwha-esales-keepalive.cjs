const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ESALES_LOGIN_URL = 'https://esales.hanwhasolutions.com/esplus/resources/login.html';
const REMOTE_DEBUGGING_PORT = Number(process.env.HANWHA_ESALES_CDP_PORT || 9224);
const KEEPALIVE_INTERVAL_MS = Number(process.env.HANWHA_ESALES_KEEPALIVE_MS || 25 * 60 * 1000);
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE_DIR = path.join(process.cwd(), 'tmp', 'hanwha-esales-controlled-profile');
const AUTOMATION_STATE_FILE = path.join(process.cwd(), 'tmp', 'hanwha-automation-active.json');
const AUTOMATION_STATE_TTL_MS = 15 * 60 * 1000;
const ESALES_HOST = 'esales.hanwhasolutions.com';
const EXTENSION_BUTTON_SELECTOR = 'div[id$="frameBottom.form.btnExtension"], div[id*="frameBottom.form.btnExtension"]';
const SESSION_TIMER_SELECTOR = 'div[id$="frameBottom.form.staTime"], div[id*="frameBottom.form.staTime"]';

let connectedBrowser = null;
const dialogHandlerPages = new WeakSet();
const dialogHandlerContexts = new WeakSet();

process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason || '');
    if (message.includes('Page.handleJavaScriptDialog') && message.includes('No dialog is showing')) {
        console.warn(`[${new Date().toISOString()}] Ignored stale JavaScript dialog event.`);
        return;
    }
    throw reason;
});

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function readAutomationState() {
    try {
        const stat = fs.statSync(AUTOMATION_STATE_FILE);
        if (Date.now() - stat.mtimeMs > AUTOMATION_STATE_TTL_MS) {
            fs.rmSync(AUTOMATION_STATE_FILE, { force: true });
            return null;
        }
        return JSON.parse(fs.readFileSync(AUTOMATION_STATE_FILE, 'utf8').replace(/^\uFEFF/, ''));
    } catch {
        return null;
    }
}

async function isCdpOpen() {
    try {
        const response = await fetch(`http://127.0.0.1:${REMOTE_DEBUGGING_PORT}/json/version`);
        return response.ok;
    } catch {
        return false;
    }
}

function launchControlledChrome() {
    const child = spawn(CHROME_PATH, [
        `--remote-debugging-port=${REMOTE_DEBUGGING_PORT}`,
        `--user-data-dir=${PROFILE_DIR}`,
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

function registerDialogHandler(page) {
    if (!page || dialogHandlerPages.has(page)) return;
    dialogHandlerPages.add(page);
    page.on('dialog', async (dialog) => {
        try {
            await dialog.accept();
        } catch {
            // Nexacro may close a dialog before Playwright handles it.
        }
    });
}

function registerContextDialogHandlers(context) {
    if (!context || dialogHandlerContexts.has(context)) return;
    dialogHandlerContexts.add(context);
    for (const existingPage of context.pages()) registerDialogHandler(existingPage);
    context.on('page', registerDialogHandler);
}

async function ensureCdp() {
    if (!(await isCdpOpen())) {
        launchControlledChrome();
    }

    for (let i = 0; i < 40; i += 1) {
        if (await isCdpOpen()) return;
        await sleep(250);
    }

    throw new Error('Chrome remote debugging endpoint did not start.');
}

async function getSessionState(page) {
    return page.evaluate(({ buttonSelector, timerSelector }) => {
        const button = document.querySelector(buttonSelector);
        const timer = document.querySelector(timerSelector);
        const rect = button?.getBoundingClientRect();

        return {
            hasButton: Boolean(button && rect && rect.width > 0 && rect.height > 0),
            timerText: timer?.innerText || timer?.textContent || null,
            buttonText: button?.innerText || button?.textContent || null,
            rect: rect
                ? {
                    x: rect.left + rect.width / 2,
                    y: rect.top + rect.height / 2,
                    width: rect.width,
                    height: rect.height,
                }
                : null,
        };
    }, {
        buttonSelector: EXTENSION_BUTTON_SELECTOR,
        timerSelector: SESSION_TIMER_SELECTOR,
    }).catch(() => ({
        hasButton: false,
        timerText: null,
        buttonText: null,
        rect: null,
    }));
}

function parseTimerSeconds(timerText) {
    if (!timerText) return null;
    const numbers = String(timerText).match(/\d+/g)?.map(Number) || [];
    if (numbers.length < 2) return null;
    return numbers[0] * 60 + numbers[1];
}

async function findExtendablePage(context) {
    const pages = context.pages().filter((candidate) => candidate.url().includes(ESALES_HOST));
    for (const page of pages) {
        const state = await getSessionState(page);
        if (state.hasButton) {
            return { page, state };
        }
    }

    return { page: pages[0] || null, state: null };
}

async function clickExtensionButton(page, state) {
    const before = state || await getSessionState(page);
    if (!before.hasButton || !before.rect) {
        return { clicked: false, extended: false, before, after: null };
    }

    const beforeSeconds = parseTimerSeconds(before.timerText);
    let after = null;
    let clicked = false;

    for (let attempt = 0; attempt < 3; attempt += 1) {
        await page.bringToFront().catch(() => undefined);
        if (attempt === 0) {
            await page.mouse.click(before.rect.x, before.rect.y, { delay: 80 }).catch(() => undefined);
            clicked = true;
        } else {
            clicked = await page.evaluate(({ buttonSelector, attempt }) => {
                function visible(el) {
                    if (!el || !(el instanceof HTMLElement)) return false;
                    const rect = el.getBoundingClientRect();
                    const style = getComputedStyle(el);
                    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
                }
                function fireMouse(el) {
                    for (const type of ['mouseover', 'mousemove', 'mousedown', 'mouseup', 'click']) {
                        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
                    }
                }
                const button = Array.from(document.querySelectorAll(buttonSelector)).find(visible);
                if (!button) return false;
                const linked = button._linked_element?.linkedcontrol;
                if (attempt === 1 && linked && typeof linked.click === 'function') {
                    linked.click();
                    return true;
                }
                fireMouse(button);
                return true;
            }, { buttonSelector: EXTENSION_BUTTON_SELECTOR, attempt }).catch(() => false);
        }

        if (!clicked) continue;
        await page.waitForTimeout(2_500);
        after = await getSessionState(page);
        const afterSeconds = parseTimerSeconds(after.timerText);
        const extended = afterSeconds !== null && (
            afterSeconds >= 50 * 60
            || (beforeSeconds !== null && afterSeconds > beforeSeconds + 5 * 60)
        );
        if (extended) {
            return { clicked, extended: true, before, after };
        }
    }

    return {
        clicked,
        extended: false,
        before,
        after,
    };
}

async function keepAliveOnce() {
    const activeAutomation = readAutomationState();
    if (activeAutomation) {
        console.log(`[${new Date().toISOString()}] Hanwha e-Sales keepalive skipped; automation active: ${activeAutomation.label || 'unknown'}`);
        return;
    }

    await ensureCdp();

    if (!connectedBrowser) {
        connectedBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${REMOTE_DEBUGGING_PORT}`);
    }

    try {
        const context = connectedBrowser.contexts()[0] || await connectedBrowser.newContext();
        registerContextDialogHandlers(context);
        let { page, state } = await findExtendablePage(context);
        if (!page) {
            page = await context.newPage();
            registerDialogHandler(page);
            await page.goto(ESALES_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            state = await getSessionState(page);
        }

        const sessionExpired = page.url().includes('Session30Out');
        const extensionResult = sessionExpired
            ? { clicked: false, before: state, after: null }
            : await clickExtensionButton(page, state);

        if (!extensionResult.clicked && !sessionExpired) {
            await page.bringToFront().catch(() => undefined);
            await page.mouse.move(8, 8).catch(() => undefined);
            await page.evaluate(() => {
                window.focus();
                window.dispatchEvent(new Event('focus'));
                window.dispatchEvent(new Event('mousemove'));
                document.dispatchEvent(new Event('visibilitychange'));
                document.body?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window }));
            }).catch(() => undefined);
        }

        const timerPart = extensionResult.after?.timerText
            ? ` timer=${extensionResult.after.timerText}`
            : '';
        const status = sessionExpired
            ? 'skipped; session already expired'
            : extensionResult.clicked && extensionResult.extended
                ? 'extension button clicked and verified'
                : extensionResult.clicked
                    ? 'extension button clicked but timer was not extended'
                : 'fallback activity sent; extension button not found';

        console.log(`[${new Date().toISOString()}] Hanwha e-Sales keepalive ${status}:${timerPart} ${page.url()}`);
    } catch (error) {
        connectedBrowser = null;
        throw error;
    }
}

async function main() {
    const once = process.argv.includes('--once');
    if (once) {
        try {
            await keepAliveOnce();
            process.exit(0);
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Hanwha e-Sales keepalive failed:`, error);
            process.exit(1);
        }
    }

    do {
        try {
            await keepAliveOnce();
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Hanwha e-Sales keepalive failed:`, error);
        }
        await sleep(KEEPALIVE_INTERVAL_MS);
    } while (true);
}

void main();
