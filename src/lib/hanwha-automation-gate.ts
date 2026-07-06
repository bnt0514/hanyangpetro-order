import fs from 'fs';
import path from 'path';

type HanwhaAutomationTask = {
    label: string;
    startedAt: number;
};

const AUTOMATION_STATE_FILE = path.join(process.cwd(), 'tmp', 'hanwha-automation-active.json');
const AUTOMATION_STATE_TTL_MS = 15 * 60 * 1000;

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

function writeAutomationState(task: HanwhaAutomationTask) {
    try {
        fs.mkdirSync(path.dirname(AUTOMATION_STATE_FILE), { recursive: true });
        fs.writeFileSync(AUTOMATION_STATE_FILE, JSON.stringify(task), 'utf8');
    } catch {
        // The in-process queue still protects app automation if the cross-process marker fails.
    }
}

function clearAutomationState(startedAt: number) {
    try {
        const raw = fs.readFileSync(AUTOMATION_STATE_FILE, 'utf8').replace(/^\uFEFF/, '');
        const current = JSON.parse(raw) as Partial<HanwhaAutomationTask>;
        if (current.startedAt === startedAt) fs.rmSync(AUTOMATION_STATE_FILE, { force: true });
    } catch {
        try {
            fs.rmSync(AUTOMATION_STATE_FILE, { force: true });
        } catch {
            // Best effort only.
        }
    }
}

export function isHanwhaAutomationMarkedBusy() {
    try {
        const stat = fs.statSync(AUTOMATION_STATE_FILE);
        if (Date.now() - stat.mtimeMs > AUTOMATION_STATE_TTL_MS) {
            fs.rmSync(AUTOMATION_STATE_FILE, { force: true });
            return false;
        }
        return true;
    } catch {
        return false;
    }
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
            const activeTask = {
                label,
                startedAt: Date.now(),
            };
            globalForHanwhaAutomation.__hanyangHanwhaAutomationActive = activeTask;
            writeAutomationState(activeTask);
            try {
                return await task();
            } finally {
                globalForHanwhaAutomation.__hanyangHanwhaAutomationActive = undefined;
                clearAutomationState(activeTask.startedAt);
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
