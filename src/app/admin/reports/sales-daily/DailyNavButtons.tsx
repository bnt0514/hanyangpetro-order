'use client';

import Link from 'next/link';

type Props = {
    from: string;
    to: string;
    mode: string;
    groupBy: string;
};

function buildUrl(params: Record<string, string>) {
    return `/admin/reports/sales-daily?${new URLSearchParams(params).toString()}`;
}

function shiftDay(dateStr: string, n: number): string {
    const d = new Date(`${dateStr}T00:00:00`);
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftMonth(dateStr: string, n: number): string {
    const d = new Date(`${dateStr}T00:00:00`);
    d.setMonth(d.getMonth() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function firstOfMonth(dateStr: string): string {
    const d = new Date(`${dateStr}T00:00:00`);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function todayIso(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function yesterdayIso(): string {
    return shiftDay(todayIso(), -1);
}

function lastMonthFrom(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}-01`.replace('-00-', '-12-').replace(/-(\d)-/, '-0$1-');
}

function last3MonthsFrom(): string {
    const d = new Date();
    d.setMonth(d.getMonth() - 2);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export default function DailyNavButtons({ from, to, mode, groupBy }: Props) {
    const today = todayIso();
    const yesterday = yesterdayIso();

    // last month: first day of last month ~ last day of last month
    const lastMonthFirst = (() => {
        const d = new Date();
        d.setMonth(d.getMonth() - 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    })();
    const lastMonthLast = (() => {
        const d = new Date();
        d.setDate(0); // last day of prev month
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();

    // last 3 months: first day of 3 months ago ~ today
    const threeMonthsFrom = last3MonthsFrom();

    const base = { mode, groupBy };

    const btnCls = (active = false) =>
        `rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${active
            ? 'border-blue-600 bg-blue-600 text-white'
            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
        }`;

    const navBtnCls =
        'rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition';
    const todayActiveBtnCls =
        'rounded-lg border border-emerald-500 bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition';

    return (
        <div className="flex flex-wrap items-center gap-2">
            {/* Day navigation */}
            <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1">
                <Link
                    scroll={false}
                    href={buildUrl({ ...base, from: shiftDay(from, -1), to: shiftDay(to, -1) })}
                    className={navBtnCls}
                >← 전날</Link>
                <Link
                    scroll={false}
                    href={buildUrl({ ...base, from: today, to: today })}
                    className={todayActiveBtnCls}
                >오늘</Link>
                <Link
                    scroll={false}
                    href={buildUrl({ ...base, from: shiftDay(from, 1), to: shiftDay(to, 1) })}
                    className={navBtnCls}
                >다음날 →</Link>
            </div>

            {/* Month navigation */}
            <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1">
                <Link
                    scroll={false}
                    href={buildUrl({ ...base, from: firstOfMonth(shiftMonth(from, -1)), to: shiftMonth(to, -1) })}
                    className={navBtnCls}
                >← 전월</Link>
                <Link
                    scroll={false}
                    href={buildUrl({ ...base, from: firstOfMonth(today), to: today })}
                    className={navBtnCls}
                >이번달</Link>
                <Link
                    scroll={false}
                    href={buildUrl({ ...base, from: firstOfMonth(shiftMonth(from, 1)), to: shiftMonth(to, 1) })}
                    className={navBtnCls}
                >다음월 →</Link>
            </div>

            {/* Quick shortcuts */}
            <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-400">바로가기:</span>
                <Link
                    scroll={false}
                    href={buildUrl({ ...base, from: today, to: today })}
                    className={btnCls(from === today && to === today)}
                >당일</Link>
                <Link
                    scroll={false}
                    href={buildUrl({ ...base, from: yesterday, to: yesterday })}
                    className={btnCls(from === yesterday && to === yesterday)}
                >전일</Link>
                <Link
                    scroll={false}
                    href={buildUrl({ ...base, from: lastMonthFirst, to: lastMonthLast })}
                    className={btnCls(from === lastMonthFirst && to === lastMonthLast)}
                >1개월전</Link>
                <Link
                    scroll={false}
                    href={buildUrl({ ...base, from: threeMonthsFrom, to: today })}
                    className={btnCls(from === threeMonthsFrom && to === today)}
                >최근 3개월</Link>
            </div>
        </div>
    );
}
