'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
    Calendar,
    Search,
    RefreshCw,
    AlertCircle,
    Loader2,
    Package,
    CheckCircle2,
    KeyRound,
    ShieldAlert,
} from 'lucide-react';
import {
    fetchHanwhaDispatch,
    refetchHanwhaDispatch,
    matchHanwhaDispatchRow,
} from '@/app/dispatch/actions';
import { hanwhaDriverInfo } from '@/lib/hanwha-dispatch';
import { isSameQuantity, matchProductToMaterial } from '@/lib/product-matching';
import { fmtDateTime, fmtNumber } from '@/lib/orders';

export interface DispatchRowVM {
    id: string;
    indoChiIndex: number;
    indoChiName: string;
    materialName: string | null;
    materialNameRaw: string | null;
    quantityKg: number | null;
    rawCells: string[];
    matchedOrderId: string | null;
    matchedAt: string | null;
}

export interface DispatchSnapshotVM {
    fetchedAt: string;
    status: string;
    errorMessage: string | null;
    rowCount: number;
    rows: DispatchRowVM[];
}

export interface MatchCandidateItemVM {
    productId: string;
    productName: string;
    productCode: string;
    quantityTon: number;
    dispatchedQuantityTon: number;
    remainingQuantityTon: number;
}

export interface MatchCandidateVM {
    id: string;
    orderNo: string;
    customerName: string;
    customerCode: string;
    addressLabel: string;
    addressLine1: string;
    requestedDeliveryDate: string | null;
    itemSummary: string;
    items: MatchCandidateItemVM[];
}

type AutoMatchHit = {
    order: MatchCandidateVM;
    score: number;
    reason: string;
};

function normalizeCompanyMatchText(value: string) {
    return value
        .toLowerCase()
        .replace(/주식회사|\(주\)|㈜|\s/g, '')
        .replace(/[()\[\]{}.,/\\_-]/g, '')
        .replace(/앤/g, '엔')
        .trim();
}

