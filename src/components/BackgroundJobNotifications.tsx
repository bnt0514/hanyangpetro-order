'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { Bell, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import {
    getBackgroundJobNotifications,
    markBackgroundJobNotificationsRead,
    type BackgroundJobNotificationView,
} from '@/app/background-jobs/actions';
import type { BackgroundJobView } from '@/lib/background-jobs';

function statusLabel(status: string) {
    if (status === 'QUEUED') return '대기';
    if (status === 'RUNNING') return '진행중';
    if (status === 'DONE') return '완료';
    if (status === 'FAILED') return '실패';
    return status;
}

function relativeTime(value: string) {
    const diffMs = Date.now() - new Date(value).getTime();
    const diffMin = Math.max(0, Math.floor(diffMs / 60000));
    if (diffMin < 1) return '방금';
    if (diffMin < 60) return `${diffMin}분 전`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}시간 전`;
    return new Date(value).toLocaleDateString('ko-KR');
}

export default function BackgroundJobNotifications() {
    const [open, setOpen] = useState(false);
    const [activeJobs, setActiveJobs] = useState<BackgroundJobView[]>([]);
    const [notifications, setNotifications] = useState<BackgroundJobNotificationView[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    const activeCount = activeJobs.length;
    const badgeCount = activeCount + unreadCount;
    const unreadIds = useMemo(
        () => notifications.filter((notification) => !notification.readAt).map((notification) => notification.id),
        [notifications],
    );

    async function load() {
        const result = await getBackgroundJobNotifications();
        if (!result.ok) {
            setError(result.error);
            return;
        }
        setError(null);
        setActiveJobs(result.activeJobs);
        setNotifications(result.notifications);
        setUnreadCount(result.unreadCount);
    }

    useEffect(() => {
        const initialTimer = window.setTimeout(() => void load(), 0);
        const intervalTimer = window.setInterval(() => void load(), 5000);
        return () => {
            window.clearTimeout(initialTimer);
            window.clearInterval(intervalTimer);
        };
    }, []);

    function markRead() {
        if (unreadIds.length === 0) return;
        startTransition(async () => {
            const result = await markBackgroundJobNotificationsRead(unreadIds);
            if (!result.ok) {
                setError(result.error);
                return;
            }
            await load();
        });
    }

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                className="relative inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:border-orange-200 hover:text-orange-700"
            >
                {activeCount > 0 ? <Loader2 size={14} className="animate-spin" /> : <Bell size={14} />}
                작업
                {badgeCount > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-600 px-1 text-[10px] font-black text-white">
                        {badgeCount > 9 ? '9+' : badgeCount}
                    </span>
                )}
            </button>

            {open && (
                <div className="absolute right-0 z-50 mt-2 w-80 rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-xl">
                    <div className="mb-2 flex items-center justify-between">
                        <span className="font-black text-slate-900">백그라운드 작업</span>
                        <button
                            type="button"
                            onClick={markRead}
                            disabled={pending || unreadIds.length === 0}
                            className="rounded-md px-2 py-1 font-bold text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                        >
                            모두 읽음
                        </button>
                    </div>

                    {error && (
                        <div className="mb-2 rounded-md bg-red-50 px-3 py-2 font-semibold text-red-700">
                            {error}
                        </div>
                    )}

                    {activeJobs.length > 0 && (
                        <div className="mb-3 space-y-2">
                            {activeJobs.map((job) => (
                                <div key={job.id} className="rounded-md border border-orange-100 bg-orange-50 px-3 py-2">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="font-black text-orange-900">{job.title}</span>
                                        <span className="shrink-0 font-bold text-orange-700">{statusLabel(job.status)}</span>
                                    </div>
                                    {job.message && <p className="mt-1 line-clamp-2 font-semibold text-orange-800">{job.message}</p>}
                                </div>
                            ))}
                        </div>
                    )}

                    {notifications.length === 0 ? (
                        <div className="rounded-md bg-slate-50 px-3 py-6 text-center font-semibold text-slate-400">
                            표시할 작업 알림이 없습니다.
                        </div>
                    ) : (
                        <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                            {notifications.map((notification) => {
                                const failed = notification.notificationType.includes('FAILED');
                                return (
                                    <div
                                        key={notification.id}
                                        className={`rounded-md border px-3 py-2 ${notification.readAt ? 'border-slate-100 bg-white' : 'border-slate-200 bg-slate-50'}`}
                                    >
                                        <div className="flex items-start gap-2">
                                            {failed ? (
                                                <XCircle size={14} className="mt-0.5 shrink-0 text-red-500" />
                                            ) : (
                                                <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-500" />
                                            )}
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="truncate font-black text-slate-900">{notification.title}</span>
                                                    <span className="shrink-0 text-[10px] font-bold text-slate-400">{relativeTime(notification.createdAt)}</span>
                                                </div>
                                                <p className="mt-1 line-clamp-2 font-semibold text-slate-600">{notification.message}</p>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
