'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export type PerformanceFilterOption = {
    key: string;
    label: string;
};

type Props = {
    label: string;
    paramName: string;
    options: PerformanceFilterOption[];
    selectedKeys: string[];
    tone: 'blue' | 'violet';
};

export default function PerformanceMultiFilter({ label, paramName, options, selectedKeys, tone }: Props) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [input, setInput] = useState('');
    const [error, setError] = useState<string | null>(null);

    const datalistId = `${paramName}-options`;
    const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
    const selectedOptions = options.filter((option) => selectedSet.has(option.key));
    const inputClass = tone === 'blue'
        ? 'border-blue-200 bg-blue-50 placeholder-blue-300 text-blue-800 focus:ring-blue-400'
        : 'border-violet-200 bg-violet-50 placeholder-violet-300 text-violet-800 focus:ring-violet-400';
    const buttonClass = tone === 'blue'
        ? 'bg-blue-600 hover:bg-blue-700'
        : 'bg-violet-600 hover:bg-violet-700';

    function pushSelected(nextKeys: string[]) {
        const params = new URLSearchParams(searchParams.toString());
        const uniqueKeys = Array.from(new Set(nextKeys)).filter(Boolean);
        if (uniqueKeys.length === 0) params.delete(paramName);
        else params.set(paramName, uniqueKeys.join(','));
        router.push(`${pathname}?${params.toString()}`);
    }

    function addOption(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const value = input.trim();
        if (!value) return;

        const exact = options.find((option) => option.label === value);
        if (!exact) {
            setError(`${label} 목록에서 정확히 선택해주세요.`);
            return;
        }

        setInput('');
        setError(null);
        pushSelected([...selectedKeys, exact.key]);
    }

    function removeOption(key: string) {
        setError(null);
        pushSelected(selectedKeys.filter((selectedKey) => selectedKey !== key));
    }

    function resetAll() {
        setInput('');
        setError(null);
        pushSelected([]);
    }

    return (
        <div className="flex min-w-[260px] max-w-[520px] flex-col gap-1.5">
            <form onSubmit={addOption} className="flex items-center gap-1.5">
                <span className="shrink-0 text-xs font-semibold text-slate-500">{label}</span>
                <input
                    value={input}
                    onChange={(event) => {
                        setInput(event.target.value);
                        setError(null);
                    }}
                    list={datalistId}
                    placeholder={`전체 ${label}`}
                    className={`w-40 rounded-xl border px-3 py-1.5 text-sm outline-none focus:ring-1 ${inputClass}`}
                />
                <datalist id={datalistId}>
                    {options.map((option) => (
                        <option key={option.key} value={option.label} />
                    ))}
                </datalist>
                <button type="submit" className={`rounded-xl px-3 py-1.5 text-sm font-semibold text-white ${buttonClass}`}>
                    추가
                </button>
                {selectedKeys.length > 0 && (
                    <button type="button" onClick={resetAll} className="rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50">
                        전체
                    </button>
                )}
            </form>
            {(selectedOptions.length > 0 || error) && (
                <div className="flex flex-wrap items-center gap-1.5 pl-12">
                    {selectedOptions.map((option) => (
                        <button
                            key={option.key}
                            type="button"
                            onClick={() => removeOption(option.key)}
                            className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
                            title="클릭하면 제거됩니다"
                        >
                            {option.label} ×
                        </button>
                    ))}
                    {error && <span className="text-xs text-red-500">{error}</span>}
                </div>
            )}
        </div>
    );
}