export default function DispatchClient({
    defaultDate,
    initial,
    canManageCredentials,
    matchCandidates,
}: {
    defaultDate: string;
    initial: DispatchSnapshotVM | null;
    canManageCredentials: boolean;
    matchCandidates: MatchCandidateVM[];
}) {
    const router = useRouter();
    const [date, setDate] = useState(defaultDate);
    const [pending, startTransition] = useTransition();
    const [matchPending, startMatchTransition] = useTransition();
    const [snapshot, setSnapshot] = useState<DispatchSnapshotVM | null>(initial);
    const [selectedOrders, setSelectedOrders] = useState<Record<string, string>>({});
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);

    function go(action: 'fetch' | 'refetch') {
        setError(null);
        setInfo(null);
        startTransition(async () => {
            let r;
            if (action === 'fetch') r = await fetchHanwhaDispatch(date);
            else r = await refetchHanwhaDispatch(date);

            if (!r.ok) {
                setError(r.error);
                return;
            }
            if ('cached' in r) {
                setInfo(
                    r.cached
                        ? `캐시에서 ${r.rowCount}건을 표시합니다. (재조회를 누르면 한화 사이트에서 새로 가져옵니다)`
                        : `한화 사이트에서 새로 가져온 ${r.rowCount}건을 저장했습니다.`,
                );
                setSnapshot(r.snapshot);
            }
            router.push(`/admin/dispatch?date=${date}`);
            if (action !== 'fetch' || !('cached' in r) || !r.cached) router.refresh();
        });
    }

    function doMatch(rowId: string, orderId: string) {
        setError(null);
        setInfo(null);
        startMatchTransition(async () => {
            const r = await matchHanwhaDispatchRow(rowId, orderId);
            if (!r.ok) { setError(r.error); return; }
            const orderNo = matchCandidates.find((o) => o.id === orderId)?.orderNo ?? orderId;
            setInfo(`배차 라인과 [${orderNo}]을 매칭했습니다.`);
            setSnapshot((prev) => prev
                ? { ...prev, rows: prev.rows.map((row) => row.id === rowId ? { ...row, matchedOrderId: orderId, matchedAt: new Date().toISOString() } : row) }
                : prev);
            router.refresh();
        });
    }

    function match(rowId: string) {
        const orderId = selectedOrders[rowId];
        if (!orderId) { setError('매칭할 주문을 선택해주세요.'); return; }
        doMatch(rowId, orderId);
    }

    function autoMatch(line: DispatchRowVM) {
        const keywords = line.indoChiName
            .split(/[\s,./()\[\]]/)
            .filter((w) => w.length >= 2)
            .map((w) => w.toLowerCase());

        const scored = matchCandidates
            .map((order) => scoreAutoMatch(order, line, keywords, date))
            .filter((hit): hit is AutoMatchHit => hit !== null)
            .sort((a, b) => b.score - a.score);

        if (scored.length === 0) {
            setError(`「${line.indoChiName} / ${line.materialName ?? line.materialNameRaw ?? '-'}」에 품목·수량까지 맞는 배차대기 주문이 없습니다. 수동매칭을 이용해주세요.`);
            return;
        }

        const best = scored[0];
        const tied = scored.filter((hit) => best.score - hit.score <= 10);
        if (tied.length === 1 && best.score >= 100) {
            doMatch(line.id, best.order.id);
            return;
        }

        setError(
            `「${line.indoChiName} / ${line.materialName ?? line.materialNameRaw ?? '-'} ${line.quantityKg ?? '-'}TON」 ` +
            `자동매칭 후보가 ${tied.length}건입니다. ` +
            `(${tied.map((hit) => `${hit.order.orderNo}: ${hit.reason}`).join(', ')}) ` +
            `아래 드롭다운에서 주문을 선택 후 매칭 버튼을 눌러주세요.`
        );
    }

    const grouped = groupByIndoChi(snapshot?.rows ?? []);

    return (
        <div className="mt-6 space-y-6">
            <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <div className="flex items-end gap-3 flex-wrap">
                    <label className="block">
                        <span className="block text-xs font-medium text-slate-500 mb-1.5">
                            <Calendar size={12} className="inline mr-1" /> 조회 일자
                        </span>
                        <input
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            disabled={pending}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
                        />
                    </label>
                    <button
                        type="button"
                        onClick={() => go('fetch')}
                        disabled={pending}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-semibold shadow-sm disabled:opacity-60"
                    >
                        {pending ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                        배차 조회
                    </button>
                    {initial && (
                        <div className="ml-4 border-l border-slate-200 pl-4">
                            <button
                                type="button"
                                onClick={() => {
                                    if (!window.confirm('정말 한화 사이트에서 배차 내역을 새로 불러올까요? 기존 조회 내역은 새 데이터로 교체됩니다.')) return;
                                    go('refetch');
                                }}
                                disabled={pending}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white px-3 py-2 text-sm font-semibold shadow-sm disabled:opacity-60"
                            >
                                <RefreshCw size={14} /> 재조회
                            </button>
                        </div>
                    )}
                </div>

                {pending && (
                    <p className="mt-3 text-xs text-slate-500">
                        한화 사이트에 자동 로그인하여 데이터를 가져오는 중입니다… 1~3분 정도 소요됩니다.
                    </p>
                )}

                {error && (
                    <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                        <AlertCircle size={16} className="mt-0.5 shrink-0" />
                        <span>{error}</span>
                    </div>
                )}
                {info && !error && (
                    <div className="mt-3 flex items-start gap-2 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-700">
                        <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                        <span>{info}</span>
                    </div>
                )}
            </section>

            {!snapshot ? (
                <div className="bg-slate-50 rounded-2xl border border-dashed border-slate-300 p-12 text-center text-sm text-slate-400">
                    아직 조회된 데이터가 없습니다. 위 &quot;배차 조회&quot;를 눌러주세요.
                </div>
            ) : (
                <>
                    {snapshot.status === 'AUTH_FAILED' && (
                        <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-5">
                            <div className="flex items-start gap-3">
                                <ShieldAlert size={24} className="text-red-600 shrink-0 mt-0.5" />
                                <div className="flex-1">
                                    <h3 className="font-bold text-red-800">한화 H-CRM 자동 로그인 실패</h3>
                                    <p className="mt-1 text-sm text-red-700 leading-relaxed">
                                        한화 사이트 비밀번호가 변경된 것으로 보입니다. 담당자(<b>양희철 대표</b> /{' '}
                                        <b>차성식 관리자</b>)에게 새 비밀번호 등록을 요청해주세요.
                                        등록 즉시 배차 조회가 정상화됩니다.
                                    </p>
                                    {canManageCredentials && (
                                        <Link
                                            href="/admin/settings/hanwha"
                                            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white px-3 py-2 text-sm font-semibold shadow-sm"
                                        >
                                            <KeyRound size={14} /> 한화 비밀번호 변경하기
                                        </Link>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="text-xs text-slate-500 flex items-center gap-3">
                        <span>
                            마지막 조회: {fmtDateTime(snapshot.fetchedAt)} · 인도처 {grouped.length}곳 · 라인 {snapshot.rowCount}건
                        </span>
                        {snapshot.status === 'FAILED' && (
                            <span className="text-red-600">⚠ {snapshot.errorMessage}</span>
                        )}
                    </div>

                    {grouped.length === 0 ? (
                        <div className="bg-slate-50 rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-400">
                            해당 일자의 배차 데이터가 없습니다.
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {grouped.map((g) => {
                                const total = g.lines.reduce((s, l) => s + (l.quantityKg ?? 0), 0);
                                return (
                                    <section key={g.indoChiName + g.indoChiIndex} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                                        <header className="px-6 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
                                            <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                                                <Package size={16} className="text-slate-500" />
                                                <span className="text-xs text-slate-400 font-mono">#{g.indoChiIndex}</span>
                                                {g.indoChiName}
                                            </h2>
                                            <span className="text-xs text-slate-500">
                                                라인 {g.lines.length}건 · 합계 {fmtNumber(total)} TON
                                            </span>
                                        </header>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-sm">
                                                <thead>
                                                    <tr className="bg-white text-left text-xs font-medium text-slate-500 uppercase">
                                                        <th className="px-4 py-2 w-10">#</th>
                                                        <th className="px-4 py-2">자재명</th>
                                                        <th className="px-4 py-2">한양 표기</th>
                                                        <th className="px-4 py-2 text-right">수량(TON)</th>
                                                        <th className="px-4 py-2">기사정보</th>
                                                        <th className="px-4 py-2 min-w-80">주문 매칭</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {g.lines.map((l, i) => (
                                                        <tr key={l.id} className="hover:bg-slate-50/60">
                                                            <td className="px-4 py-2 text-xs text-slate-400">{i + 1}</td>
                                                            <td className="px-4 py-2 text-xs font-mono text-slate-600">{l.materialNameRaw ?? '-'}</td>
                                                            <td className="px-4 py-2 font-medium text-slate-800">{l.materialName ?? '-'}</td>
                                                            <td className="px-4 py-2 text-right text-slate-700">{l.quantityKg != null ? fmtNumber(l.quantityKg) : '-'}</td>
                                                            <td className="px-4 py-2 text-xs text-slate-400">{hanwhaDriverInfo(l.rawCells)}</td>
                                                            <td className="px-4 py-2">
                                                                <div className="space-y-1.5">
                                                                    {l.matchedOrderId && (
                                                                        <div className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
                                                                            <CheckCircle2 size={12} />
                                                                            {matchCandidates.find((o) => o.id === l.matchedOrderId)?.orderNo ?? l.matchedOrderId}
                                                                            <span className="ml-1 text-slate-400 font-normal">(추가 매칭 가능)</span>
                                                                        </div>
                                                                    )}
                                                                    <div className="flex items-center gap-2">
                                                                        <button
                                                                            type="button"
                                                                            disabled={matchPending}
                                                                            onClick={() => autoMatch(l)}
                                                                            className="rounded-lg bg-blue-500 hover:bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50 shrink-0"
                                                                        >
                                                                            자동
                                                                        </button>
                                                                        <select
                                                                            value={selectedOrders[l.id] ?? ''}
                                                                            onChange={(e) => setSelectedOrders((prev) => ({ ...prev, [l.id]: e.target.value }))}
                                                                            disabled={matchPending}
                                                                            className="min-w-52 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-500 disabled:opacity-60"
                                                                        >
                                                                            <option value="">{l.matchedOrderId ? '추가 매칭할 주문 선택' : '수동 선택'}</option>
                                                                            {matchCandidates.map((o) => (
                                                                                <option key={o.id} value={o.id}>
                                                                                    {o.orderNo} · {o.customerName} · {o.addressLabel} · {o.itemSummary}
                                                                                </option>
                                                                            ))}
                                                                        </select>
                                                                        <button
                                                                            type="button"
                                                                            disabled={matchPending || !selectedOrders[l.id]}
                                                                            onClick={() => match(l.id)}
                                                                            className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 shrink-0"
                                                                        >
                                                                            매칭
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </section>
                                );
                            })}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

function scoreAutoMatch(
    order: MatchCandidateVM,
    line: DispatchRowVM,
    keywords: string[],
    dispatchDate: string,
): AutoMatchHit | null {
    const hay = [order.customerName, order.addressLabel, order.addressLine1].join(' ').toLowerCase();
    const normalizedHay = normalizeCompanyMatchText(hay);
    const normalizedIndoChiName = normalizeCompanyMatchText(line.indoChiName);
    const addressHits = keywords.filter((kw) => hay.includes(kw));
    const normalizedAddressHit = Boolean(normalizedIndoChiName) && normalizedHay.includes(normalizedIndoChiName);
    if (addressHits.length === 0 && !normalizedAddressHit) return null;

    const materialExists = Boolean(line.materialName || line.materialNameRaw);
    const itemHits = order.items
        .map((item) => {
            const productMatch = matchProductToMaterial(
                { productName: item.productName, productCode: item.productCode },
                { materialName: line.materialName, materialNameRaw: line.materialNameRaw },
            );
            if (materialExists && !productMatch.matches) return null;

            const lineQuantity = line.quantityKg;
            const remainingQuantity = item.remainingQuantityTon;
            if (Number.isFinite(lineQuantity) && remainingQuantity <= 0) return null;

            let quantityScore = 0;
            if (Number.isFinite(lineQuantity)) {
                if (isSameQuantity(remainingQuantity, lineQuantity)) quantityScore += 40;
                else if (remainingQuantity >= Number(lineQuantity)) quantityScore += 25;
                if (isSameQuantity(item.quantityTon, lineQuantity)) quantityScore += 20;
                else if (item.quantityTon > Number(lineQuantity)) quantityScore += 10;
            }

            return {
                score: productMatch.score + quantityScore,
                reason: `${productMatch.reason}, 잔량 ${fmtNumber(remainingQuantity)}TON / 주문 ${fmtNumber(item.quantityTon)}TON`,
            };
        })
        .filter((hit): hit is { score: number; reason: string } => hit !== null)
        .sort((a, b) => b.score - a.score);

    if (itemHits.length === 0) return null;

    const deliveryDate = order.requestedDeliveryDate?.slice(0, 10) ?? null;
    const dateExact = deliveryDate === dispatchDate;
    const bestItem = itemHits[0];
    const addressScore = Math.max(addressHits.length * 15, normalizedAddressHit ? 30 : 0);
    const score = addressScore + (dateExact ? 35 : -30) + bestItem.score;

    if (score < 70) return null;

    return {
        order,
        score,
        reason: `${dateExact ? '도착일 일치' : '도착일 불일치'}, ${bestItem.reason}`,
    };
}

function groupByIndoChi(rows: DispatchRowVM[]) {
    const m = new Map<string, { indoChiIndex: number; indoChiName: string; lines: DispatchRowVM[] }>();
    for (const r of rows) {
        const key = `${r.indoChiIndex}|${r.indoChiName}`;
        if (!m.has(key)) {
            m.set(key, { indoChiIndex: r.indoChiIndex, indoChiName: r.indoChiName, lines: [] });
        }
        m.get(key)!.lines.push(r);
    }
    return Array.from(m.values()).sort((a, b) => a.indoChiIndex - b.indoChiIndex);
}
