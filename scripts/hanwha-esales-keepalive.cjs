const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const ESALES_LOGIN_URL = 'https://esales.hanwhasolutions.com/esplus/resources/login.html';
const REMOTE_DEBUGGING_PORT = Number(process.env.HANWHA_ESALES_CDP_PORT || 9224);
const KEEPALIVE_INTERVAL_MS = Number(process.env.HANWHA_ESALES_KEEPALIVE_MS || 25 * 60 * 1000);
const SUPERVISOR_INTERVAL_MS = Number(process.env.HANWHA_ESALES_SUPERVISOR_MS || 60 * 1000);
const KEEPALIVE_RUN_TIMEOUT_MS = Number(process.env.HANWHA_ESALES_RUN_TIMEOUT_MS || 90 * 1000);
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE_DIR = path.join(process.cwd(), 'tmp', 'hanwha-esales-controlled-profile');
const CHROME_LOG_FILE = path.join(process.cwd(), 'tmp', 'hanwha-esales-chrome.log');
const CHROME_LAUNCHER_SCRIPT = path.join(process.cwd(), 'scripts', 'launch-hanwha-controlled-chrome.cjs');
const AUTOMATION_STATE_FILE = path.join(process.cwd(), 'tmp', 'hanwha-automation-active.json');
const BOOT_STATE_FILE = path.join(process.cwd(), 'tmp', 'hanwha-esales-keepalive-boot.json');
const BOOT_LOGIN_SCRIPT = path.join('scripts', 'hanwha-esales-boot-login.ts');
const AUTOMATION_STATE_TTL_MS = 5 * 60 * 1000;
const BOOT_LOGIN_TIMEOUT_MS = 120 * 1000;
const ESALES_HOST = 'esales.hanwhasolutions.com';
const EXTENSION_BUTTON_SELECTOR = 'div[id$="frameBottom.form.btnExtension"], div[id*="frameBottom.form.btnExtension"]';
const SESSION_TIMER_SELECTOR = 'div[id$="frameBottom.form.staTime"], div[id*="frameBottom.form.staTime"]';

let connectedBrowser = null;
let lastExtensionAttemptAt = 0;
let otpPendingLogged = false;
const dialogHandlerPages = new WeakSet();
const dialogHandlerContexts = new WeakSet();

function currentBootMarker() {
    // os.uptime() is system uptime, so this stays stable across PM2 restarts
    // and changes only after Windows starts again.
    return Math.round((Date.now() - os.uptime() * 1000) / 1000);
}

function readBootState() {
    try {
        return JSON.parse(fs.readFileSync(BOOT_STATE_FILE, 'utf8').replace(/^\uFEFF/, ''));
    } catch {
        return null;
    }
}

