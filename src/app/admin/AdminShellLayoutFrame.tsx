'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

type StaffViewMode = 'mobile' | 'desktop';

const STORAGE_KEY = 'hanyang-staff-view-mode';
const EVENT_NAME = 'staffViewChange';

function readMode(): StaffViewMode {
    if (typeof window === 'undefined') return 'desktop';
    const stored = window.localStorage.getItem(STORAGE_KEY) as StaffViewMode | null;
    const canUseMobileView = window.matchMedia('(max-width: 767px) and (pointer: coarse)').matches;
    if (stored === 'desktop') return 'desktop';
    if (stored === 'mobile' && canUseMobileView) return 'mobile';
    return canUseMobileView ? 'mobile' : 'desktop';
}

export default function AdminShellLayoutFrame({
    sidebar,
    children,
}: {
    sidebar: ReactNode;
    children: ReactNode;
}) {
    const [mode, setMode] = useState<StaffViewMode>('desktop');
    const [isNarrow, setIsNarrow] = useState(false);

    useEffect(() => {
        const media = window.matchMedia('(max-width: 767px)');

        function applyMode() {
            setMode(readMode());
            setIsNarrow(media.matches);
        }

        applyMode();

        const viewHandler = (e: Event) => {
            const nextMode = (e as CustomEvent<StaffViewMode>).detail;
            setMode(nextMode);
            setIsNarrow(media.matches);
        };

        window.addEventListener(EVENT_NAME, viewHandler);
        media.addEventListener('change', applyMode);
        return () => {
            window.removeEventListener(EVENT_NAME, viewHandler);
            media.removeEventListener('change', applyMode);
        };
    }, []);

    const isMobileMode = mode === 'mobile';

    return (
        <div
            className="admin-shell-layout bg-[#fff7ed]"
            style={isMobileMode ? {
                display: 'block',
                height: 'auto',
                minHeight: 'calc(100dvh - 3rem)',
                minWidth: 0,
                overflow: 'visible',
            } : {
                display: 'grid',
                gridTemplateColumns: isNarrow ? '300px minmax(800px, 1fr)' : '300px minmax(0, 1fr)',
                height: 'calc(100vh - 3rem)',
                minHeight: 'calc(100vh - 3rem)',
                minWidth: isNarrow ? 1100 : 0,
                overflow: 'hidden',
            }}
        >
            <aside
                className="admin-shell-sidebar staff-desktop-view border-r border-orange-100 bg-orange-50 px-5 py-5"
                style={isMobileMode ? {
                    display: 'none',
                } : {
                    display: 'block',
                    height: 'calc(100vh - 3rem)',
                    minHeight: 0,
                    width: 300,
                    minWidth: 300,
                    overflowY: 'auto',
                    overscrollBehavior: 'contain',
                }}
            >
                {sidebar}
            </aside>
            <main
                className="admin-shell-main"
                style={isMobileMode ? {
                    height: 'auto',
                    minHeight: 'auto',
                    minWidth: 0,
                    overflowY: 'visible',
                    overscrollBehavior: 'auto',
                } : {
                    height: 'calc(100vh - 3rem)',
                    minHeight: 'calc(100vh - 3rem)',
                    minWidth: 0,
                    overflowY: 'auto',
                    overscrollBehavior: 'contain',
                }}
            >
                {children}
            </main>
        </div>
    );
}
