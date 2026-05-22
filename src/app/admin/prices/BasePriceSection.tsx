'use client';

import { useRef, useState, useTransition } from 'react';
import { Save, Loader2 } from 'lucide-react';
import { upsertProductBasePrice } from '@/app/admin/credit/actions';
import { useF8SaveShortcut } from '@/hooks/useF8SaveShortcut';

type Product = {
    id: string;
    productCode: string;
    productName: string;
    manufacturer: string | null;
    category: string | null;
    productPrice: { basePrice: number } | null;
};

export default function BasePriceSection({ products }: { products: Product[] }) {
    const sectionRef = useRef<HTMLDivElement | null>(null);
    const activeProductIdRef = useRef<string | null>(null);
    const [search, setSearch] = useState('');
    const [editing, setEditing] = useState<Record<string, string>>({});
    const [pending, startTransition] = useTransition();
    const [saved, setSaved] = useState<Record<string, boolean>>({});

    const filtered = products.filter(
        (p) =>
            p.productName.includes(search) ||
            p.productCode.includes(search) ||
            (p.manufacturer ?? '').includes(search) ||
            (p.category ?? '').includes(search),
    );

    function saveOne(productId: string) {
        const val = Number(editing[productId]);
        if (isNaN(val) || val < 0) return;
        startTransition(async () => {
            const r = await upsertProductBasePrice(productId, val);
            if (r.ok) setSaved((s) => ({ ...s, [productId]: true }));
        });
    }

    useF8SaveShortcut(() => {
        const productId = activeProductIdRef.current;
        if (productId) saveOne(productId);
    }, { disabled: pending, scopeRef: sectionRef });

    return (
        <div ref={sectionRef} className="space-y-3">
            <input
                type="text"
                placeholder="제품명 / 코드 / 브랜드 / 제품군 검색"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                        <tr className="text-xs font-semibold text-slate-500 uppercase">
                            <th className="text-left px-4 py-3">제품명</th>
                            <th className="text-left px-3 py-3">코드</th>
                            <th className="text-left px-3 py-3">브랜드</th>
                            <th className="text-left px-3 py-3">제품군</th>
                            <th className="text-right px-3 py-3">기준가(원/TON)</th>
                            <th className="px-3 py-3"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {filtered.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                                    검색 결과 없음
                                </td>
                            </tr>
                        )}
                        {filtered.map((p) => {
                            const base = p.productPrice?.basePrice ?? 0;
                            const val = editing[p.id] ?? String(base || '');
                            return (
                                <tr key={p.id} className="hover:bg-slate-50">
                                    <td className="px-4 py-2 font-medium text-slate-800">{p.productName}</td>
                                    <td className="px-3 py-2 font-mono text-xs text-slate-400">{p.productCode}</td>
                                    <td className="px-3 py-2 text-slate-600">{p.manufacturer ?? '-'}</td>
                                    <td className="px-3 py-2 text-slate-600">{p.category ?? '-'}</td>
                                    <td className="px-3 py-2 text-right">
                                        <input
                                            type="number"
                                            min="0"
                                            step="1000"
                                            value={val}
                                            placeholder="미설정"
                                            onChange={(e) => {
                                                setEditing((s) => ({ ...s, [p.id]: e.target.value }));
                                                setSaved((s) => ({ ...s, [p.id]: false }));
                                            }}
                                            onFocus={() => { activeProductIdRef.current = p.id; }}
                                            className="w-32 text-right px-2 py-1 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                                        />
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        {saved[p.id] ? (
                                            <span className="text-xs text-emerald-600 font-medium">저장됨</span>
                                        ) : (
                                            <button
                                                onClick={() => saveOne(p.id)}
                                                disabled={pending || !editing[p.id]}
                                                title="해당 기준가 입력칸에서 F8로도 저장할 수 있습니다"
                                                className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg disabled:opacity-40 flex items-center gap-1"
                                            >
                                                {pending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                                                저장 (F8)
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {filtered.length > 0 && (
                <p className="text-xs text-slate-400 text-right">
                    {filtered.length}개 제품 표시 / 전체 {products.length}개
                </p>
            )}
        </div>
    );
}
