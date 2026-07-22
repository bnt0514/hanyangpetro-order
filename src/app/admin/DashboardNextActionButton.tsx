'use client';

import type { MouseEvent } from 'react';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, Truck } from 'lucide-react';
import { changeOrderStatus } from '@/app/orders/actions';

type NextAction = {
    nextStatus: string;
    label: string;
    confirmMessage: string;
    tone: 'emerald' | 'sky' | 'orange';
};

function nextActionForStatus(status: string): NextAction | null {
    if (status === 'REQUESTED') {
        return {
            nextStatus: 'APPROVED',
            label: '오더 승인',
            confirmMessage: '이 주문을 승인 처리할까요?',
            tone: 'emerald',
        };
    }
    if (status === 'CREDIT_OVER_LIMIT') {
        return {
            nextStatus: 'APPROVED',
            label: '오더 승인',
            confirmMessage: '여신 승인 상태를 확인한 뒤 이 주문을 승인 처리할까요?',
            tone: 'emerald',
        };
    }
    if (status === 'APPROVED') {
        return {
            nextStatus: 'DISPATCHING',
            label: '배차로 보내기',
            confirmMessage: '이 주문을 배차중으로 변경할까요?',
            tone: 'sky',
        };
    }
    if (status === 'DISPATCH_COMPLETED') {
        return {
            nextStatus: 'SHIPPED',
            label: '출고완료',
            confirmMessage: '이 주문을 출고완료 처리할까요?',
            tone: 'orange',
        };
    }
    return null;
}

const toneClass: Record<NextAction['tone'], string> = {
    emerald: 'bg-emerald-600 hover:bg-emerald-700',
    sky: 'bg-sky-600 hover:bg-sky-700',
    orange: 'bg-orange-600 hover:bg-orange-700',
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
            const result = await changeOrderStatus(orderId, action!.nextStatus, `[대시보드 빠른처리] ${action!.label}`);

            if (!result.ok) {
                window.alert(result.error);
                return;
            }

            window.dispatchEvent(new CustomEvent('dashboard-order-status-changed', {
                detail: { orderId, status: action!.nextStatus },
            }));
            router.refresh();
        });
    }

    const Icon = action.nextStatus === 'DISPATCHING' ? Truck : CheckCircle2;

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
