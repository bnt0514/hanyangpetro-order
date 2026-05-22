'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Save } from 'lucide-react';
import { bulkUpdateCreditLimits } from './actions';

export default function BulkSaveButton() {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [msg, setMsg] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);

    function collectAndSave() {
        setMsg(null);
        setErr(null);

        const forms = Array.from(
            document.querySelectorAll<HTMLFormElement>('form[id^="credit-"]'),
        );

        const updates = forms
            .map((form) => {
                const customerId =
                    form.querySelector<HTMLInputElement>('[name="customerId"]')?.value ?? '';
                const creditLimit =
                    form.querySelector<HTMLInputElement>('[name="creditLimit"]')?.value ?? '0';
                const creditInsuranceAmount =
                    form.querySelector<HTMLInputElement>('[name="creditInsuranceAmount"]')?.value ?? '0';
                const mortgageAmount =
                    form.querySelector<HTMLInputElement>('[name="mortgageAmount"]')?.value ?? '0';
                const creditGrade =
                    document.querySelector<HTMLSelectElement>(
                        `[form="${form.id}"][name="creditGrade"]`,
                    )?.value ?? 'B';
                return { customerId, creditLimit, creditGrade, creditInsuranceAmount, mortgageAmount };
            })
            .filter((u) => u.customerId);

        if (!updates.length) {
            setErr('저장할 데이터가 없습니다.');
            return;
        }

        startTransition(async () => {
            const result = await bulkUpdateCreditLimits(updates);
            if (!result.ok) {
                setErr(result.error);
                return;
            }
            setMsg(`${result.count}개 거래처 저장 완료`);
            router.refresh();
        });
    }

    return (
        <div className="flex items-center gap-2">
            <button
                type="button"
                onClick={collectAndSave}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
                {pending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                일괄저장
            </button>
            {msg && <span className="text-xs font-medium text-emerald-600">{msg}</span>}
            {err && <span className="text-xs font-medium text-red-600">{err}</span>}
        </div>
    );
}
