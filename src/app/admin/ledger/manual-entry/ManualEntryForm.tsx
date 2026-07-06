'use client';

import { useState, useTransition, useEffect, useCallback, useRef } from 'react';
import Combobox, { type ComboboxOption } from '@/components/Combobox';
import { createManualEntryProduct, createManualLedgerEntries, deleteManualLedgerEntry } from './actions';
import { Trash2, Plus, AlertCircle, CheckCircle2 } from 'lucide-react';

type CustomerOption = { id: string; companyName: string; customerCode: string | null };
type SupplierOption = { id: string; supplierName: string };
type CompanyEntityOption = { id: string; displayName: string; code: string };
type ProductOption = { id: string; productName: string; productCode: string };

type ManualEntry = {
    id: string;
    ledgerType: string;
    transactionDate: Date;
    customer: { companyName: string } | null;
    supplier: { supplierName: string } | null;
    companyEntity: { displayName: string } | null;
    product: { productName: string; productCode: string } | null;
    productName: string;
    quantity: number;
    unit: string;
    unitPrice: number | null;
    supplyAmount: number | null;
    memo: string | null;
};

type ManualLine = {
    key: number;
    productId: string;
    pendingProductName: string;
    quantity: string;
    unit: string;
    unitPrice: string;
    memo: string;
};

type Props = {
    customers: CustomerOption[];
    suppliers: SupplierOption[];
    companyEntities: CompanyEntityOption[];
    products: ProductOption[];
    recentEntries: ManualEntry[];
};

function fmtNum(v: number | null | undefined) {
    if (v == null) return '-';
    return v.toLocaleString('ko-KR');
}

