'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { Loader2, Save, Search } from 'lucide-react';
import { bulkUpdateLedgerUnitPrices } from './actions';

export type LedgerPriceRow = {
    key: string;
    mode: 'SALES' | 'PURCHASE';
    rowId: string;
    transactionDate: string;
    counterpartyName: string;
    orderId: string | null;
    orderNo: string;
    productId: string | null;
    productName: string;
    productCode: string;
    brand: string;
    productGroup: string;
    quantity: number;
    unit: string;
    unitPrice: number | null;
    amount: number | null;
    rowSource: string;
};

function money(value: number | null) {
    return value == null ? '-' : Math.round(value).toLocaleString('ko-KR');
}

function normalize(value: string) {
    return value.toLowerCase().replace(/\s+/g, '');
}

export default function LedgerPriceEditSection({
    rows,
    month,
    links,
}: {
    rows: LedgerPriceRow[];
    month: string;
    links: { current: string; prev: string; next: string };
}) {
    const [mode, setMode] = useState<'SALES' | 'PURCHASE' | 'ALL'>('SALES');
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState<Record<string, boolean>>({});
    const [prices, setPrices] = useState<Record<string, string>>({});
    const [reason, setReason] = useState('');
    const [message, setMessage] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    const visibleRows = useMemo(() => {
        const q = normalize(query);
        return rows.filter((row) => {
            if (mode !== 'ALL' && row.mode !== mode) return false;
            if (!q) return true;
            return normalize(`${row.transactionDate} ${row.counterpartyName} ${row.orderNo} ${row.productName} ${row.productCode} ${row.brand} ${row.productGroup}`).includes(q);
        });
    }, [mode, query, rows]);

    const selectedRows = visibleRows.filter((row) => selected[row.key]);
    const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((row) => selected[row.key]);

    function toggleAll() {
        setSelected((prev) => {
            const next = { ...prev };
            for (const row of visibleRows) next[row.key] = !allVisibleSelected;
            return next;
        });
    }

    function save() {
        setMessage(null);
        if (!reason.trim()) {
            setMessage('수정 사유를 입력해 주세요.');
            return;
        }
        const updates = selectedRows.map((row) => {
            const parsed = Number(String(prices[row.key] ?? '').replace(/,/g, ''));
            return { rowId: row.rowId, unitPrice: parsed };
        }).filter((item) => Number.isFinite(item.unitPrice) && item.unitPrice >= 0);
        if (updates.length === 0) {
            setMessage('선택한 행과 입력한 단가를 확인해 주세요.');
            return;
        }
        const targetMode = selectedRows[0]?.mode;
        if (!targetMode || selectedRows.some((row) => row.mode !== targetMode)) {
            setMessage('매출과 매입은 나눠서 저장해 주세요.');
            return;
        }
        startTransition(async () => {
            const result = await bulkUpdateLedgerUnitPrices({ mode: targetMode, reason, updates });
            setMessage(result.ok ? `${result.count}건 저장했습니다.` : result.error);
        });
    }

    return (
        <section className="space-y-4">
            <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
                선택 월의 실제 거래처원장 행을 불러옵니다. 단가를 수정하면 연결된 오더 품목과 원장 금액이 같이 변경됩니다.
            </div>

            <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200 bg-white p-4">
                <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-500">기준월</label>
                    <input type="month" value={month} readOnly className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm" />
                </div>
                <Link href={links.current} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">당월</Link>
                <Link href={links.prev} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">1개월 전</Link>
                <Link href={links.next} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">1개월 후</Link>
                <select value={mode} onChange={(event) => setMode(event.target.value as 'SALES' | 'PURCHASE' | 'ALL')} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
                    <option value="SALES">매출단가</option>
                    <option value="PURCHASE">매입단가</option>
                    <option value="ALL">전체</option>
                </select>
                <div className="relative min-w-64 flex-1">
                    <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="거래처, 오더번호, 품목 검색" className="w-full rounded-xl border border-slate-300 py-2 pl-9 pr-3 text-sm" />
                </div>
            </div>

            <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200 bg-white p-4">
                <label className="min-w-72 flex-1 space-y-1 text-sm">
                    <span className="font-medium text-slate-700">수정 사유</span>
                    <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="예: 월별 단가 정정" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                </label>
                <button type="button" onClick={save} disabled={pending || selectedRows.length === 0} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                    {pending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    선택 {selectedRows.length}건 저장
                </button>
                {message && <p className="text-sm font-medium text-blue-700">{message}</p>}
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                <table className="w-full min-w-[1120px] text-sm">
                    <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
                        <tr>
                            <th className="px-4 py-3 text-left"><button type="button" onClick={toggleAll} className="rounded border border-slate-300 bg-white px-2 py-1">{allVisibleSelected ? '전체해제' : '전체선택'}</button></th>
                            <th className="px-4 py-3 text-left">일자</th>
                            <th className="px-4 py-3 text-left">구분</th>
                            <th className="px-4 py-3 text-left">거래처</th>
                            <th className="px-4 py-3 text-left">오더</th>
                            <th className="px-4 py-3 text-left">품목</th>
                            <th className="px-4 py-3 text-left">브랜드/품목군</th>
                            <th className="px-4 py-3 text-right">수량</th>
                            <th className="px-4 py-3 text-right">현재단가</th>
                            <th className="px-4 py-3 text-right">변경단가</th>
                            <th className="px-4 py-3 text-right">공급가액</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {visibleRows.map((row) => (
                            <tr key={row.key} className="hover:bg-slate-50">
                                <td className="px-4 py-3"><input type="checkbox" checked={Boolean(selected[row.key])} onChange={(event) => setSelected((prev) => ({ ...prev, [row.key]: event.target.checked }))} /></td>
                                <td className="px-4 py-3">{row.transactionDate}</td>
                                <td className="px-4 py-3">{row.mode === 'SALES' ? '매출' : '매입'}</td>
                                <td className="px-4 py-3 font-medium text-slate-800">{row.counterpartyName}</td>
                                <td className="px-4 py-3 font-mono text-xs">{row.orderId ? <Link href={`/admin/orders/${row.orderId}`} className="text-blue-700 hover:underline">{row.orderNo}</Link> : '-'}</td>
                                <td className="px-4 py-3">{row.productName}<span className="ml-2 font-mono text-xs text-slate-400">{row.productCode}</span></td>
                                <td className="px-4 py-3 text-slate-500">{row.brand} / {row.productGroup}</td>
                                <td className="px-4 py-3 text-right">{row.quantity.toLocaleString('ko-KR')} {row.unit}</td>
                                <td className="px-4 py-3 text-right">{money(row.unitPrice)}</td>
                                <td className="px-4 py-3 text-right"><input value={prices[row.key] ?? ''} onChange={(event) => setPrices((prev) => ({ ...prev, [row.key]: event.target.value }))} placeholder="변경 단가" inputMode="numeric" className="w-32 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm" /></td>
                                <td className="px-4 py-3 text-right">{money(row.amount)}</td>
                            </tr>
                        ))}
                        {visibleRows.length === 0 && (
                            <tr><td colSpan={11} className="px-4 py-12 text-center text-slate-400">조회된 원장 단가 행이 없습니다.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
            <p className="text-right text-xs text-slate-400">{visibleRows.length.toLocaleString('ko-KR')} / {rows.length.toLocaleString('ko-KR')}건</p>
        </section>
    );
}
