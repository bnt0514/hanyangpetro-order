'use client';

import type { MouseEvent } from 'react';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, Truck } from 'lucide-react';
import { changeOrderStatus } from '@/app/orders/actions';
import { confirmOrderReceipt } from '@/app/dispatch/actions';

type NextAction =
    | { kind: 'status'; nextStatus: string; label: string; confirmMessage: string; tone: 'emerald' | 'sky' }
    | { kind: 'receipt'; label: string; confirmMessage: string; tone: 'teal' };

function nextActionForStatus(status: string): NextAction | null {
    if (status === 'REQUESTED' || status === 'PENDING_SALES_REVIEW' || status === 'ON_HOLD') {
        return {
            kind: 'status',
            nextStatus: 'APPROVED',
            label: '오더 승인',
            confirmMessage: '이 주문을 승인 처리할까요?',
            tone: 'emerald',
        };
    }
    if (status === 'DISPATCH_WAITING' || status === 'DISPATCHING') {
        return {
            kind: 'status',
            nextStatus: 'DISPATCH_COMPLETED',
            label: '배차 완료',
            confirmMessage: '이 주문을 배차 완료 처리할까요?',
            tone: 'sky',
        };
    }
    if (status === 'DISPATCH_COMPLETED' || status === 'DELIVERY_CONFIRM_PENDING') {
        return {
            kind: 'receipt',
            label: '입고 완료',
            confirmMessage: '정말 입고 완료 처리할까요?\n\n완료 후 상태가 변경됩니다.',
            tone: 'teal',
        };
    }
    return null;
}

const toneClass: Record<NextAction['tone'], string> = {
    emerald: 'bg-emerald-600 hover:bg-emerald-700',
    sky: 'bg-sky-600 hover:bg-sky-700',
    teal: 'bg-teal-600 hover:bg-teal-700',
};

export default function DashboardNextActionButton({ orderId, currentStatus }: { orderId: string; currentStatus: string }) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const action = nextActionForStatus(currentStatus);

    if (!action) return null;

    function runAction(event: MouseEvent<HTMLButtonElement>) {
        event.preventDefault();
        event.stopPropagation();
        if (!window.confirm(action!.confirmMessage)) return;

        startTransition(async () => {
            const result = action!.kind === 'receipt'
                ? await confirmOrderReceipt(orderId, '대시보드에서 입고 완료 처리')
                : await changeOrderStatus(orderId, action!.nextStatus, `[대시보드 빠른처리] ${action!.label}`);

            if (!result.ok) {
                window.alert(result.error);
                return;
            }

            const changedStatus = action!.kind === 'receipt' ? 'COMPLETED' : action!.nextStatus;
            window.dispatchEvent(new CustomEvent('dashboard-order-status-changed', {
                detail: { orderId, status: changedStatus },
            }));
            router.refresh();
        });
    }

    const Icon = action.kind === 'receipt' ? CheckCircle2 : action.nextStatus === 'DISPATCH_COMPLETED' ? Truck : CheckCircle2;

    return (
        <button
            type="button"
            onClick={runAction}
            disabled={pending}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold text-white transition disabled:opacity-60 ${toneClass[action.tone]}`}
        >
            {pending ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
            {action.label}
        </button>
    );
}
