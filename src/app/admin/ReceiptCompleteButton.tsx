'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { confirmOrderReceipt } from '@/app/dispatch/actions';

export default function ReceiptCompleteButton({ orderId }: { orderId: string }) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();

    function completeReceipt() {
        const ok = window.confirm('정말 입고 완료 처리 하시겠습니까?\n\n완료 후에는 버튼이 사라지며 상태가 변경됩니다.');
        if (!ok) return;

        startTransition(async () => {
            const result = await confirmOrderReceipt(orderId, '대시보드에서 입고 완료 처리');
            if (!result.ok) {
                window.alert(result.error);
                return;
            }
            router.refresh();
        });
    }

    return (
        <button
            type="button"
            onClick={completeReceipt}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-full bg-teal-600 px-2.5 py-0.5 text-xs font-bold text-white hover:bg-teal-700 disabled:opacity-60"
        >
            {pending && <Loader2 size={12} className="animate-spin" />}
            입고처리
        </button>
    );
}
