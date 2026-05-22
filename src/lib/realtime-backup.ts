import fs from 'fs/promises';
import path from 'path';

const MAX_BACKUPS = 500;
const BACKUP_DELAY_MS = Number(process.env.SQLITE_BACKUP_DELAY_MS ?? '2000');
const BACKUP_DIR = path.join(process.cwd(), 'backups', 'realtime');

// External drive backup directory. Skipped silently if not mounted.
const EXTERNAL_BACKUP_DIR = process.env.EXTERNAL_BACKUP_DIR ?? 'D:\\hanyangpetro-order data backup';

let timer: NodeJS.Timeout | null = null;
let pendingReasons = new Set<string>();
let running = false;

function isSqliteDatabaseUrl(url: string | undefined) {
    return !url || url.startsWith('file:');
}

function resolveSqlitePath() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!isSqliteDatabaseUrl(databaseUrl)) return null;

    const value = databaseUrl?.startsWith('file:') ? databaseUrl.slice('file:'.length) : './dev.db';
    if (path.isAbsolute(value)) return value;

    return path.join(process.cwd(), 'prisma', value);
}

function safeStamp() {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function safeReason(reason: string) {
    return reason.replace(/[^a-zA-Z0-9\u0000-\u007F.-]+/g, '_').slice(0, 80) || 'db-write';
}

async function cleanupOldBackups(dir: string) {
    const files = await fs.readdir(dir).catch(() => []);
    const dbFiles = files.filter((file) => file.endsWith('.db')).sort().reverse();
    const oldFiles = dbFiles.slice(MAX_BACKUPS);
    await Promise.all(oldFiles.map((file) => fs.rm(path.join(dir, file), { force: true }).catch(() => undefined)));
}

async function copyToDir(dbPath: string, dir: string, filename: string, reasons: string[]) {
    try {
        await fs.mkdir(dir, { recursive: true });
        const dest = path.join(dir, filename);
        await fs.copyFile(dbPath, dest);
        await fs.writeFile(
            path.join(dir, 'latest.json'),
            JSON.stringify({ createdAt: new Date().toISOString(), file: dest, reasons }, null, 2),
            'utf8',
        );
        await cleanupOldBackups(dir);
    } catch (error) {
        console.warn(`[realtime-backup] failed to write to ${dir}:`, (error as Error).message);
    }
}

async function runBackup() {
    if (running) return;
    running = true;
    const reasons = [...pendingReasons];
    pendingReasons = new Set<string>();

    try {
        const dbPath = resolveSqlitePath();
        if (!dbPath) return;
        await fs.access(dbPath);

        const reason = safeReason(reasons.join('+') || 'db-write');
        const filename = `${safeStamp()}-${reason}.db`;

        // Write to primary local backup dir
        await copyToDir(dbPath, BACKUP_DIR, filename, reasons);

        // Write to external drive in parallel (silently skipped if not mounted)
        void copyToDir(dbPath, EXTERNAL_BACKUP_DIR, filename, reasons);
    } catch (error) {
        console.error('[realtime-backup] failed', error);
    } finally {
        running = false;
    }
}

export function scheduleRealtimeBackup(reason: string) {
    if (process.env.DISABLE_REALTIME_SQLITE_BACKUP === '1') return;
    pendingReasons.add(reason);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
        timer = null;
        void runBackup();
    }, BACKUP_DELAY_MS);
}

export async function createImmediateBackup(reason: string) {
    pendingReasons.add(reason);
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
    await runBackup();
}
