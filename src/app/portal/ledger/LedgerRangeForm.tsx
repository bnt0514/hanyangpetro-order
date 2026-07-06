'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function LedgerRangeForm({ from, to }: { from: string; to: string }) {
    const router = useRouter();
    const pathname = usePathname();
    const [fromValue, setFromValue] = useState(from);
    const [toValue, setToValue] = useState(to);

    useEffect(() => {
        setFromValue(from);
        setToValue(to);
    }, [from, to]);

    function submitRange(f: string, t: string) {
        setFromValue(f);
        setToValue(t);
        router.push(`${pathname}?from=${f}&to=${t}`);
    }

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        submitRange(fromValue, toValue);
    }

    function goLastMonth() {
        const today = new Date();
        const y = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
        const m = today.getMonth() === 0 ? 12 : today.getMonth();
        const firstDay = `${y}-${String(m).padStart(2, '0')}-01`;
        const lastDay = new Date(y, m, 0);
        const lastDayStr = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;
        submitRange(firstDay, lastDayStr);
    }

    function goThisMonth() {
        const today = new Date();
        const y = today.getFullYear();
        const m = today.getMonth() + 1;
        const firstDay = `${y}-${String(m).padStart(2, '0')}-01`;
        const todayStr = `${y}-${String(m).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        submitRange(firstDay, todayStr);
    }

    function goRecentThreeMonths() {
        const today = new Date();
        const fromDate = new Date(today.getFullYear(), today.getMonth() - 2, 1);
        const firstDay = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}-01`;
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        submitRange(firstDay, todayStr);
    }

    return (
        <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 text-sm">
            <button
                type="button"
                onClick={goLastMonth}
                className="rounded-lg bg-teal-600 px-3 py-1.5 font-semibold text-white hover:bg-teal-700 transition-colors"
            >
                전월
            </button>
            <button
                type="button"
                onClick={goThisMonth}
                className="rounded-lg bg-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-300 transition-colors"
            >
                당월
            </button>
            <button
                type="button"
                onClick={goRecentThreeMonths}
                className="rounded-lg bg-slate-100 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-200 transition-colors"
            >
                최근 3개월
            </button>
            <span className="text-slate-300">|</span>
            <input type="date" name="from" value={fromValue} onChange={(e) => setFromValue(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1" />
            <span className="text-slate-400">~</span>
            <input type="date" name="to" value={toValue} onChange={(e) => setToValue(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1" />
            <button type="submit" className="rounded-lg bg-slate-800 px-3 py-1.5 font-semibold text-white hover:bg-slate-700 transition-colors">조회</button>
        </form>
    );
}
