'use client';

import { useTransition, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { approveCreditOverride, rejectCreditOverride } from '@/app/admin/credit/actions';

function fmt(n: number) {
    return n.toLocaleString('ko-KR') + '원';
}

export default function OverrideActions({ overrideId }: { overrideId: string }) {
    const [pending, startTransition] = useTransition();
    const [done, setDone] = useState<string | null>(null);

    function approve() {
        startTransition(async () => {
            const r = await approveCreditOverride(overrideId);
            setDone(r.ok ? '✅ 승인 완료' : '❌ ' + (!r.ok ? r.error : ''));
        });
    }

    function reject() {
        const reason = window.prompt('거절 사유를 입력하세요');
        if (reason === null) return;
        startTransition(async () => {
            const r = await rejectCreditOverride(overrideId, reason);
            setDone(r.ok ? '🚫 거절 처리됨' : '❌ ' + (!r.ok ? r.error : ''));
        });
    }

    if (done) return <span className="text-sm font-medium">{done}</span>;

    return (
        <div className="flex gap-2">
            <button
                onClick={approve}
                disabled={pending}
                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded-xl font-semibold disabled:opacity-60"
            >
                {pending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                승인
            </button>
            <button
                onClick={reject}
                disabled={pending}
                className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-xl font-semibold disabled:opacity-60"
            >
                <XCircle size={14} /> 거절
            </button>
        </div>
    );
}

export function OverrideRow({
    override,
    isExecutive,
}: {
    override: {
        id: string;
        status: string;
        currentReceivable: number;
        creditLimit: number;
        overAmount: number;
        createdAt: Date;
        requestedBy: { name: string } | null;
        order: { id: string; orderNo: string; customer: { companyName: string } };
    };
    isExecutive: boolean;
}) {
    return (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
            <div className="flex items-start justify-between flex-wrap gap-2">
                <div>
                    <p className="font-bold text-slate-800 text-lg">{override.order.customer.companyName}</p>
                    <Link
                        href={`/admin/orders/${override.order.id}`}
                        className="text-xs font-mono font-semibold text-blue-600 underline-offset-2 hover:text-blue-800 hover:underline"
                    >
                        {override.order.orderNo}
                    </Link>
                </div>
                <span
                    className={`text-xs px-2.5 py-1 rounded-full font-semibold ${override.status === 'PENDING'
                            ? 'bg-amber-100 text-amber-700'
                            : override.status === 'APPROVED'
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-red-100 text-red-700'
                        }`}
                >
                    {override.status === 'PENDING' ? '⏳ 승인 대기' : override.status === 'APPROVED' ? '✅ 승인됨' : '❌ 거절됨'}
                </span>
            </div>

            <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="bg-slate-50 rounded-xl p-3">
                    <p className="text-xs text-slate-500">현재 미수금</p>
                    <p className="font-semibold mt-1">{fmt(override.currentReceivable)}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                    <p className="text-xs text-slate-500">여신 한도</p>
                    <p className="font-semibold mt-1">{fmt(override.creditLimit)}</p>
                </div>
                <div className="bg-red-50 rounded-xl p-3">
                    <p className="text-xs text-red-500">초과 금액</p>
                    <p className="font-bold text-red-600 mt-1">+{fmt(override.overAmount)}</p>
                </div>
            </div>

            <div className="flex items-center justify-between text-xs text-slate-500">
                <span>요청자: {override.requestedBy?.name ?? '-'} · {new Date(override.createdAt).toLocaleDateString('ko-KR')}</span>
                {isExecutive && override.status === 'PENDING' && (
                    <OverrideActions overrideId={override.id} />
                )}
            </div>
        </div>
    );
}
