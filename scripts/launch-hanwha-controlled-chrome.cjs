const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const chromePath = process.env.CHROME_PATH
    || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const remoteDebuggingPort = Number(process.env.HANWHA_ESALES_CDP_PORT || 9224);
const profileDir = process.env.HANWHA_ESALES_PROFILE_DIR
    || path.join(process.cwd(), 'tmp', 'hanwha-esales-controlled-profile');
const loginUrl = process.env.HANWHA_ESALES_LOGIN_URL
    || 'https://esales.hanwhasolutions.com/esplus/resources/login.html';
const chromeLogFile = process.env.CHROME_LOG_FILE
    || path.join(process.cwd(), 'tmp', 'hanwha-esales-chrome.log');
const launchLogFile = process.env.HANWHA_ESALES_LAUNCH_LOG
    || path.join(process.cwd(), 'tmp', 'hanwha-esales-launch.log');

function appendLaunchLog(message) {
    try {
        fs.mkdirSync(path.dirname(launchLogFile), { recursive: true });
        fs.appendFileSync(
            launchLogFile,
            `[${new Date().toISOString()}] launcher=${process.pid} ${message}\n`,
            'utf8',
        );
    } catch {
        // Chrome launch must not fail just because diagnostic logging failed.
    }
}

if (!Number.isInteger(remoteDebuggingPort) || remoteDebuggingPort <= 0) {
    appendLaunchLog(`invalid CDP port: ${remoteDebuggingPort}`);
    process.exit(1);
}

const chrome = spawn(chromePath, [
    `--remote-debugging-port=${remoteDebuggingPort}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble',
    '--enable-logging',
    '--log-level=1',
    '--new-window',
    loginUrl,
], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    env: {
        ...process.env,
        CHROME_LOG_FILE: chromeLogFile,
    },
});

chrome.once('error', (error) => {
    appendLaunchLog(`Chrome launch failed: ${error.message}`);
    process.exitCode = 1;
});
chrome.once('spawn', () => {
    appendLaunchLog(`Chrome started pid=${chrome.pid} port=${remoteDebuggingPort} profile=${profileDir}`);
    chrome.unref();
});
