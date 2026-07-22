import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/db';

export const BACKGROUND_JOB_STATUSES = ['QUEUED', 'RUNNING', 'WAITING_MANUAL_ACTION', 'DONE', 'FAILED'] as const;
export type BackgroundJobStatus = typeof BACKGROUND_JOB_STATUSES[number];

export const BACKGROUND_JOB_TYPES = {
    HANWHA_DISPATCH_FETCH: 'HANWHA_DISPATCH_FETCH',
    HANWHA_NEW_ORDER: 'HANWHA_NEW_ORDER',
    HANWHA_ORDER_STATUS_CHECK: 'HANWHA_ORDER_STATUS_CHECK',
    HANWHA_TODAY_SHIPMENT_FETCH: 'HANWHA_TODAY_SHIPMENT_FETCH',
} as const;

export type BackgroundJobType = typeof BACKGROUND_JOB_TYPES[keyof typeof BACKGROUND_JOB_TYPES];

export type BackgroundJobView = {
    id: string;
    type: string;
    status: string;
    queueKey: string | null;
    entityType: string | null;
    entityId: string | null;
    title: string;
    message: string | null;
    error: string | null;
    progress: number | null;
    queuedAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    metadata: unknown;
    result: unknown;
};

type EnqueueBackgroundJobInput = {
    type: BackgroundJobType;
    queueKey: string;
    entityType?: string | null;
    entityId?: string | null;
    title: string;
    message?: string | null;
    requestedByUserId?: string | null;
    requestedByCustomerUserId?: string | null;
    metadata?: unknown;
};

function jsonString(value: unknown) {
    if (value == null) return null;
    return JSON.stringify(value);
}

export function parseJobJson(value: string | null | undefined): unknown {
    if (!value) return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

export function parseJobJsonAs<T>(value: string | null | undefined): T | null {
    return parseJobJson(value) as T | null;
}

export function toBackgroundJobView(job: {
    id: string;
    type: string;
    status: string;
    queueKey: string | null;
    entityType: string | null;
    entityId: string | null;
    title: string;
    message: string | null;
    error: string | null;
    progress: number | null;
    queuedAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
    metadata: string | null;
    result: string | null;
}): BackgroundJobView {
    return {
        id: job.id,
        type: job.type,
        status: job.status,
        queueKey: job.queueKey,
        entityType: job.entityType,
        entityId: job.entityId,
        title: job.title,
        message: job.message,
        error: job.error,
        progress: job.progress,
        queuedAt: job.queuedAt.toISOString(),
        startedAt: job.startedAt?.toISOString() ?? null,
        finishedAt: job.finishedAt?.toISOString() ?? null,
        metadata: parseJobJson(job.metadata),
        result: parseJobJson(job.result),
    };
}

async function findActiveJob(queueKey: string) {
    return prisma.backgroundJob.findFirst({
        where: {
            queueKey,
            status: { in: ['QUEUED', 'RUNNING', 'WAITING_MANUAL_ACTION'] },
        },
        orderBy: { queuedAt: 'asc' },
    });
}

export async function enqueueBackgroundJob(input: EnqueueBackgroundJobInput) {
    const existing = await findActiveJob(input.queueKey);
    if (existing) return { job: existing, created: false };

    const id = randomBytes(12).toString('hex');
    try {
        const job = await prisma.backgroundJob.create({
            data: {
                id,
                type: input.type,
                status: 'QUEUED',
                queueKey: input.queueKey,
                activeKey: input.queueKey,
                entityType: input.entityType ?? null,
                entityId: input.entityId ?? null,
                title: input.title,
                message: input.message ?? '작업 대기열에 등록되었습니다.',
                requestedByUserId: input.requestedByUserId ?? null,
                requestedByCustomerUserId: input.requestedByCustomerUserId ?? null,
                metadata: jsonString(input.metadata),
            },
        });
        return { job, created: true };
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            const raceWinner = await findActiveJob(input.queueKey);
            if (raceWinner) return { job: raceWinner, created: false };
        }
        throw error;
    }
}

export async function updateBackgroundJobResult(
    jobId: string,
    status: 'DONE' | 'FAILED',
    data: {
        message?: string | null;
        error?: string | null;
        result?: unknown;
        progress?: number | null;
    },
) {
    const now = new Date();
    return prisma.backgroundJob.update({
        where: { id: jobId },
        data: {
            status,
            activeKey: null,
            message: data.message ?? null,
            error: data.error ?? null,
            result: jsonString(data.result),
            progress: data.progress ?? (status === 'DONE' ? 100 : null),
            finishedAt: now,
            heartbeatAt: now,
            lockedAt: null,
            lockedBy: null,
        },
    });
}

export async function createJobNotification(jobId: string, input: {
    requestedByUserId?: string | null;
    title: string;
    message: string;
    notificationType: string;
    metadata?: unknown;
}) {
    if (!input.requestedByUserId) return null;
    return prisma.notificationLog.create({
        data: {
            backgroundJobId: jobId,
            recipientType: 'STAFF',
            recipientId: input.requestedByUserId,
            channel: 'IN_APP',
            notificationType: input.notificationType,
            title: input.title,
            message: input.message,
            sendStatus: 'SENT',
            sentAt: new Date(),
            metadata: jsonString(input.metadata),
        },
    });
}
