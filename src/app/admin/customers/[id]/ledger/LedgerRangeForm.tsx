'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useRef } from 'react';

function pad(n: number) { return String(n).padStart(2, '0'); }

function calcRanges() {
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth() + 1; // 1-indexed current month
    const d = today.getDate();
    const todayStr = `${y}-${pad(m)}-${pad(d)}`;

    // 당월: 1일 ~ 오늘
    const thisFrom = `${y}-${pad(m)}-01`;
    const thisTo = todayStr;

    // 전월: 전달 1일 ~ 전달 말일
    const prevY = m === 1 ? y - 1 : y;
    const prevM = m === 1 ? 12 : m - 1;
    const prevFrom = `${prevY}-${pad(prevM)}-01`;
    const prevLastDay = new Date(prevY, prevM, 0).getDate();
    const prevTo = `${prevY}-${pad(prevM)}-${pad(prevLastDay)}`;

    // 최근 3개월: 3달 전 1일 ~ 오늘
    const r3M = m - 2; // 당월 포함 3개월이면 현재월 - 2
    const r3Y = r3M <= 0 ? y - 1 : y;
    const r3MAdj = r3M <= 0 ? 12 + r3M : r3M;
    const recentFrom = `${r3Y}-${pad(r3MAdj)}-01`;
    const recentTo = todayStr;

    return { thisFrom, thisTo, prevFrom, prevTo, recentFrom, recentTo };
}

export default function LedgerRangeForm({ from, to }: { from: string; to: string }) {
    const router = useRouter();
    const pathname = usePathname();
    const fromRef = useRef<HTMLInputElement>(null);
    const toRef = useRef<HTMLInputElement>(null);

    const ranges = calcRanges();

    const isThisMonth = from === ranges.thisFrom && to === ranges.thisTo;
    const isLastMonth = from === ranges.prevFrom && to === ranges.prevTo;
    const isRecent3 = from === ranges.recentFrom && to === ranges.recentTo;

    function submitRange(f: string, t: string) {
        router.push(`${pathname}?from=${f}&to=${t}`);
    }

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        submitRange(fromRef.current!.value, toRef.current!.value);
    }

    const activeClass = 'rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white transition-colors';
    const inactiveClass = 'rounded-lg bg-slate-100 px-3 py-1.5 font-semibold text-slate-600 hover:bg-slate-200 transition-colors';

    return (
        <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 text-sm">
            <button type="button" onClick={() => submitRange(ranges.recentFrom, ranges.recentTo)}
                className={isRecent3 ? activeClass : inactiveClass}>
                최근 3개월
            </button>
            <button type="button" onClick={() => submitRange(ranges.prevFrom, ranges.prevTo)}
                className={isLastMonth ? activeClass : inactiveClass}>
                전월
            </button>
            <button type="button" onClick={() => submitRange(ranges.thisFrom, ranges.thisTo)}
                className={isThisMonth ? activeClass : inactiveClass}>
                당월
            </button>
            <span className="text-slate-300">|</span>
            <input ref={fromRef} type="date" name="from" defaultValue={from} key={from} className="rounded-lg border border-slate-200 px-2 py-1" />
            <span className="text-slate-400">~</span>
            <input ref={toRef} type="date" name="to" defaultValue={to} key={to} className="rounded-lg border border-slate-200 px-2 py-1" />
            <button type="submit" className="rounded-lg bg-slate-800 px-3 py-1.5 font-semibold text-white hover:bg-slate-700 transition-colors">조회</button>
        </form>
    );
}
