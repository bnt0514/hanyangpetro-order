'use client';

import { useMemo, useState, useTransition } from 'react';
import { Loader2, Save, Search } from 'lucide-react';
import { bulkUpsertCustomerProductPrices } from '@/app/admin/credit/actions';

type Customer = {
    id: string;
    customerCode: string;
    companyName: string;
    defaultSalesRepId: string | null;
    defaultSalesRep: { name: string } | null;
};

type Product = {
    id: string;
    productCode: string;
    productName: string;
    manufacturer: string | null;
    category: string | null;
};

type User = { id: string; name: string };

type CustomerProductPrice = {
    customerId: string;
    productId: string;
    priceType: string;
    unitPrice: number;
    lastUsedAt: Date;
};

type Row = {
    key: string;
    customerId: string;
    customerName: string;
    repName: string;
    productId: string;
    productName: string;
    productCode: string;
    currentPrice: number | null;
    lastUsedAt: Date | null;
};

function normalize(value: string) {
    return value
        .toLowerCase()
        .replace(/주식\s*회사/g, '')
        .replace(/\(주\)|㈜|\s|[()\-_/\\.,·•]+/g, '')
        .trim();
}

function formatPrice(value: number | null) {
    return value == null ? '-' : value.toLocaleString('ko-KR');
}

