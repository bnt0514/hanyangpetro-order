import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

type HanwhaAutomationTask = {
    label: string;
    startedAt: number;
    heartbeatAt: number;
    ownerToken: string;
    processId: number;
};

const AUTOMATION_STATE_FILE = path.join(process.cwd(), 'tmp', 'hanwha-automation-active.json');
const AUTOMATION_STATE_TTL_MS = 5 * 60 * 1000;
const AUTOMATION_HEARTBEAT_MS = 10 * 1000;
const AUTOMATION_ACQUIRE_TIMEOUT_MS = 15 * 60 * 1000;
const AUTOMATION_INVALID_STATE_GRACE_MS = 5 * 1000;

const globalForHanwhaAutomation = globalThis as typeof globalThis & {
    __hanyangHanwhaAutomationTail?: Promise<unknown>;
    __hanyangHanwhaAutomationActive?: HanwhaAutomationTask;
    __hanyangHanwhaAutomationPending?: number;
};

export function isHanwhaAutomationBusy() {
    return Boolean(globalForHanwhaAutomation.__hanyangHanwhaAutomationActive)
        || (globalForHanwhaAutomation.__hanyangHanwhaAutomationPending ?? 0) > 0;
}

export function getHanwhaAutomationActiveTask() {
    return globalForHanwhaAutomation.__hanyangHanwhaAutomationActive ?? null;
}

function sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function readAutomationStateFile() {
    let stat: fs.Stats;
    try {
        stat = fs.statSync(AUTOMATION_STATE_FILE);
    } catch {
        return null;
    }
    try {
        const raw = fs.readFileSync(AUTOMATION_STATE_FILE, 'utf8').replace(/^\uFEFF/, '');
        return {
            stat,
            task: JSON.parse(raw) as Partial<HanwhaAutomationTask>,
        };
    } catch {
        return { stat, task: null };
    }
}

function isProcessRunning(processId: number | undefined) {
    if (!processId || !Number.isInteger(processId) || processId <= 0) return true;
    try {
        process.kill(processId, 0);
        return true;
    } catch {
        return false;
    }
}

function isAutomationStateStale(
    task: Partial<HanwhaAutomationTask>,
    modifiedAt: number,
) {
    if (!isProcessRunning(task.processId)) return true;
    const lastActivityAt = task.heartbeatAt ?? task.startedAt ?? modifiedAt;
    return Date.now() - lastActivityAt > AUTOMATION_STATE_TTL_MS;
}

function removeStaleAutomationState() {
    const current = readAutomationStateFile();
    if (!current) return false;
    const stale = current.task
        ? isAutomationStateStale(current.task, current.stat.mtimeMs)
        : Date.now() - current.stat.mtimeMs > AUTOMATION_INVALID_STATE_GRACE_MS;
    if (!stale) return false;
    try {
        fs.rmSync(AUTOMATION_STATE_FILE, { force: true });
        return true;
    } catch {
        return false;
    }
}

function tryWriteAutomationState(task: HanwhaAutomationTask) {
    fs.mkdirSync(path.dirname(AUTOMATION_STATE_FILE), { recursive: true });
    const file = fs.openSync(AUTOMATION_STATE_FILE, 'wx');
    try {
        fs.writeFileSync(file, JSON.stringify(task), 'utf8');
    } finally {
        fs.closeSync(file);
    }
}

async function acquireAutomationState(label: string): Promise<HanwhaAutomationTask> {
    const deadline = Date.now() + AUTOMATION_ACQUIRE_TIMEOUT_MS;

    while (Date.now() < deadline) {
        const now = Date.now();
        const task: HanwhaAutomationTask = {
            label,
            startedAt: now,
            heartbeatAt: now,
            ownerToken: randomUUID(),
            processId: process.pid,
        };

        try {
            tryWriteAutomationState(task);
            return task;
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== 'EEXIST') throw error;
        }

        if (!removeStaleAutomationState()) await sleep(250);
    }

    throw new Error('다른 한화 e-Sales 작업이 아직 진행 중입니다. 현재 작업이 끝난 뒤 다시 진행해주세요.');
}

function refreshAutomationState(task: HanwhaAutomationTask) {
    const current = readAutomationStateFile();
    if (!current || !current.task || current.task.ownerToken !== task.ownerToken) return;
    const refreshed: HanwhaAutomationTask = {
        ...task,
        heartbeatAt: Date.now(),
    };
    try {
        fs.writeFileSync(AUTOMATION_STATE_FILE, JSON.stringify(refreshed), 'utf8');
    } catch {
        // The active task will still release its own lock in the finally block.
    }
}

function clearAutomationState(task: HanwhaAutomationTask) {
    const current = readAutomationStateFile();
    if (!current || !current.task || current.task.ownerToken !== task.ownerToken) return;
    try {
        fs.rmSync(AUTOMATION_STATE_FILE, { force: true });
    } catch {
        // Best effort only; a stale marker is cleaned before the next task.
    }
}

export function isHanwhaAutomationMarkedBusy() {
    const current = readAutomationStateFile();
    if (!current) return false;
    if (!current.task) {
        removeStaleAutomationState();
        return true;
    }
    if (isAutomationStateStale(current.task, current.stat.mtimeMs)) {
        removeStaleAutomationState();
        return false;
    }
    return true;
}

export async function runHanwhaAutomationQueued<T>(
    label: string,
    task: () => Promise<T>,
): Promise<T> {
    const previous = globalForHanwhaAutomation.__hanyangHanwhaAutomationTail ?? Promise.resolve();
    globalForHanwhaAutomation.__hanyangHanwhaAutomationPending = (globalForHanwhaAutomation.__hanyangHanwhaAutomationPending ?? 0) + 1;

    const current = previous
        .catch(() => undefined)
        .then(async () => {
            const activeTask = await acquireAutomationState(label);
            globalForHanwhaAutomation.__hanyangHanwhaAutomationActive = activeTask;
            const heartbeat = setInterval(() => refreshAutomationState(activeTask), AUTOMATION_HEARTBEAT_MS);
            try {
                return await task();
            } finally {
                clearInterval(heartbeat);
                globalForHanwhaAutomation.__hanyangHanwhaAutomationActive = undefined;
                clearAutomationState(activeTask);
                globalForHanwhaAutomation.__hanyangHanwhaAutomationPending = Math.max(
                    0,
                    (globalForHanwhaAutomation.__hanyangHanwhaAutomationPending ?? 1) - 1,
                );
            }
        });

    globalForHanwhaAutomation.__hanyangHanwhaAutomationTail = current.catch(() => undefined);
    return current;
}

export async function runHanwhaAutomationIfIdle<T>(
    label: string,
    busyError: T,
    task: () => Promise<T>,
): Promise<T> {
    if (isHanwhaAutomationBusy()) return busyError;
    return runHanwhaAutomationQueued(label, task);
}
