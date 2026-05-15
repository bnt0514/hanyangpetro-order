'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { deleteHanwhaDispatchMatch } from '@/app/dispatch/actions';

export default function DeleteHanwhaDispatchMatchButton({ matchId }: { matchId: string }) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);

    function remove() {
        setError(null);
        if (!window.confirm('이 배차 매칭을 삭제할까요? 오매칭 정정 후 새로 매칭할 수 있습니다.')) return;
        startTransition(async () => {
            const result = await deleteHanwhaDispatchMatch(matchId);
            if (!result.ok) {
                setError(result.error);
                return;
            }
            router.refresh();
        });
    }

    return (
        <div className="flex flex-col items-end gap-1">
            <button
                type="button"
                onClick={remove}
                disabled={pending}
                className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
                <Trash2 size={12} />
                {pending ? '삭제 중' : '삭제'}
            </button>
            {error && <span className="text-[11px] text-red-600">{error}</span>}
        </div>
    );
}