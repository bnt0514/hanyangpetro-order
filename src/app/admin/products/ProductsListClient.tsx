'use client';

import { useState } from 'react';
import { updateProductAction, deactivateProductAction } from './actions';

type Product = {
    id: string;
    productCode: string | null;
    productName: string;
    manufacturer: string | null;
    grade: string | null;
    packagingType: string | null;
    category: string | null;
    brand: string | null;
    productGroup: string | null;
    hanwhaMaterialName: string | null;
    isActive: boolean;
};

function Field({
    name,
    defaultValue,
    placeholder,
    className = '',
}: {
    name: string;
    defaultValue?: string | null;
    placeholder?: string;
    className?: string;
}) {
    return (
        <input
            name={name}
            defaultValue={defaultValue ?? ''}
            placeholder={placeholder}
            className={`rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-blue-500 ${className}`}
        />
    );
}

export default function ProductsListClient({ products }: { products: Product[] }) {
    const [q, setQ] = useState('');

    const lower = q.toLowerCase().trim();
    const filtered = lower
        ? products.filter(
            (p) =>
                p.productName.toLowerCase().includes(lower) ||
                (p.productCode ?? '').toLowerCase().includes(lower) ||
                (p.manufacturer ?? '').toLowerCase().includes(lower) ||
                (p.hanwhaMaterialName ?? '').toLowerCase().includes(lower),
        )
        : products;

    return (
        <>
            <div className="flex items-center gap-2">
                <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="품목명/코드/제조사/한화자재명 검색"
                    className="w-96 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
                <span className="text-xs text-slate-400">
                    {filtered.length}/{products.length}개
                </span>
            </div>

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="overflow-x-auto">
                    <table className="min-w-[1200px] w-full text-sm">
                        <thead className="bg-slate-50 text-left text-xs font-medium uppercase text-slate-500">
                            <tr>
                                <th className="px-3 py-3">상태</th>
                                <th className="px-3 py-3">코드</th>
                                <th className="px-3 py-3">품목명</th>
                                <th className="px-3 py-3">제조사</th>
                                <th className="px-3 py-3">Grade</th>
                                <th className="px-3 py-3">포장</th>
                                <th className="px-3 py-3">카테고리</th>
                                <th className="px-3 py-3">브랜드</th>
                                <th className="px-3 py-3">품목군</th>
                                <th className="px-3 py-3">한화 자재명</th>
                                <th className="px-3 py-3 text-right">관리</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filtered.map((product) => (
                                <tr key={product.id} className="align-top hover:bg-blue-50/30">
                                    <form action={updateProductAction} className="contents">
                                        <input type="hidden" name="id" value={product.id} />
                                        <td className="px-3 py-2">
                                            <label className="inline-flex items-center gap-1 text-xs text-slate-600">
                                                <input
                                                    type="checkbox"
                                                    name="isActive"
                                                    defaultChecked={product.isActive}
                                                />
                                                사용
                                            </label>
                                        </td>
                                        <td className="px-3 py-2">
                                            <Field name="productCode" defaultValue={product.productCode} className="w-28 font-mono" />
                                        </td>
                                        <td className="px-3 py-2">
                                            <Field name="productName" defaultValue={product.productName} className="w-56" />
                                        </td>
                                        <td className="px-3 py-2">
                                            <Field name="manufacturer" defaultValue={product.manufacturer} className="w-28" />
                                        </td>
                                        <td className="px-3 py-2">
                                            <Field name="grade" defaultValue={product.grade} className="w-24" />
                                        </td>
                                        <td className="px-3 py-2">
                                            <Field name="packagingType" defaultValue={product.packagingType} className="w-24" />
                                        </td>
                                        <td className="px-3 py-2">
                                            <Field name="category" defaultValue={product.category} className="w-24" />
                                        </td>
                                        <td className="px-3 py-2">
                                            <Field name="brand" defaultValue={product.brand} className="w-24" />
                                        </td>
                                        <td className="px-3 py-2">
                                            <Field name="productGroup" defaultValue={product.productGroup} className="w-24" />
                                        </td>
                                        <td className="px-3 py-2">
                                            <Field name="hanwhaMaterialName" defaultValue={product.hanwhaMaterialName} className="w-48" />
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            <div className="flex justify-end gap-1">
                                                <button className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50">
                                                    저장
                                                </button>
                                                <button
                                                    formAction={deactivateProductAction}
                                                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                                                >
                                                    삭제
                                                </button>
                                            </div>
                                        </td>
                                    </form>
                                </tr>
                            ))}
                            {filtered.length === 0 && (
                                <tr>
                                    <td colSpan={11} className="px-5 py-12 text-center text-slate-400">
                                        {q ? '검색 결과가 없습니다.' : '품목이 없습니다.'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </section>
        </>
    );
}
