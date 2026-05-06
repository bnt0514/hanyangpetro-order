'use client';

import { useState, useTransition } from 'react';
import {
    AlertTriangle,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    Loader2,
    ShieldAlert,
    ShieldCheck,
} from 'lucide-react';
import { simulateCreditCheck, requestCreditOverride, type CreditSimResult } from './actions';

function fmt(n: number) {
    return n.toLocaleString('ko-KR') + '원';
}

function Bar({ value, limit }: { value: number; limit: number }) {
    if (limit <= 0) return null;
    const pct = Math.min((value / limit) * 100, 100);
    const color = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-400' : 'bg-emerald-500';
    return (
        <div className="w-full bg-slate-100 rounded-full h-2 mt-1">
            <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${pct}%` }} />
        </div>
    );
}

export default function CreditSimulationPanel({ orderId }: { orderId: string }) {
    const [result, setResult] = useState<CreditSimResult | null>(null);
    const [open, setOpen] = useState(false);
    const [pending, startTransition] = useTransition();
    const [overrideMsg, setOverrideMsg] = useState<string | null>(null);

    function runSim() {
        startTransition(async () => {
            const r = await simulateCreditCheck(orderId);
            setResult(r);
            setOpen(true);
        });
    }

    function handleRequestOverride() {
        startTransition(async () => {
            const r = await requestCreditOverride(orderId);
            if (r.ok) {
                setOverrideMsg('✅ 양희철 대표에게 한도초과 승인 요청이 전송됐습니다.');
                // 시뮬레이션 재로드
                const fresh = await simulateCreditCheck(orderId);
                setResult(fresh);
            } else {
                setOverrideMsg('❌ ' + r.error);
            }
        });
    }

    const sim = result?.ok ? result : null;

    return (
        <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            {/* Header */}
            <button
                onClick={() => {
                    if (!result) { runSim(); return; }
                    setOpen((v) => !v);
                }}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors"
            >
                <div className="flex items-center gap-2">
                    {sim ? (
                        sim.isOver ? (
                            <ShieldAlert size={20} className="text-red-500" />
                        ) : (
                            <ShieldCheck size={20} className="text-emerald-500" />
                        )
                    ) : (
                        <ShieldAlert size={20} className="text-slate-400" />
                    )}
                    <span className="font-semibold text-slate-800">
                        여신 시뮬레이션
                    </span>
                    {sim && (
                        <span
                            className={`text-xs px-2 py-0.5 rounded-full font-medium ${sim.isOver
                                    ? 'bg-red-100 text-red-700'
                                    : 'bg-emerald-100 text-emerald-700'
                                }`}
                        >
                            {sim.isOver ? '한도 초과' : '한도 이내'}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {pending && <Loader2 size={16} className="animate-spin text-slate-400" />}
                    {!result ? (
                        <span className="text-xs text-blue-600 font-medium">클릭하여 시뮬레이션 실행</span>
                    ) : open ? (
                        <ChevronUp size={18} className="text-slate-400" />
                    ) : (
                        <ChevronDown size={18} className="text-slate-400" />
                    )}
                </div>
            </button>

            {/* Error */}
            {result && !result.ok && (
                <div className="px-5 pb-4 text-sm text-red-600">{result.error}</div>
            )}

            {/* Simulation Detail */}
            {sim && open && (
                <div className="px-5 pb-5 space-y-4 border-t border-slate-100 pt-4">
                    {/* 요약 카드 */}
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <StatCard label="여신 한도" value={sim.creditLimit > 0 ? fmt(sim.creditLimit) : '미설정'} />
                        <StatCard label="현재 미수금" value={fmt(sim.currentReceivable)} />
                        <StatCard label="이번 오더 예상" value={sim.estimatedOrderAmount > 0 ? fmt(sim.estimatedOrderAmount) : '단가 미설정'} sub={sim.items.some(i => !i.hasPriceData) ? '⚠ 일부 단가 없음' : undefined} />
                        <StatCard
                            label="예상 합계"
                            value={fmt(sim.projectedTotal)}
                            highlight={sim.isOver ? 'red' : sim.projectedTotal / (sim.creditLimit || 1) >= 0.8 ? 'amber' : 'green'}
                        />
                    </div>

                    {/* 진행 바 */}
                    {sim.creditLimit > 0 && (
                        <div>
                            <div className="flex justify-between text-xs text-slate-500 mb-1">
                                <span>0</span>
                                <span>한도: {fmt(sim.creditLimit)}</span>
                            </div>
                            <Bar value={sim.projectedTotal} limit={sim.creditLimit} />
                            <p className="text-xs text-slate-500 mt-1 text-right">
                                {sim.creditLimit > 0
                                    ? `한도 대비 ${Math.round((sim.projectedTotal / sim.creditLimit) * 100)}% 사용`
                                    : ''}
                            </p>
                        </div>
                    )}

                    {/* 초과 경고 */}
                    {sim.isOver && (
                        <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-3">
                            <AlertTriangle size={18} className="text-red-500 mt-0.5 flex-shrink-0" />
                            <div className="text-sm">
                                <p className="font-semibold text-red-700">
                                    여신 한도 {fmt(sim.overAmount)} 초과
                                </p>
                                <p className="text-red-600 mt-0.5">
                                    오더 수락 시 미수금이 한도를 넘습니다. 양희철 대표의 승인이 필요합니다.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Override 상태 */}
                    {sim.existingOverride && (
                        <div
                            className={`rounded-xl border p-3 text-sm ${sim.existingOverride.status === 'APPROVED'
                                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                    : sim.existingOverride.status === 'REJECTED'
                                        ? 'bg-red-50 border-red-200 text-red-700'
                                        : 'bg-amber-50 border-amber-200 text-amber-700'
                                }`}
                        >
                            {sim.existingOverride.status === 'APPROVED' && '✅ 양희철 대표가 한도초과를 승인했습니다. 오더 수락 가능합니다.'}
                            {sim.existingOverride.status === 'REJECTED' && '❌ 승인이 거절됐습니다. 재요청하거나 수량을 조정해주세요.'}
                            {sim.existingOverride.status === 'PENDING' && '⏳ 양희철 대표의 승인을 기다리는 중입니다.'}
                        </div>
                    )}

                    {/* Override 없고 초과면 요청 버튼 */}
                    {sim.isOver && (!sim.existingOverride || sim.existingOverride.status === 'REJECTED') && (
                        <button
                            onClick={handleRequestOverride}
                            disabled={pending}
                            className="w-full py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
                        >
                            {pending ? <Loader2 size={16} className="animate-spin" /> : <ShieldAlert size={16} />}
                            양희철 대표에게 한도초과 승인 요청
                        </button>
                    )}

                    {overrideMsg && (
                        <p className="text-sm text-center text-slate-600">{overrideMsg}</p>
                    )}

                    {/* 제품별 단가 상세 */}
                    <details className="text-sm">
                        <summary className="cursor-pointer text-slate-500 hover:text-slate-700 select-none">
                            제품별 단가 상세 보기
                        </summary>
                        <div className="mt-2 border border-slate-100 rounded-xl overflow-hidden">
                            <table className="w-full text-xs">
                                <thead className="bg-slate-50 text-slate-600">
                                    <tr>
                                        <th className="text-left px-3 py-2">제품명</th>
                                        <th className="text-right px-3 py-2">수량(TON)</th>
                                        <th className="text-right px-3 py-2">단가(/TON)</th>
                                        <th className="text-right px-3 py-2">소계</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sim.items.map((it) => (
                                        <tr key={it.productId} className="border-t border-slate-100">
                                            <td className="px-3 py-2 text-slate-700">{it.productName}</td>
                                            <td className="px-3 py-2 text-right">{it.quantity.toFixed(3)}</td>
                                            <td className={`px-3 py-2 text-right ${!it.hasPriceData ? 'text-amber-600' : ''}`}>
                                                {it.hasPriceData ? it.unitPrice.toLocaleString('ko-KR') : '미설정'}
                                            </td>
                                            <td className="px-3 py-2 text-right font-medium">
                                                {it.hasPriceData ? it.lineTotal.toLocaleString('ko-KR') : '-'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </details>

                    {/* 재실행 */}
                    <button
                        onClick={runSim}
                        disabled={pending}
                        className="text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2 w-full text-center"
                    >
                        {pending ? '계산 중...' : '↻ 다시 계산'}
                    </button>
                </div>
            )}
        </section>
    );
}

function StatCard({
    label,
    value,
    sub,
    highlight,
}: {
    label: string;
    value: string;
    sub?: string;
    highlight?: 'red' | 'amber' | 'green';
}) {
    const colors = {
        red: 'bg-red-50 border-red-200 text-red-700',
        amber: 'bg-amber-50 border-amber-200 text-amber-700',
        green: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    };
    return (
        <div
            className={`rounded-xl border p-3 ${highlight ? colors[highlight] : 'bg-slate-50 border-slate-200 text-slate-800'
                }`}
        >
            <p className="text-xs opacity-70 mb-1">{label}</p>
            <p className="font-bold text-sm leading-tight">{value}</p>
            {sub && <p className="text-xs mt-1 opacity-70">{sub}</p>}
        </div>
    );
}
