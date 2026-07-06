'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

type Props = {
    from: string;
    to: string;
    mode: string;
    groupBy: string;
    filterQ: string;
};

export default function DailyDateRangeForm({ from, to, mode, groupBy, filterQ }: Props) {
    const router = useRouter();
    const pathname = usePathname();
    const [fromValue, setFromValue] = useState(from);
    const [toValue, setToValue] = useState(to);
    const [filterValue, setFilterValue] = useState(filterQ);

    // URL이 바뀔 때(버튼 클릭 등) 입력칸도 즉시 업데이트
    useEffect(() => {
        setFromValue(from);
        setToValue(to);
        setFilterValue(filterQ);
    }, [from, to, filterQ]);

    function buildUrl(f: string, t: string, fq: string) {
        const params: Record<string, string> = { from: f, to: t, mode, groupBy };
        if (fq) params.filterQ = fq;
        const sp = new URLSearchParams(params);
        return `${pathname}?${sp.toString()}`;
    }

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        router.push(buildUrl(fromValue, toValue, filterValue));
    }

    // groupBy가 바뀔 때 필터 입력 초기화 (품목↔거래처 전환)
    useEffect(() => {
        setFilterValue('');
    }, [groupBy]);

    const filterPlaceholder =
        groupBy === 'product' ? '품목명 검색 (예: PP, HDPE...)' :
            groupBy === 'customer' ? '거래처명 검색 (예: 한양...)' :
                null;

    return (
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 text-sm">
            <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-500">조회 기간</span>
                <div className="flex items-center gap-1.5">
                    <input
                        type="date"
                        value={fromValue}
                        onChange={(e) => setFromValue(e.target.value)}
                        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
                    />
                    <span className="text-slate-400">~</span>
                    <input
                        type="date"
                        value={toValue}
                        onChange={(e) => setToValue(e.target.value)}
                        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
                    />
                </div>
            </div>
            {filterPlaceholder && (
                <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-500">
                        {groupBy === 'product' ? '품목 검색' : '거래처 검색'}
                    </span>
                    <input
                        type="text"
                        value={filterValue}
                        onChange={(e) => setFilterValue(e.target.value)}
                        placeholder={filterPlaceholder}
                        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm w-52"
                    />
                </div>
            )}
            <button
                type="submit"
                className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800"
            >
                조회
            </button>
        </form>
    );
}