export default function BulkCustomerPriceSection({
    customers,
    products,
    users,
    prices,
}: {
    customers: Customer[];
    products: Product[];
    users: User[];
    prices: CustomerProductPrice[];
}) {
    const [customerQuery, setCustomerQuery] = useState('');
    const [selectedCustomerId, setSelectedCustomerId] = useState('');
    const [repId, setRepId] = useState('');
    const [productQuery, setProductQuery] = useState('');
    const [priceType, setPriceType] = useState<'SALES' | 'PURCHASE'>('SALES');
    const [bulkPrice, setBulkPrice] = useState('');
    const [selectedKeys, setSelectedKeys] = useState<Record<string, boolean>>({});
    const [rowPrices, setRowPrices] = useState<Record<string, string>>({});
    const [message, setMessage] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    const priceMap = useMemo(() => {
        const map = new Map<string, CustomerProductPrice>();
        for (const price of prices) {
            if (price.priceType !== priceType) continue;
            map.set(`${price.customerId}:${price.productId}`, price);
        }
        return map;
    }, [prices, priceType]);

    const customerMatches = useMemo(() => {
        const q = normalize(customerQuery);
        return customers
            .filter((customer) => {
                if (repId && customer.defaultSalesRepId !== repId) return false;
                if (!q) return true;
                return normalize(customer.companyName).includes(q) || normalize(customer.customerCode).includes(q);
            })
            .slice(0, 30);
    }, [customers, customerQuery, repId]);

    const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId) ?? null;

    const rows = useMemo<Row[]>(() => {
        const productQ = normalize(productQuery);
        const filteredProducts = products
            .filter((product) => {
                if (!productQ) return true;
                return (
                    normalize(product.productName).includes(productQ) ||
                    normalize(product.productCode).includes(productQ) ||
                    normalize(product.manufacturer ?? '').includes(productQ) ||
                    normalize(product.category ?? '').includes(productQ)
                );
            })
            .slice(0, 200);

        const targetCustomers = selectedCustomer
            ? [selectedCustomer]
            : repId
                ? customers.filter((customer) => customer.defaultSalesRepId === repId).slice(0, 20)
                : [];

        if (targetCustomers.length > 0) {
            return targetCustomers.flatMap((customer) => filteredProducts.map((product) => {
                const current = priceMap.get(`${customer.id}:${product.id}`);
                return {
                    key: `${customer.id}:${product.id}`,
                    customerId: customer.id,
                    customerName: customer.companyName,
                    repName: customer.defaultSalesRep?.name ?? '-',
                    productId: product.id,
                    productName: product.productName,
                    productCode: product.productCode,
                    currentPrice: current?.unitPrice ?? null,
                    lastUsedAt: current?.lastUsedAt ?? null,
                };
            })).slice(0, 300);
        }

        const existingRows: Row[] = [];
        for (const price of prices.filter((item) => item.priceType === priceType)) {
            const customer = customers.find((item) => item.id === price.customerId);
            const product = products.find((item) => item.id === price.productId);
            if (!customer || !product) continue;
            if (productQ && !normalize(`${product.productName} ${product.productCode}`).includes(productQ)) continue;
            existingRows.push({
                key: `${customer.id}:${product.id}`,
                customerId: customer.id,
                customerName: customer.companyName,
                repName: customer.defaultSalesRep?.name ?? '-',
                productId: product.id,
                productName: product.productName,
                productCode: product.productCode,
                currentPrice: price.unitPrice,
                lastUsedAt: price.lastUsedAt,
            });
        }

        return existingRows.slice(0, 300);
    }, [customers, priceMap, priceType, prices, productQuery, products, repId, selectedCustomer]);

    const selectedRows = rows.filter((row) => selectedKeys[row.key]);
    const allVisibleSelected = rows.length > 0 && rows.every((row) => selectedKeys[row.key]);

    function toggleAll() {
        setSelectedKeys((prev) => {
            const next = { ...prev };
            for (const row of rows) next[row.key] = !allVisibleSelected;
            return next;
        });
    }

    function saveSelected(useBulkPrice: boolean) {
        setMessage(null);
        const updates = selectedRows.map((row) => {
            const value = useBulkPrice ? bulkPrice : rowPrices[row.key];
            const unitPrice = Number(String(value ?? '').replace(/,/g, ''));
            return { customerId: row.customerId, productId: row.productId, unitPrice };
        }).filter((item) => Number.isFinite(item.unitPrice) && item.unitPrice >= 0);

        if (updates.length === 0) {
            setMessage('선택된 행과 입력된 단가를 확인해 주세요.');
            return;
        }

        startTransition(async () => {
            const result = await bulkUpsertCustomerProductPrices({ priceType, updates });
            if (!result.ok) {
                setMessage(result.error);
                return;
            }
            setMessage(`${result.count}건 저장 완료`);
        });
    }

    return (
        <section className="space-y-4">
            <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
                특정 거래처를 선택한 뒤 품목명/코드로 필터링하고, 조회된 품목들을 체크해서 한 번에 단가를 수정합니다.
            </div>

            <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-5">
                <label className="space-y-1 text-sm">
                    <span className="font-medium text-slate-700">단가구분</span>
                    <select value={priceType} onChange={(event) => setPriceType(event.target.value as 'SALES' | 'PURCHASE')} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
                        <option value="SALES">매출단가</option>
                        <option value="PURCHASE">매입단가</option>
                    </select>
                </label>
                <label className="space-y-1 text-sm">
                    <span className="font-medium text-slate-700">담당자</span>
                    <select value={repId} onChange={(event) => { setRepId(event.target.value); setSelectedCustomerId(''); }} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
                        <option value="">전체 담당자</option>
                        {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                    </select>
                </label>
                <label className="space-y-1 text-sm md:col-span-2">
                    <span className="font-medium text-slate-700">거래처 검색</span>
                    <div className="relative">
                        <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
                        <input value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} placeholder="거래처명/코드" className="w-full rounded-xl border border-slate-300 py-2 pl-9 pr-3 text-sm" />
                    </div>
                </label>
                <label className="space-y-1 text-sm">
                    <span className="font-medium text-slate-700">품목 필터</span>
                    <input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="품목명/코드" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                </label>
            </div>

            {customerQuery && (
                <div className="flex flex-wrap gap-2">
                    {customerMatches.map((customer) => (
                        <button
                            key={customer.id}
                            type="button"
                            onClick={() => setSelectedCustomerId(customer.id)}
                            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${selectedCustomerId === customer.id ? 'border-blue-500 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                        >
                            {customer.companyName} <span className="opacity-70">{customer.defaultSalesRep?.name ?? '-'}</span>
                        </button>
                    ))}
                </div>
            )}

            <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200 bg-white p-4">
                <label className="space-y-1 text-sm">
                    <span className="font-medium text-slate-700">선택 행 일괄 단가</span>
                    <input value={bulkPrice} onChange={(event) => setBulkPrice(event.target.value)} placeholder="예: 1450000" inputMode="numeric" className="w-44 rounded-xl border border-slate-300 px-3 py-2 text-right text-sm" />
                </label>
                <button type="button" onClick={() => saveSelected(true)} disabled={pending || selectedRows.length === 0} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
                    {pending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    선택 {selectedRows.length}건 일괄저장
                </button>
                <button type="button" onClick={() => saveSelected(false)} disabled={pending || selectedRows.length === 0} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    행별 입력값 저장
                </button>
                {message && <p className="text-sm font-medium text-blue-700">{message}</p>}
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
                        <tr>
                            <th className="px-4 py-3 text-left"><button type="button" onClick={toggleAll} className="rounded border border-slate-300 bg-white px-2 py-1">{allVisibleSelected ? '전체해제' : '전체선택'}</button></th>
                            <th className="px-4 py-3 text-left">거래처</th>
                            <th className="px-4 py-3 text-left">담당자</th>
                            <th className="px-4 py-3 text-left">품목</th>
                            <th className="px-4 py-3 text-right">현재단가</th>
                            <th className="px-4 py-3 text-right">행별 수정단가</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {rows.length === 0 ? (
                            <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">거래처 또는 담당자를 선택하고 품목을 조회해 주세요.</td></tr>
                        ) : rows.map((row) => (
                            <tr key={row.key} className="hover:bg-slate-50">
                                <td className="px-4 py-3"><input type="checkbox" checked={Boolean(selectedKeys[row.key])} onChange={(event) => setSelectedKeys((prev) => ({ ...prev, [row.key]: event.target.checked }))} /></td>
                                <td className="px-4 py-3 font-medium text-slate-800">{row.customerName}</td>
                                <td className="px-4 py-3 text-slate-500">{row.repName}</td>
                                <td className="px-4 py-3"><span className="font-medium text-slate-800">{row.productName}</span><span className="ml-2 font-mono text-xs text-slate-400">{row.productCode}</span></td>
                                <td className="px-4 py-3 text-right text-slate-700">{formatPrice(row.currentPrice)}</td>
                                <td className="px-4 py-3 text-right"><input value={rowPrices[row.key] ?? ''} onChange={(event) => setRowPrices((prev) => ({ ...prev, [row.key]: event.target.value }))} placeholder="변경 단가" inputMode="numeric" className="w-32 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm" /></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="text-right text-xs text-slate-400">최대 300행 표시 · 조회 행이 많으면 거래처/품목 필터를 좁혀 주세요.</p>
        </section>
    );
}
