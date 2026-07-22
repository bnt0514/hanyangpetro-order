import { prisma } from '../src/lib/db';
import { createJobNotification, updateBackgroundJobResult } from '../src/lib/background-jobs';
import { executeBackgroundJob } from '../src/lib/hanwha-background-executors';

const WORKER_ID = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const CHECK_INTERVAL_MS = Number(process.env.BACKGROUND_JOB_CHECK_MS || 2000);

let stopping = false;
let running = false;

async function claimNextJob() {
    const now = new Date();
    const job = await prisma.backgroundJob.findFirst({
        where: {
            status: 'QUEUED',
            OR: [
                { nextRunAt: null },
                { nextRunAt: { lte: now } },
            ],
        },
        orderBy: { queuedAt: 'asc' },
    });
    if (!job) return null;

    const result = await prisma.backgroundJob.updateMany({
        where: { id: job.id, status: 'QUEUED' },
        data: {
            status: 'RUNNING',
            startedAt: now,
            heartbeatAt: now,
            lockedAt: now,
            lockedBy: WORKER_ID,
            attempts: { increment: 1 },
            message: job.message ?? '백그라운드 작업을 시작했습니다.',
        },
    });
    if (result.count === 0) return null;

    return prisma.backgroundJob.findUnique({ where: { id: job.id } });
}

async function runOne() {
    const job = await claimNextJob();
    if (!job) return false;

    console.log(`[background-worker] start ${job.type} ${job.id} ${job.title}`);
    try {
        await executeBackgroundJob(job);
        console.log(`[background-worker] done ${job.type} ${job.id}`);
    } catch (error) {
        const message = error instanceof Error ? error.message : '백그라운드 작업 중 오류가 발생했습니다.';
        console.error(`[background-worker] failed ${job.type} ${job.id}`, error);
        await updateBackgroundJobResult(job.id, 'FAILED', {
            error: message,
            result: { error: message },
        });
        await createJobNotification(job.id, {
            requestedByUserId: job.requestedByUserId,
            title: `${job.title} 실패`,
            message,
            notificationType: 'BACKGROUND_JOB_FAILED',
            metadata: { jobType: job.type },
        });
    }
    return true;
}

async function tick() {
    if (running || stopping) return;
    running = true;
    try {
        while (!stopping) {
            const worked = await runOne();
            if (!worked) break;
        }
    } finally {
        running = false;
    }
}

async function main() {
    console.log(`[background-worker] started. worker=${WORKER_ID}, interval=${CHECK_INTERVAL_MS}ms`);
    await tick();
    setInterval(() => {
        void tick().catch((error) => console.error('[background-worker] tick failed', error));
    }, CHECK_INTERVAL_MS);
}

async function shutdown() {
    stopping = true;
    while (running) {
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await prisma.$disconnect();
    process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

main().catch(async (error) => {
    console.error('[background-worker] crashed', error);
    await prisma.$disconnect();
    process.exit(1);
});
