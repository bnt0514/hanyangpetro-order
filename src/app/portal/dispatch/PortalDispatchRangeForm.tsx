'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

function isoDate(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function rangeShortcut(days: number) {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - (days - 1));
    return { from: isoDate(from), to: isoDate(to) };
}

export default function PortalDispatchRangeForm({ from, to }: { from: string; to: string }) {
    const router = useRouter();
    const pathname = usePathname();
    const [fromValue, setFromValue] = useState(from);
    const [toValue, setToValue] = useState(to);

    useEffect(() => {
        setFromValue(from);
        setToValue(to);
    }, [from, to]);

    function submitRange(nextFrom: string, nextTo: string) {
        setFromValue(nextFrom);
        setToValue(nextTo);
        router.push(`${pathname}?from=${nextFrom}&to=${nextTo}`);
    }

    function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        submitRange(fromValue, toValue);
    }

    const today = isoDate(new Date());

    return (
        <form onSubmit={handleSubmit} className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="grid grid-cols-2 gap-2">
                <input type="date" name="from" value={fromValue} onChange={(event) => setFromValue(event.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                <input type="date" name="to" value={toValue} onChange={(event) => setToValue(event.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
                <RangeButton label="당일" onClick={() => submitRange(today, today)} />
                <RangeButton label="최근 1주일" onClick={() => {
                    const range = rangeShortcut(7);
                    submitRange(range.from, range.to);
                }} />
                <RangeButton label="최근 1개월" onClick={() => {
                    const range = rangeShortcut(31);
                    submitRange(range.from, range.to);
                }} />
                <RangeButton label="최근 3개월" onClick={() => {
                    const range = rangeShortcut(93);
                    submitRange(range.from, range.to);
                }} />
                <button type="submit" className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-bold text-white">조회</button>
            </div>
        </form>
    );
}

function RangeButton({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600"
        >
            {label}
        </button>
    );
}