function fmtDate(d: Date | string) {
    const dt = typeof d === 'string' ? new Date(d) : d;
    return dt.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function parseNumber(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function calcAmounts(quantity: string, unitPrice: string) {
    const q = parseNumber(quantity);
    const p = parseNumber(unitPrice);
    if (q == null || p == null || Number.isNaN(q) || Number.isNaN(p)) return { supply: null };
    return { supply: Math.round(q * p) };
}

function makeLine(): ManualLine {
    return { key: Date.now() + Math.random(), productId: '', pendingProductName: '', quantity: '', unit: 'TON', unitPrice: '', memo: '' };
}

function normalizeText(value: string) {
    return value.toLowerCase().replace(/[\s()[\]{}<>\-_/\\.,·•]+/g, '').trim();
}

function SearchCombobox({ label, required, placeholder, value, onSelect, onClear, items, disabled }: {
    label: string;
    required?: boolean;
    placeholder: string;
    value: string;
    onSelect: (id: string, name: string) => void;
    onClear: () => void;
    items: { id: string; name: string }[];
    disabled?: boolean;
}) {
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const [selectedName, setSelectedName] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!value) {
            setSelectedName('');
            setQuery('');
        }
    }, [value]);

    const normalizedQuery = normalizeText(query);
    const filtered = normalizedQuery ? items.filter((item) => normalizeText(item.name).includes(normalizedQuery)).slice(0, 50) : items.slice(0, 20);

    useEffect(() => {
        function handler(e: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
        }
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    return (
        <div ref={containerRef} className="relative">
            <label className="block text-xs font-semibold text-slate-600 mb-1">{label}{required ? ' *' : ''}</label>
            {value ? (
                <div className="flex items-center gap-2 rounded-lg border border-blue-400 bg-blue-50 px-3 py-2 text-sm">
                    <span className="flex-1 font-medium text-blue-800">{selectedName}</span>
                    <button type="button" onClick={() => { onClear(); setQuery(''); setSelectedName(''); }} disabled={disabled} className="text-blue-500 hover:text-blue-700">✕</button>
                </div>
            ) : (
                <>
                    <input type="text" value={query} onChange={(e) => { setQuery(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder={placeholder} disabled={disabled} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:opacity-60" />
                    {open && (
                        <div className="absolute z-50 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-lg max-h-52 overflow-y-auto">
                            {filtered.length === 0 ? <div className="px-4 py-3 text-sm text-slate-400">검색 결과 없음</div> : filtered.map((item) => (
                                <button key={item.id} type="button" className="w-full px-4 py-2.5 text-left text-sm hover:bg-blue-50 hover:text-blue-800" onMouseDown={(e) => e.preventDefault()} onClick={() => { onSelect(item.id, item.name); setSelectedName(item.name); setQuery(''); setOpen(false); }}>
                                    {item.name}
                                </button>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

export default function ManualEntryForm({ customers, suppliers, companyEntities, products, recentEntries: initialEntries }: Props) {
    const [ledgerType, setLedgerType] = useState<'SALES' | 'PURCHASE'>('SALES');
    const [txDate, setTxDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [customerId, setCustomerId] = useState('');
    const [supplierId, setSupplierId] = useState('');
    const [companyEntityId, setCompanyEntityId] = useState('');
    const [lines, setLines] = useState<ManualLine[]>([makeLine()]);
    const [globalMemo, setGlobalMemo] = useState('');
    const [productOptions, setProductOptions] = useState<ProductOption[]>(products);
    const [creatingProductKey, setCreatingProductKey] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [entries, setEntries] = useState(initialEntries);

    const [pending, startTransition] = useTransition();
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:opacity-60';
    const labelCls = 'block text-xs font-semibold text-slate-600 mb-1';
    const customerItems = customers.map((c) => ({ id: c.id, name: c.companyName }));
    const supplierItems = suppliers.map((s) => ({ id: s.id, name: s.supplierName }));
    const entityItems = companyEntities.map((c) => ({ id: c.id, name: c.displayName }));
    const productComboboxOptions: ComboboxOption[] = productOptions.map((product) => ({ value: product.id, label: product.productName, sublabel: product.productCode }));

    function updateLine(key: number, patch: Partial<ManualLine>) {
        setError(null);
        setLines((prev) => prev.map((line) => line.key === key ? { ...line, ...patch } : line));
    }

    function addLine() {
        setLines((prev) => [...prev, makeLine()]);
    }

    function removeLine(key: number) {
        setLines((prev) => prev.length === 1 ? prev : prev.filter((line) => line.key !== key));
    }

    const resetForm = useCallback(() => {
        setCustomerId('');
        setSupplierId('');
        setCompanyEntityId('');
        setLines([makeLine()]);
        setGlobalMemo('');
        setError(null);
    }, []);

    function handleProductChange(lineKey: number, productId: string, label: string) {
        updateLine(lineKey, { productId, pendingProductName: label });
    }

    function handleProductFreeText(lineKey: number, text: string) {
        const exact = productOptions.find((product) => normalizeText(product.productName) === normalizeText(text) || normalizeText(product.productCode) === normalizeText(text));
        if (exact) {
            updateLine(lineKey, { productId: exact.id, pendingProductName: exact.productName });
            return;
        }
        updateLine(lineKey, { productId: '', pendingProductName: text });
    }

    function handleCreateProduct(line: ManualLine) {
        const productName = line.pendingProductName.trim();
        if (!productName) {
            setError('추가할 품목명을 입력해 주세요.');
            return;
        }
        setCreatingProductKey(line.key);
        startTransition(async () => {
            const result = await createManualEntryProduct(productName);
            setCreatingProductKey(null);
            if (!result.ok) {
                setError(result.error);
                return;
            }
            setProductOptions((prev) => prev.some((product) => product.id === result.product.id) ? prev : [...prev, result.product].sort((a, b) => a.productName.localeCompare(b.productName, 'ko')));
            updateLine(line.key, { productId: result.product.id, pendingProductName: result.product.productName });
            setSuccess(`신규 품목 '${result.product.productName}'이 추가되었습니다.`);
            setTimeout(() => setSuccess(null), 3000);
        });
    }

    function doSubmit() {
        const parsedItems = lines.map((line, index) => {
            const quantity = parseNumber(line.quantity);
            const unitPrice = parseNumber(line.unitPrice);
            if (!line.productId) throw new Error(`${index + 1}번째 품목을 기존 제품과 매칭하거나 신규 품목으로 추가해 주세요.`);
            if (quantity == null || Number.isNaN(quantity) || quantity === 0) throw new Error(`${index + 1}번째 수량을 확인해 주세요.`);
            if (Number.isNaN(unitPrice)) throw new Error(`${index + 1}번째 단가를 확인해 주세요.`);
            return { productId: line.productId, quantity, unit: line.unit, unitPrice, memo: line.memo };
        });

        startTransition(async () => {
            const result = await createManualLedgerEntries({
                ledgerType,
                transactionDate: txDate,
                customerId: ledgerType === 'SALES' ? customerId : undefined,
                companyEntityId: ledgerType === 'SALES' ? companyEntityId : undefined,
                supplierId: ledgerType === 'PURCHASE' ? supplierId : undefined,
                items: parsedItems,
                memo: globalMemo,
            });
            if (!result.ok) {
                setError(result.error);
                return;
            }
            setSuccess(`원장 항목 ${result.ids.length}건이 등록되었습니다.`);
            setTimeout(() => setSuccess(null), 5000);
            resetForm();
            window.location.reload();
        });
    }

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setSuccess(null);
        try {
            doSubmit();
        } catch (err) {
            setError(err instanceof Error ? err.message : '입력값을 확인해 주세요.');
        }
    }

    function handleDelete(id: string) {
        if (!confirm('이 수동 입력 항목을 삭제하시겠습니까?')) return;
        setDeletingId(id);
        startTransition(async () => {
            const result = await deleteManualLedgerEntry(id);
            setDeletingId(null);
            if (!result.ok) {
                alert(result.error);
                return;
            }
            setEntries((prev) => prev.filter((entry) => entry.id !== id));
        });
    }

    return (
        <div className="space-y-8">
            <form onSubmit={handleSubmit} className="rounded-2xl border border-orange-100 bg-white p-6 shadow-sm">
                <h2 className="mb-5 text-lg font-black text-slate-900">수동 원장 입력</h2>

                <div className="mb-6 inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
                    <button type="button" onClick={() => setLedgerType('SALES')} className={`rounded-lg px-5 py-2 text-sm font-bold transition ${ledgerType === 'SALES' ? 'bg-orange-500 text-white shadow' : 'text-slate-600 hover:bg-white'}`}>📤 매출</button>
                    <button type="button" onClick={() => setLedgerType('PURCHASE')} className={`rounded-lg px-5 py-2 text-sm font-bold transition ${ledgerType === 'PURCHASE' ? 'bg-blue-600 text-white shadow' : 'text-slate-600 hover:bg-white'}`}>📥 매입</button>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                        <label className={labelCls}>거래일자 *</label>
                        <input type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} required className={inputCls} disabled={pending} />
                    </div>

                    {ledgerType === 'SALES' && <SearchCombobox label="거래처" required placeholder="거래처명 검색..." value={customerId} onSelect={(id) => setCustomerId(id)} onClear={() => setCustomerId('')} items={customerItems} disabled={pending} />}
                    {ledgerType === 'SALES' && <SearchCombobox label="매출법인 (선택사항)" placeholder="법인명 검색..." value={companyEntityId} onSelect={(id) => setCompanyEntityId(id)} onClear={() => setCompanyEntityId('')} items={entityItems} disabled={pending} />}
                    {ledgerType === 'PURCHASE' && <SearchCombobox label="매입처" required placeholder="매입처명 검색..." value={supplierId} onSelect={(id) => setSupplierId(id)} onClear={() => setSupplierId('')} items={supplierItems} disabled={pending} />}

                    <div className="sm:col-span-2 lg:col-span-3">
                        <label className={labelCls}>공통 메모</label>
                        <input type="text" value={globalMemo} onChange={(e) => setGlobalMemo(e.target.value)} placeholder="예: A→B 대여분, 대진화성산업 상계 등" className={inputCls} disabled={pending} />
                    </div>
                </div>

                <div className="mt-6 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <h3 className="text-sm font-bold text-slate-800">품목 라인</h3>
                            <p className="mt-0.5 text-xs text-slate-500">상계를 위해 반드시 등록된 제품과 매칭됩니다. 없으면 해당 라인에서 신규 품목을 추가하세요.</p>
                        </div>
                        <button type="button" onClick={addLine} disabled={pending} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-60"><Plus size={14} /> 품목 추가</button>
                    </div>

                    {lines.map((line, index) => {
                        const selectedProduct = productOptions.find((product) => product.id === line.productId);
                        const amounts = calcAmounts(line.quantity, line.unitPrice);
                        const needsProductCreate = Boolean(line.pendingProductName.trim()) && !line.productId;
                        return (
                            <div key={line.key} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                                <div className="mb-3 flex items-center justify-between">
                                    <span className="text-sm font-bold text-slate-700">품목 {index + 1}</span>
                                    <button type="button" onClick={() => removeLine(line.key)} disabled={pending || lines.length === 1} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"><Trash2 size={15} /></button>
                                </div>
                                <div className="grid gap-3 lg:grid-cols-12">
                                    <div className="lg:col-span-4">
                                        <label className="mb-1 block text-xs font-semibold text-slate-600">제품명 *</label>
                                        <Combobox options={productComboboxOptions} value={line.productId} onChange={(value, label) => handleProductChange(line.key, value, label)} onFreeText={(text) => handleProductFreeText(line.key, text)} placeholder="제품명/코드 검색" disabled={pending} emptyText="매칭 제품 없음" />
                                        {selectedProduct && <p className="mt-1 text-[11px] font-semibold text-blue-700">매칭됨: {selectedProduct.productName} <span className="font-mono text-blue-400">{selectedProduct.productCode}</span></p>}
                                        {needsProductCreate && (
                                            <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                                                <span className="text-[11px] font-semibold text-amber-800">'{line.pendingProductName}' 신규 품목 필요</span>
                                                <button type="button" onClick={() => handleCreateProduct(line)} disabled={pending || creatingProductKey === line.key} className="shrink-0 rounded-md bg-amber-600 px-2 py-1 text-[11px] font-bold text-white disabled:opacity-60">신규 추가</button>
                                            </div>
                                        )}
                                    </div>
                                    <div className="lg:col-span-2">
                                        <label className={labelCls}>수량 *</label>
                                        <input type="number" value={line.quantity} onChange={(e) => updateLine(line.key, { quantity: e.target.value })} required step="0.001" placeholder="예: 10 또는 -10" className={inputCls} disabled={pending} />
                                    </div>
                                    <div className="lg:col-span-2">
                                        <label className={labelCls}>단위</label>
                                        <select value={line.unit} onChange={(e) => updateLine(line.key, { unit: e.target.value })} className={inputCls} disabled={pending}>
                                            <option value="TON">TON</option><option value="KG">KG</option><option value="EA">EA</option><option value="BOX">BOX</option>
                                        </select>
                                    </div>
                                    <div className="lg:col-span-2">
                                        <label className={labelCls}>단가</label>
                                        <input type="text" value={line.unitPrice} onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })} placeholder="예: 2500000" className={inputCls} disabled={pending} />
                                    </div>
                                    <div className="lg:col-span-2">
                                        <label className={labelCls}>공급가액</label>
                                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-right text-sm text-slate-600">{fmtNum(amounts.supply)}</div>
                                    </div>
                                    <div className="lg:col-span-12">
                                        <label className={labelCls}>라인 메모</label>
                                        <input type="text" value={line.memo} onChange={(e) => updateLine(line.key, { memo: e.target.value })} placeholder="이 품목에만 남길 메모" className={inputCls} disabled={pending} />
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {error && <div className="mt-4 flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700"><AlertCircle size={16} /> {error}</div>}
                {success && <div className="mt-4 flex items-center gap-2 rounded-xl bg-green-50 px-4 py-3 text-sm font-semibold text-green-700"><CheckCircle2 size={16} /> {success}</div>}

                <div className="mt-6 flex items-center gap-3">
                    <button type="submit" disabled={pending} className="flex items-center gap-2 rounded-xl bg-orange-500 px-6 py-2.5 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-60"><Plus size={16} />{pending ? '저장 중...' : `원장 ${lines.length}건 등록`}</button>
                    <button type="button" onClick={resetForm} disabled={pending} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60">초기화</button>
                </div>
            </form>

            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="border-b border-slate-100 px-6 py-4">
                    <h2 className="font-bold text-slate-900">수동 입력 내역</h2>
                    <p className="mt-0.5 text-xs text-slate-500">최근 100건 · 삭제는 수동 입력 항목만 가능</p>
                </div>
                {entries.length === 0 ? <div className="p-8 text-center text-sm text-slate-400">수동 입력 내역이 없습니다.</div> : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-500 uppercase">
                                    <th className="px-4 py-3">유형</th><th className="px-4 py-3">거래일자</th><th className="px-4 py-3">거래처/매입처</th><th className="px-4 py-3">법인</th><th className="px-4 py-3">품목</th><th className="px-4 py-3 text-right">수량</th><th className="px-4 py-3 text-right">단가</th><th className="px-4 py-3 text-right">공급가액</th><th className="px-4 py-3">메모</th><th className="px-4 py-3"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {entries.map((entry) => (
                                    <tr key={entry.id} className="hover:bg-slate-50/60">
                                        <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${entry.ledgerType === 'SALES' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>{entry.ledgerType === 'SALES' ? '매출' : '매입'}</span></td>
                                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{fmtDate(entry.transactionDate)}</td>
                                        <td className="px-4 py-3 font-medium text-slate-800">{entry.customer?.companyName ?? entry.supplier?.supplierName ?? '-'}</td>
                                        <td className="px-4 py-3 text-slate-500 text-xs">{entry.companyEntity?.displayName ?? '-'}</td>
                                        <td className="px-4 py-3 text-slate-700">{entry.product?.productName ?? entry.productName}</td>
                                        <td className="px-4 py-3 text-right font-mono"><span className={entry.quantity < 0 ? 'text-blue-600 font-bold' : ''}>{fmtNum(entry.quantity)} {entry.unit}</span></td>
                                        <td className="px-4 py-3 text-right text-slate-600">{fmtNum(entry.unitPrice)}</td>
                                        <td className="px-4 py-3 text-right text-slate-600">{fmtNum(entry.supplyAmount)}</td>
                                        <td className="px-4 py-3 text-xs text-slate-500 max-w-[180px] truncate">{entry.memo ?? '-'}</td>
                                        <td className="px-4 py-3"><button type="button" onClick={() => handleDelete(entry.id)} disabled={pending || deletingId === entry.id} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 transition" title="삭제"><Trash2 size={15} /></button></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
