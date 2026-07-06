'use client';

import { useRef, useState, useTransition } from 'react';
import { Info, Loader2, Save } from 'lucide-react';
import { saveAndApplyPriceAdjustments } from './actions';
import { BRANDS, PRODUCT_GROUPS, type Brand, type ProductGroup } from '@/lib/price-constants';
import { useF8SaveShortcut } from '@/hooks/useF8SaveShortcut';

type AdjMap = Record<string, Record<string, number>>;

export default function PriceAdjustmentClient({
    month,
    initial,
}: {
    month: string;
    initial: { brand: string; productGroup: string; delta: number }[];
}) {
    const sectionRef = useRef<HTMLDivElement | null>(null);
    const [memo, setMemo] = useState('');
    const [pending, startTransition] = useTransition();
    const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

    const initMap: AdjMap = {};
    for (const brand of BRANDS) {
        initMap[brand] = {};
        for (const group of PRODUCT_GROUPS) initMap[brand][group] = 0;
    }
    for (const row of initial) {
        const group = row.productGroup === '기타' ? 'PP' : row.productGroup;
        if (initMap[row.brand]?.[group] != null) initMap[row.brand][group] += row.delta;
    }

    const [values, setValues] = useState<AdjMap>(initMap);

    function setValue(brand: Brand, group: ProductGroup, value: string) {
        const parsed = value === '' || value === '-' ? 0 : Number(value.replace(/,/g, ''));
        setValues((prev) => ({
            ...prev,
            [brand]: { ...prev[brand], [group]: Number.isFinite(parsed) ? parsed : prev[brand][group] },
        }));
    }

    function save() {
        setMsg(null);
        startTransition(async () => {
            const result = await saveAndApplyPriceAdjustments({ month, values, memo });
            setMsg(result.ok
                ? { ok: true, text: result.count > 0 ? `${result.count}개 원장 행에 단가조정을 반영했습니다.` : '저장했습니다. 변경된 조정값은 없습니다.' }
                : { ok: false, text: result.error });
        });
    }

    useF8SaveShortcut(save, { disabled: pending, scopeRef: sectionRef });

    return (
        <div ref={sectionRef} className="space-y-4">
            <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
                <Info size={16} className="mt-0.5 flex-shrink-0" />
                <p>
                    기준월의 실제 매출 원장 단가에 반영됩니다. 저장된 값과 새 값의 차이만 적용하므로, 같은 값을 다시 저장해도 중복 인상/인하되지 않습니다.
                </p>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                            <th className="w-28 px-4 py-3 text-left font-semibold text-slate-700">브랜드</th>
                            {PRODUCT_GROUPS.map((group) => (
                                <th key={group} className="px-3 py-3 text-center font-semibold text-slate-700">{group}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {BRANDS.map((brand) => (
                            <tr key={brand} className="hover:bg-slate-50">
                                <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-700">{brand}</td>
                                {PRODUCT_GROUPS.map((group) => {
                                    const value = values[brand]?.[group] ?? 0;
                                    return (
                                        <td key={group} className="px-2 py-2 text-center">
                                            <input
                                                type="number"
                                                step="1000"
                                                value={value === 0 ? '' : value}
                                                placeholder="0"
                                                onChange={(event) => setValue(brand as Brand, group as ProductGroup, event.target.value)}
                                                className={`w-24 rounded-lg border px-2 py-1.5 text-right text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 ${value > 0 ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : value < 0 ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-500'}`}
                                            />
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="flex items-center gap-3">
                <input value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="메모" className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                <button onClick={save} disabled={pending} title="F8로도 저장할 수 있습니다" className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                    {pending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    저장/반영
                </button>
            </div>

            {msg && <p className={`text-center text-sm font-medium ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</p>}
        </div>
    );
}
