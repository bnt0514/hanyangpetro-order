'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { confirmOrderReceipt } from '@/app/dispatch/actions';

export default function ReceiptCompleteButton({ orderId }: { orderId: string }) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();

    function handleClick() {
        const ok = window.confirm('이 주문을 출고완료 처리하시겠습니까?');
        if (!ok) return;
        startTransition(async () => {
            const result = await confirmOrderReceipt(orderId, '출고완료 처리');
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
            onClick={handleClick}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
        >
            {pending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            출고완료
        </button>
    );
}
