'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
    Calendar,
    Search,
    RefreshCw,
    Trash2,
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
    clearHanwhaDispatch,
} from '@/app/dispatch/actions';
import { fmtDateTime, fmtNumber } from '@/lib/orders';

export interface DispatchRowVM {
    id: string;
    indoChiIndex: number;
    indoChiName: string;
    materialName: string | null;
    materialNameRaw: string | null;
    quantityKg: number | null;
    rawCells: string[];
}

export interface DispatchSnapshotVM {
    fetchedAt: string;
    status: string;
    errorMessage: string | null;
    rowCount: number;
    rows: DispatchRowVM[];
}

export default function DispatchClient({
    defaultDate,
    initial,
    canManageCredentials,
}: {
    defaultDate: string;
    initial: DispatchSnapshotVM | null;
    canManageCredentials: boolean;
}) {
    const router = useRouter();
    const [date, setDate] = useState(defaultDate);
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);

    function go(action: 'fetch' | 'refetch' | 'clear') {
        setError(null);
        setInfo(null);
        startTransition(async () => {
            let r;
            if (action === 'fetch') r = await fetchHanwhaDispatch(date);
            else if (action === 'refetch') r = await refetchHanwhaDispatch(date);
            else r = await clearHanwhaDispatch(date);

            if (!r.ok) {
                setError(r.error);
                return;
            }
            if (action === 'clear') {
                setInfo('저장된 데이터를 삭제했습니다.');
            } else if ('cached' in r) {
                setInfo(
                    r.cached
                        ? `캐시에서 ${r.rowCount}건을 표시합니다. (재조회를 누르면 한화 사이트에서 새로 가져옵니다)`
                        : `한화 사이트에서 새로 가져온 ${r.rowCount}건을 저장했습니다.`,
                );
            }
            // URL의 date 파라미터 업데이트 + 데이터 재로드
            router.push(`/admin/dispatch?date=${date}`);
            router.refresh();
        });
    }

    const grouped = groupByIndoChi(initial?.rows ?? []);

    return (
        <div className="mt-6 space-y-6">
            {/* 컨트롤 */}
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
                        {pending ? (
                            <Loader2 size={16} className="animate-spin" />
                        ) : (
                            <Search size={16} />
                        )}
                        배차 조회
                    </button>
                    {initial && (
                        <>
                            <button
                                type="button"
                                onClick={() => go('refetch')}
                                disabled={pending}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white px-3 py-2 text-sm font-semibold shadow-sm disabled:opacity-60"
                            >
                                <RefreshCw size={14} /> 재조회
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    if (!window.confirm('저장된 데이터를 삭제하시겠습니까?')) return;
                                    go('clear');
                                }}
                                disabled={pending}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white text-red-600 hover:bg-red-50 px-3 py-2 text-sm font-semibold disabled:opacity-60"
                            >
                                <Trash2 size={14} /> 삭제
                            </button>
                        </>
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

            {/* 결과 */}
            {!initial ? (
                <div className="bg-slate-50 rounded-2xl border border-dashed border-slate-300 p-12 text-center text-sm text-slate-400">
                    아직 조회된 데이터가 없습니다. 위 &quot;배차 조회&quot;를 눌러주세요.
                </div>
            ) : (
                <>
                    {/* 인증 실패 배너 (최우선) */}
                    {initial.status === 'AUTH_FAILED' && (
                        <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-5">
                            <div className="flex items-start gap-3">
                                <ShieldAlert size={24} className="text-red-600 shrink-0 mt-0.5" />
                                <div className="flex-1">
                                    <h3 className="font-bold text-red-800">
                                        한화 H-CRM 자동 로그인 실패
                                    </h3>
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
                            마지막 조회: {fmtDateTime(initial.fetchedAt)} · 인도처 {grouped.length}곳 · 라인 {initial.rowCount}건
                        </span>
                        {initial.status === 'FAILED' && (
                            <span className="text-red-600">⚠ {initial.errorMessage}</span>
                        )}
                    </div>

                    {grouped.length === 0 ? (
                        <div className="bg-slate-50 rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-400">
                            해당 일자의 배차 데이터가 없습니다.
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {grouped.map((g) => {
                                const total = g.lines.reduce(
                                    (s, l) => s + (l.quantityKg ?? 0),
                                    0,
                                );
                                return (
                                    <section
                                        key={g.indoChiName + g.indoChiIndex}
                                        className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
                                    >
                                        <header className="px-6 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
                                            <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                                                <Package size={16} className="text-slate-500" />
                                                <span className="text-xs text-slate-400 font-mono">
                                                    #{g.indoChiIndex}
                                                </span>
                                                {g.indoChiName}
                                            </h2>
                                            <span className="text-xs text-slate-500">
                                                라인 {g.lines.length}건 · 합계 {fmtNumber(total)} kg
                                            </span>
                                        </header>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-sm">
                                                <thead>
                                                    <tr className="bg-white text-left text-xs font-medium text-slate-500 uppercase">
                                                        <th className="px-4 py-2 w-10">#</th>
                                                        <th className="px-4 py-2">자재명</th>
                                                        <th className="px-4 py-2">한양 표기</th>
                                                        <th className="px-4 py-2 text-right">수량(kg)</th>
                                                        <th className="px-4 py-2">기타 정보</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {g.lines.map((l, i) => (
                                                        <tr key={l.id} className="hover:bg-slate-50/60">
                                                            <td className="px-4 py-2 text-xs text-slate-400">
                                                                {i + 1}
                                                            </td>
                                                            <td className="px-4 py-2 text-xs font-mono text-slate-600">
                                                                {l.materialNameRaw ?? '-'}
                                                            </td>
                                                            <td className="px-4 py-2 font-medium text-slate-800">
                                                                {l.materialName ?? '-'}
                                                            </td>
                                                            <td className="px-4 py-2 text-right text-slate-700">
                                                                {l.quantityKg != null
                                                                    ? fmtNumber(l.quantityKg)
                                                                    : '-'}
                                                            </td>
                                                            <td className="px-4 py-2 text-xs text-slate-400">
                                                                {l.rawCells
                                                                    .filter((_, idx) => idx !== 2 && idx !== 6)
                                                                    .filter((v) => v && v.length > 0)
                                                                    .join(' · ')}
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
