'use server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { toBackgroundJobView, type BackgroundJobView } from '@/lib/background-jobs';

export type BackgroundJobNotificationView = {
    id: string;
    backgroundJobId: string | null;
    title: string;
    message: string;
    notificationType: string;
    readAt: string | null;
    createdAt: string;
};

export type BackgroundJobNotificationsResult =
    | {
        ok: true;
        activeJobs: BackgroundJobView[];
        notifications: BackgroundJobNotificationView[];
        unreadCount: number;
    }
    | { ok: false; error: string };

export async function getBackgroundJobNotifications(): Promise<BackgroundJobNotificationsResult> {
    const session = await auth();
    if (!session?.user || session.user.userKind !== 'staff') return { ok: false, error: '권한이 없습니다.' };

    const [activeJobs, notifications, unreadCount] = await Promise.all([
        prisma.backgroundJob.findMany({
            where: {
                requestedByUserId: session.user.id,
                status: { in: ['QUEUED', 'RUNNING'] },
            },
            orderBy: { queuedAt: 'desc' },
            take: 8,
        }),
        prisma.notificationLog.findMany({
            where: {
                recipientType: 'STAFF',
                recipientId: session.user.id,
                channel: 'IN_APP',
                notificationType: { in: ['BACKGROUND_JOB_DONE', 'BACKGROUND_JOB_FAILED'] },
            },
            orderBy: { createdAt: 'desc' },
            take: 10,
        }),
        prisma.notificationLog.count({
            where: {
                recipientType: 'STAFF',
                recipientId: session.user.id,
                channel: 'IN_APP',
                notificationType: { in: ['BACKGROUND_JOB_DONE', 'BACKGROUND_JOB_FAILED'] },
                readAt: null,
            },
        }),
    ]);

    return {
        ok: true,
        activeJobs: activeJobs.map(toBackgroundJobView),
        notifications: notifications.map((notification) => ({
            id: notification.id,
            backgroundJobId: notification.backgroundJobId,
            title: notification.title,
            message: notification.message,
            notificationType: notification.notificationType,
            readAt: notification.readAt?.toISOString() ?? null,
            createdAt: notification.createdAt.toISOString(),
        })),
        unreadCount,
    };
}

export async function markBackgroundJobNotificationsRead() {
    const session = await auth();
    if (!session?.user || session.user.userKind !== 'staff') return { ok: false as const, error: '권한이 없습니다.' };

    await prisma.notificationLog.updateMany({
        where: {
            recipientType: 'STAFF',
            recipientId: session.user.id,
            channel: 'IN_APP',
            notificationType: { in: ['BACKGROUND_JOB_DONE', 'BACKGROUND_JOB_FAILED'] },
            readAt: null,
        },
        data: { readAt: new Date() },
    });
    return { ok: true as const };
}