function writeBootState(state) {
    try {
        fs.mkdirSync(path.dirname(BOOT_STATE_FILE), { recursive: true });
        fs.writeFileSync(BOOT_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
    } catch (error) {
        console.warn(`[${new Date().toISOString()}] Unable to save e-Sales boot state: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function detectRebootStartup() {
    const bootMarker = currentBootMarker();
    const previous = readBootState();
    const sameBoot = typeof previous?.bootMarker === 'number'
        && Math.abs(previous.bootMarker - bootMarker) <= 5;
    const rebootDetected = Boolean(previous && !sameBoot);

    // The first installation/start only establishes a baseline. This avoids
    // sending an unexpected OTP while deploying this behavior.
    writeBootState({
        bootMarker,
        observedAt: new Date().toISOString(),
        rebootLoginAttemptedAt: rebootDetected ? new Date().toISOString() : null,
    });

    return { rebootDetected, initialized: !previous };
}

function summarizeChildOutput(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(-1000);
}

async function runRebootLogin({ forceLogin = false } = {}) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, ['--import', 'tsx', BOOT_LOGIN_SCRIPT], {
            cwd: process.cwd(),
            detached: false,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                HANWHA_ESALES_BOOT_LOGIN: '1',
                HANWHA_ESALES_FORCE_LOGIN: forceLogin ? '1' : '0',
            },
        });

        let stdout = '';
        let stderr = '';
        let settled = false;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve(result);
        };
        const timeout = setTimeout(() => {
            child.kill();
            finish({ ok: false, message: 'Timed out while preparing e-Sales OTP login.' });
        }, BOOT_LOGIN_TIMEOUT_MS);

        child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
        child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('error', (error) => finish({ ok: false, message: error.message }));
        child.on('close', (code) => {
            const output = summarizeChildOutput(stdout || stderr);
            finish({
                ok: code === 0,
                message: output || (code === 0 ? 'e-Sales login preparation finished.' : `e-Sales login preparation exited with code ${code}.`),
            });
        });
    });
}

const bootStartup = detectRebootStartup();
let rebootLoginPending = bootStartup.rebootDetected;

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
        const state = JSON.parse(fs.readFileSync(AUTOMATION_STATE_FILE, 'utf8').replace(/^\uFEFF/, ''));
        const lastActivityAt = Number(state.heartbeatAt || state.startedAt || stat.mtimeMs);
        const processId = Number(state.processId || 0);
        let ownerRunning = true;
        if (Number.isInteger(processId) && processId > 0) {
            try {
                process.kill(processId, 0);
            } catch {
                ownerRunning = false;
            }
        }
        if (!ownerRunning || Date.now() - lastActivityAt > AUTOMATION_STATE_TTL_MS) {
            fs.rmSync(AUTOMATION_STATE_FILE, { force: true });
            return null;
        }
        return state;
    } catch {
        return null;
    }
}

function tryAcquireKeepaliveLease() {
    const task = {
        label: 'e-Sales keepalive',
        startedAt: Date.now(),
        heartbeatAt: Date.now(),
        ownerToken: randomUUID(),
        processId: process.pid,
    };
    try {
        fs.mkdirSync(path.dirname(AUTOMATION_STATE_FILE), { recursive: true });
        const file = fs.openSync(AUTOMATION_STATE_FILE, 'wx');
        try {
            fs.writeFileSync(file, JSON.stringify(task), 'utf8');
        } finally {
            fs.closeSync(file);
        }
        return task;
    } catch (error) {
        if (error && error.code === 'EEXIST') return null;
        throw error;
    }
}

function releaseKeepaliveLease(task) {
    try {
        const current = JSON.parse(fs.readFileSync(AUTOMATION_STATE_FILE, 'utf8').replace(/^\uFEFF/, ''));
        if (current.ownerToken === task.ownerToken) fs.rmSync(AUTOMATION_STATE_FILE, { force: true });
    } catch {
        // A stale or replaced state file must never be removed blindly.
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
    const child = spawn(process.execPath, [CHROME_LAUNCHER_SCRIPT], {
        detached: false,
        stdio: 'ignore',
        windowsHide: true,
        env: {
            ...process.env,
            CHROME_PATH,
            HANWHA_ESALES_CDP_PORT: String(REMOTE_DEBUGGING_PORT),
            HANWHA_ESALES_PROFILE_DIR: PROFILE_DIR,
            HANWHA_ESALES_LOGIN_URL: ESALES_LOGIN_URL,
            CHROME_LOG_FILE,
        },
    });
    child.once('error', (error) => {
        console.error(`[${new Date().toISOString()}] Controlled Chrome launcher failed: ${error.message}`);
    });
    child.once('exit', (code, signal) => {
        if (code !== 0) {
            console.warn(`[${new Date().toISOString()}] Controlled Chrome launcher exited: code=${code ?? 'null'} signal=${signal ?? 'null'}`);
        }
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
    const cdpWasOpen = await isCdpOpen();
    if (!cdpWasOpen) {
        launchControlledChrome();
    }

    for (let i = 0; i < 40; i += 1) {
        if (await isCdpOpen()) return { launchedChrome: !cdpWasOpen };
        await sleep(250);
    }

    throw new Error('Chrome remote debugging endpoint did not start.');
}

function isClosedBrowserError(error) {
    const message = error instanceof Error ? error.message : String(error || '');
    return /target page, context or browser has been closed/i.test(message);
}

async function recoverAfterBrowserLoss(reason, {
    chromeWasRelaunched = false,
    forceLogin = false,
} = {}) {
    connectedBrowser = null;

    if (!chromeWasRelaunched) {
        // A worker or Playwright driver can disconnect while the controlled
        // Chrome and its authenticated e-Sales page remain perfectly healthy.
        // Never turn that transport loss into a forced logout.
        for (let attempt = 0; attempt < 5 && !await isCdpOpen(); attempt += 1) {
            await sleep(400);
        }

        if (await isCdpOpen()) {
            try {
                connectedBrowser = await connectToControlledChrome();
                const context = connectedBrowser.contexts()[0] || await connectedBrowser.newContext();
                registerContextDialogHandlers(context);
                let { page, state } = await findExtendablePage(context);

                if (page) {
                    let otpVisible = await hasVisibleOtpForm(page);
                    let loginVisible = await hasVisibleLoginForm(page);
                    let expired = isExpiredESalesPageUrl(page.url());
                    if (!state?.authenticatedShellVisible && !otpVisible && !loginVisible && !expired) {
                        await page.waitForTimeout(2_000);
                        state = await getSessionState(page);
                        otpVisible = await hasVisibleOtpForm(page);
                        loginVisible = await hasVisibleLoginForm(page);
                        expired = isExpiredESalesPageUrl(page.url());
                    }

                    if (state?.authenticatedShellVisible) {
                        console.log(`[${new Date().toISOString()}] Hanwha e-Sales CDP connection restored; authenticated session is still active (${reason}).`);
                        return;
                    }
                    if (otpVisible) {
                        console.log(`[${new Date().toISOString()}] Hanwha e-Sales CDP connection restored; existing OTP input is still waiting (${reason}).`);
                        return;
                    }
                    if (!loginVisible && !expired) {
                        console.warn(`[${new Date().toISOString()}] Hanwha e-Sales CDP connection restored but session state is inconclusive; preserving the current window without forcing login (${reason}).`);
                        return;
                    }
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error || '');
                console.warn(`[${new Date().toISOString()}] Hanwha e-Sales CDP reconnection failed; will retry without forcing logout: ${message}`);
                return;
            }
        } else {
            const cdpResult = await ensureCdp();
            chromeWasRelaunched = cdpResult.launchedChrome;
        }
    }

    if (!chromeWasRelaunched && !await isCdpOpen()) {
        console.warn(`[${new Date().toISOString()}] Hanwha e-Sales recovery deferred; Chrome state could not be verified (${reason}).`);
        return;
    }

    connectedBrowser = null;
    const recoveryMode = forceLogin ? 'forced login and OTP preparation' : 'saved-session recovery';
    console.warn(`[${new Date().toISOString()}] Hanwha e-Sales login recovery required (${reason}); starting ${recoveryMode}.`);
    // Closing the dedicated Chrome window is not the same as Windows rebooting.
    // Preserve its profile/session first; the login helper sends OTP only when
    // e-Sales itself actually presents a login screen.
    const loginResult = await runRebootLogin({ forceLogin });
    if (!loginResult.ok) {
        throw new Error(`Hanwha e-Sales browser recovery login failed: ${loginResult.message}`);
    }
    console.log(`[${new Date().toISOString()}] Hanwha e-Sales browser recovery login preparation completed: ${loginResult.message}`);
}

async function connectToControlledChrome() {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
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
    throw lastError || new Error('Unable to connect to controlled Chrome.');
}

async function getSessionState(page) {
    return page.evaluate(({ buttonSelector, timerSelector }) => {
        function exposed(el) {
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
        const button = document.querySelector(buttonSelector);
        const timer = document.querySelector(timerSelector);
        const rect = button?.getBoundingClientRect();
        const authenticatedShellSelectors = [
            'div[id*="frameLeft.form.divLeft.form.grdTree"]',
            'div[id*="frameNavi.form.divTab"]',
            'div[id*="winESDMY-"]',
            'div[id*="ESD_PARTNER_INFO_V"]',
            'div[id*="ESD_SALES_ITEM_V"]',
        ];

        return {
            hasButton: exposed(button),
            authenticatedShellVisible: authenticatedShellSelectors.some(
                (selector) => Array.from(document.querySelectorAll(selector)).some(exposed),
            ),
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
        authenticatedShellVisible: false,
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

function isExpiredESalesPageUrl(url) {
    return /session(?:30)?out/i.test(String(url || ''));
}

async function hasVisibleLoginForm(page) {
    return page.evaluate(() => {
        const input = document.querySelector('input[id*="frameLogin"][id*="edtId"]');
        if (!(input instanceof HTMLElement)) return false;
        const rect = input.getBoundingClientRect();
        const style = getComputedStyle(input);
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
        return Boolean(top && (top === input || input.contains(top) || top.contains(input)));
    }).catch(() => false);
}

async function hasVisibleOtpForm(page) {
    return page.evaluate(() => {
        function exposed(el) {
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
        return Array.from(document.querySelectorAll('div[id*="frm_LoginOTP"]')).some(exposed);
    }).catch(() => false);
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

async function keepAliveOnce({ forceExtension = false } = {}) {
    const activeAutomation = readAutomationState();
    if (activeAutomation) {
        console.log(`[${new Date().toISOString()}] Hanwha e-Sales keepalive skipped; automation active: ${activeAutomation.label || 'unknown'}`);
        return;
    }

    const keepaliveLease = tryAcquireKeepaliveLease();
    if (!keepaliveLease) {
        const currentAutomation = readAutomationState();
        console.log(`[${new Date().toISOString()}] Hanwha e-Sales keepalive skipped; automation active: ${currentAutomation?.label || 'unknown'}`);
        return;
    }

    try {
        if (rebootLoginPending) {
            rebootLoginPending = false;
            console.log(`[${new Date().toISOString()}] Windows reboot detected; preparing e-Sales login and OTP request.`);
            const loginResult = await runRebootLogin({ forceLogin: true });
            if (loginResult.ok) {
                console.log(`[${new Date().toISOString()}] e-Sales reboot login preparation completed: ${loginResult.message}`);
                return;
            }
            console.warn(`[${new Date().toISOString()}] e-Sales reboot login preparation failed; continuing regular keepalive: ${loginResult.message}`);
        }

        const cdpResult = await ensureCdp();
        if (cdpResult.launchedChrome) {
            await recoverAfterBrowserLoss(
                'controlled Chrome was not running',
                { chromeWasRelaunched: true },
            );
            return;
        }

        if (!connectedBrowser) {
            connectedBrowser = await connectToControlledChrome();
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

            let sessionExpired = isExpiredESalesPageUrl(page.url());
            let loginFormVisible = await hasVisibleLoginForm(page);
            let otpFormVisible = await hasVisibleOtpForm(page);
            if (!state?.authenticatedShellVisible && !loginFormVisible && !otpFormVisible && !sessionExpired) {
                await page.waitForTimeout(3_000);
                state = await getSessionState(page);
                sessionExpired = isExpiredESalesPageUrl(page.url());
                loginFormVisible = await hasVisibleLoginForm(page);
                otpFormVisible = await hasVisibleOtpForm(page);
            }

            if (otpFormVisible) {
                if (!otpPendingLogged) {
                    console.log(`[${new Date().toISOString()}] Hanwha e-Sales OTP input is waiting; preserving the current login flow.`);
                    otpPendingLogged = true;
                }
                return;
            }
            otpPendingLogged = false;

            const loginRecoveryNeeded = !state?.authenticatedShellVisible;
            if (sessionExpired || loginRecoveryNeeded) {
                const reason = sessionExpired
                    ? 'session expired'
                    : loginFormVisible
                        ? 'login form visible without an authenticated work shell'
                        : 'authenticated work shell is missing';
                console.warn(`[${new Date().toISOString()}] Hanwha e-Sales recovery required (${reason}); checking the saved session before requesting OTP.`);
                const loginResult = await runRebootLogin({ forceLogin: false });
                connectedBrowser = null;
                if (loginResult.ok) {
                    console.log(`[${new Date().toISOString()}] Hanwha e-Sales session recovery login preparation completed: ${loginResult.message}`);
                    return;
                }
                throw new Error(`Hanwha e-Sales session recovery failed: ${loginResult.message}`);
            }

            if (!forceExtension && Date.now() - lastExtensionAttemptAt < KEEPALIVE_INTERVAL_MS) {
                return;
            }

            lastExtensionAttemptAt = Date.now();
            const extensionResult = await clickExtensionButton(page, state);

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
            const status = extensionResult.clicked && extensionResult.extended
                    ? 'extension button clicked and verified'
                    : extensionResult.clicked
                        ? 'extension button clicked but timer was not extended'
                    : 'fallback activity sent; extension button not found';

            console.log(`[${new Date().toISOString()}] Hanwha e-Sales keepalive ${status}:${timerPart} ${page.url()}`);
        } catch (error) {
            connectedBrowser = null;
            if (isClosedBrowserError(error)) {
                await recoverAfterBrowserLoss('browser or tab context closed unexpectedly');
                return;
            }
            throw error;
        }
    } finally {
        releaseKeepaliveLease(keepaliveLease);
    }
}

async function runKeepAliveWithWatchdog(options) {
    // A hung CDP action must not leave the supervisor alive-but-stalled.
    // PM2 restarts only this Node process; treekill:false keeps Chrome intact.
    const watchdog = setTimeout(() => {
        console.error(`[${new Date().toISOString()}] Hanwha e-Sales keepalive exceeded ${KEEPALIVE_RUN_TIMEOUT_MS}ms; restarting the supervisor without closing Chrome.`);
        process.exit(1);
    }, KEEPALIVE_RUN_TIMEOUT_MS);

    try {
        await keepAliveOnce(options);
    } finally {
        clearTimeout(watchdog);
    }
}

async function main() {
    const once = process.argv.includes('--once');
    if (once) {
        try {
            await runKeepAliveWithWatchdog({ forceExtension: true });
            process.exit(0);
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Hanwha e-Sales keepalive failed:`, error);
            process.exit(1);
        }
    }

    do {
        try {
            await runKeepAliveWithWatchdog();
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Hanwha e-Sales keepalive failed:`, error);
        }
        await sleep(SUPERVISOR_INTERVAL_MS);
    } while (true);
}

void main();
