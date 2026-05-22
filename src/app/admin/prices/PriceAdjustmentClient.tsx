'use client';

import { useRef, useState, useTransition } from 'react';
import { Save, Loader2, Info } from 'lucide-react';
import {
    upsertPriceAdjustment,
} from '@/app/admin/credit/actions';
import { BRANDS, PRODUCT_GROUPS, type Brand, type ProductGroup } from '@/lib/price-constants';
import { useF8SaveShortcut } from '@/hooks/useF8SaveShortcut';

type AdjMap = Record<string, Record<string, number>>; // brand → productGroup → delta

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

    // map for editing
    const initMap: AdjMap = {};
    for (const b of BRANDS) {
        initMap[b] = {};
        for (const g of PRODUCT_GROUPS) initMap[b][g] = 0;
    }
    for (const row of initial) {
        if (initMap[row.brand]) initMap[row.brand][row.productGroup] = row.delta;
    }
    const [values, setValues] = useState<AdjMap>(initMap);

    function set(brand: Brand, group: ProductGroup, v: string) {
        const n = v === '' || v === '-' ? 0 : Number(v.replace(/,/g, ''));
        setValues((prev) => ({
            ...prev,
            [brand]: { ...prev[brand], [group]: isNaN(n) ? prev[brand][group] : n },
        }));
    }

    function save() {
        setMsg(null);
        startTransition(async () => {
            let ok = true;
            for (const brand of BRANDS) {
                for (const group of PRODUCT_GROUPS) {
                    const delta = values[brand][group];
                    const r = await upsertPriceAdjustment(month, brand, group, delta, memo);
                    if (!r.ok) { ok = false; }
                }
            }
            setMsg({ ok, text: ok ? '✅ 저장 완료' : '❌ 일부 저장 실패' });
        });
    }

    useF8SaveShortcut(save, { disabled: pending, scopeRef: sectionRef });

    return (
        <div ref={sectionRef} className="space-y-4">
            <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-700">
                <Info size={16} className="mt-0.5 flex-shrink-0" />
                <p>
                    각 셀에 <strong>인상 시 양수(+)</strong>, <strong>인하 시 음수(-)</strong> 금액을 원/TON 단위로 입력하세요.
                    기준가에 누적 합산되어 실효 단가가 계산됩니다.
                </p>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                            <th className="text-left px-4 py-3 font-semibold text-slate-700 w-28">브랜드</th>
                            {PRODUCT_GROUPS.map((g) => (
                                <th key={g} className="text-center px-3 py-3 font-semibold text-slate-700">
                                    {g}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {BRANDS.map((brand) => (
                            <tr key={brand} className="hover:bg-slate-50">
                                <td className="px-4 py-3 font-medium text-slate-700 whitespace-nowrap">
                                    {brand}
                                </td>
                                {PRODUCT_GROUPS.map((group) => {
                                    const val = values[brand]?.[group] ?? 0;
                                    return (
                                        <td key={group} className="px-2 py-2 text-center">
                                            <input
                                                type="number"
                                                step="1000"
                                                value={val === 0 ? '' : val}
                                                placeholder="0"
                                                onChange={(e) => set(brand as Brand, group as ProductGroup, e.target.value)}
                                                className={`w-24 text-right px-2 py-1.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 ${val > 0
                                                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                                    : val < 0
                                                        ? 'border-red-300 bg-red-50 text-red-700'
                                                        : 'border-slate-200 bg-white text-slate-500'
                                                    }`}
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
                <input
                    type="text"
                    placeholder="메모 (예: 한화 LDPE 공급가 인상)"
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
                <button
                    onClick={save}
                    disabled={pending}
                    title="F8로도 저장할 수 있습니다"
                    className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl disabled:opacity-60"
                >
                    {pending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    저장 (F8)
                </button>
            </div>

            {msg && (
                <p className={`text-sm text-center font-medium ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>
                    {msg.text}
                </p>
            )}
        </div>
    );
}
