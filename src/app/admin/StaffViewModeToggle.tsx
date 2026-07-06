'use client';

import { useEffect, useState } from 'react';

type StaffViewMode = 'mobile' | 'desktop';

const STORAGE_KEY = 'hanyang-staff-view-mode';
const EVENT_NAME = 'staffViewChange';

export default function StaffViewModeToggle({ short = false }: { short?: boolean }) {
    const [mode, setMode] = useState<StaffViewMode | null>(null);

    useEffect(() => {
        const stored = window.localStorage.getItem(STORAGE_KEY) as StaffViewMode | null;
        const initialMode = stored === 'desktop' || stored === 'mobile'
            ? stored
            : window.matchMedia('(max-width: 767px)').matches ? 'mobile' : 'desktop';
        setMode(initialMode);
        document.documentElement.dataset.staffView = initialMode;

        const handler = (e: Event) => {
            const newMode = (e as CustomEvent<StaffViewMode>).detail;
            setMode(newMode);
        };
        window.addEventListener(EVENT_NAME, handler);
        return () => {
            window.removeEventListener(EVENT_NAME, handler);
            delete document.documentElement.dataset.staffView;
        };
    }, []);

    function toggleMode() {
        const nextMode: StaffViewMode = mode === 'mobile' ? 'desktop' : 'mobile';
        setMode(nextMode);
        window.localStorage.setItem(STORAGE_KEY, nextMode);
        document.documentElement.dataset.staffView = nextMode;
        window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: nextMode }));
    }

    if (mode === null) return null;

    if (short) {
        return (
            <button
                type="button"
                onClick={toggleMode}
                className="rounded-full border border-orange-300 bg-orange-50 px-2.5 py-1.5 text-xs font-bold text-orange-700 hover:bg-orange-100 transition whitespace-nowrap"
            >
                {mode === 'mobile' ? '웹' : '모바일'}
            </button>
        );
    }

    return (
        <button
            type="button"
            onClick={toggleMode}
            className="rounded-full border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-700 hover:bg-orange-100 transition whitespace-nowrap"
        >
            {mode === 'mobile' ? '웹 화면 보기' : '모바일 화면 보기'}
        </button>
    );
}
