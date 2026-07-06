'use client';

import { useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { deleteManualLedgerEntry } from '@/app/admin/ledger/manual-entry/actions';
import { useRouter } from 'next/navigation';

export default function ManualEntryDeleteButton({ ledgerEntryId }: { ledgerEntryId: string }) {
    const [pending, startTransition] = useTransition();
    const router = useRouter();

    function handleClick() {
        if (!confirm('이 수동 입력 항목을 삭제하시겠습니까?')) return;
        startTransition(async () => {
            const result = await deleteManualLedgerEntry(ledgerEntryId);
            if (!result.ok) {
                alert(result.error);
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
            title="수동입력 삭제"
            className="ml-1.5 inline-flex items-center gap-1 rounded-lg bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-600 hover:bg-red-100 disabled:opacity-50 transition"
        >
            <Trash2 size={10} />
            {pending ? '...' : '삭제'}
        </button>
    );
}
