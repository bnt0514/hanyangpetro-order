'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Scissors, X } from 'lucide-react';
import { splitPurchaseLedgerRow, splitSalesLedgerRow, updateLedgerRow } from './row-actions';

export type LedgerProductOption = { id: string; productName: string; productCode: string };
type CustomerOption = { id: string; companyName: string; customerCode: string | null };
type SupplierOption = { id: string; supplierName: string; contactPerson: string | null; phone: string | null };

type Props = {
    canEdit: boolean;
    mode: 'SALES' | 'PURCHASE';
    rowId: string;
    transactionDate: string;
    productId?: string | null;
    productName: string;
    quantity: number;
    unit: string;
    unitPrice: number | null;
    memo?: string | null;
    products: LedgerProductOption[];
};

function parsePrice(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export default function LedgerRowEditButton(props: Props) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [date, setDate] = useState(props.transactionDate);
    const [productId, setProductId] = useState(props.productId ?? '');
    const [productName, setProductName] = useState(props.productName);
    const [quantity, setQuantity] = useState(String(props.quantity));
    const [unit, setUnit] = useState(props.unit || 'TON');
    const [unitPrice, setUnitPrice] = useState(props.unitPrice == null ? '' : props.unitPrice.toLocaleString('ko-KR'));
    const [memo, setMemo] = useState(props.memo ?? '');
    const [reason, setReason] = useState('');
    const [message, setMessage] = useState<string | null>(null);
    const [splitOpen, setSplitOpen] = useState(false);
    const [targetQuery, setTargetQuery] = useState('');
    const [customerResults, setCustomerResults] = useState<CustomerOption[]>([]);
    const [supplierResults, setSupplierResults] = useState<SupplierOption[]>([]);
    const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null);
    const [selectedSupplier, setSelectedSupplier] = useState<SupplierOption | null>(null);
    const [splitQuantity, setSplitQuantity] = useState('');
    const [splitReason, setSplitReason] = useState('');
    const [splitMessage, setSplitMessage] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();
    const [splitPending, startSplitTransition] = useTransition();

    const isOrderRow = !props.rowId.startsWith('ledger:');
    const selectedProductName = useMemo(() => props.products.find((product) => product.id === productId)?.productName ?? productName, [productId, productName, props.products]);
    const canSplit = props.quantity > 0;
    const isSales = props.mode === 'SALES';
    const splitTitle = isSales ? '매출분리' : '매입분리';
    const targetLabel = isSales ? '이관 거래처' : '이관 매입처';
    const selectedTarget = isSales ? selectedCustomer : selectedSupplier;

    useEffect(() => {
        if (!splitOpen || selectedTarget) return;
        const handle = window.setTimeout(async () => {
            try {
                const endpoint = isSales ? '/api/customers/search' : '/api/suppliers/search';
                const res = await fetch(`${endpoint}?q=${encodeURIComponent(targetQuery.trim())}`);
                if (!res.ok) return;
                const data = await res.json();
                if (isSales) {
                    setCustomerResults(Array.isArray(data) ? data.slice(0, 12) : []);
                } else {
                    setSupplierResults(Array.isArray(data) ? data.slice(0, 12) : []);
                }
            } catch {
                setCustomerResults([]);
                setSupplierResults([]);
            }
        }, 180);
        return () => window.clearTimeout(handle);
    }, [isSales, selectedTarget, splitOpen, targetQuery]);

    if (!props.canEdit) return null;

    function resetSplitState() {
        setSelectedCustomer(null);
        setSelectedSupplier(null);
        setTargetQuery('');
        setCustomerResults([]);
        setSupplierResults([]);
        setSplitQuantity('');
        setSplitReason('');
        setSplitMessage(null);
    }

    function submit() {
        setMessage(null);
        const parsedQuantity = Number(quantity);
        const parsedPrice = parsePrice(unitPrice);
        if (!Number.isFinite(parsedQuantity) || parsedQuantity === 0) {
            setMessage('수량을 확인해 주세요.');
            return;
        }
        if (Number.isNaN(parsedPrice)) {
            setMessage('단가를 확인해 주세요.');
            return;
        }
        startTransition(async () => {
            const result = await updateLedgerRow({
                mode: props.mode,
                rowId: props.rowId,
                transactionDate: date,
                productId: productId || null,
                productName: selectedProductName,
                quantity: parsedQuantity,
                unit,
                unitPrice: parsedPrice,
                memo,
                reason,
            });
            if (!result.ok) {
                setMessage(result.error);
                return;
            }
            setMessage('수정 완료');
            setOpen(false);
            router.refresh();
        });
    }

    function submitSplit() {
        setSplitMessage(null);
        const parsedQuantity = Number(splitQuantity);
        if (isSales && !selectedCustomer) {
            setSplitMessage('이관할 거래처를 선택해 주세요.');
            return;
        }
        if (!isSales && !selectedSupplier) {
            setSplitMessage('이관할 매입처를 선택해 주세요.');
            return;
        }
        if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
            setSplitMessage('분리 수량을 확인해 주세요.');
            return;
        }
        if (parsedQuantity > props.quantity) {
            setSplitMessage('분리/이관 수량은 현재 수량을 초과할 수 없습니다.');
            return;
        }
        startSplitTransition(async () => {
            const result = isSales
                ? await splitSalesLedgerRow({
                    rowId: props.rowId,
                    targetCustomerId: selectedCustomer!.id,
                    quantity: parsedQuantity,
                    reason: splitReason,
                })
                : await splitPurchaseLedgerRow({
                    rowId: props.rowId,
                    targetSupplierId: selectedSupplier!.id,
                    quantity: parsedQuantity,
                    reason: splitReason,
                });
            if (!result.ok) {
                setSplitMessage(result.error);
                return;
            }
            setSplitOpen(false);
            resetSplitState();
            router.refresh();
        });
    }

    return (
        <>
            <span className="inline-flex items-center justify-end gap-1">
                <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                    수정
                </button>
                {canSplit && (
                    <button type="button" onClick={() => setSplitOpen(true)} className="inline-flex items-center gap-1 rounded-lg border border-orange-200 px-2 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-50">
                        <Scissors size={12} /> {splitTitle}
                    </button>
                )}
            </span>
            {open && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
                    <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 text-sm shadow-2xl">
                        <div className="mb-4 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-slate-900">{props.mode === 'SALES' ? '매출 원장 수정' : '매입 원장 수정'}</h2>
                            <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <label className="space-y-1">
                                <span className="font-semibold text-slate-600">{props.mode === 'SALES' ? '매출일자' : '매입일자'}</span>
                                <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
                            </label>
                            <label className="space-y-1">
                                <span className="font-semibold text-slate-600">수량</span>
                                <input type="number" step="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-right outline-none focus:border-blue-500" />
                            </label>
                            <label className="col-span-2 space-y-1">
                                <span className="font-semibold text-slate-600">품목</span>
                                {isOrderRow ? (
                                    <select value={productId} onChange={(event) => setProductId(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500">
                                        <option value="">품목 선택</option>
                                        {props.products.map((product) => <option key={product.id} value={product.id}>{product.productName}</option>)}
                                    </select>
                                ) : (
                                    <input value={productName} onChange={(event) => { setProductName(event.target.value); setProductId(''); }} className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
                                )}
                            </label>
                            <label className="space-y-1">
                                <span className="font-semibold text-slate-600">단위</span>
                                <select value={unit} onChange={(event) => setUnit(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500">
                                    <option value="TON">TON</option>
                                    <option value="KG">KG</option>
                                    <option value="EA">EA</option>
                                    <option value="BOX">BOX</option>
                                </select>
                            </label>
                            <label className="space-y-1">
                                <span className="font-semibold text-slate-600">단가</span>
                                <input value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-right outline-none focus:border-blue-500" />
                            </label>
                            <label className="col-span-2 space-y-1">
                                <span className="font-semibold text-slate-600">메모</span>
                                <input value={memo} onChange={(event) => setMemo(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
                            </label>
                            <label className="col-span-2 space-y-1">
                                <span className="font-semibold text-slate-600">수정 사유 *</span>
                                <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="예: 익월 매출 반영, 단가 확정" className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
                            </label>
                        </div>
                        {message && <p className="mt-3 text-xs text-red-600">{message}</p>}
                        <div className="mt-4 flex justify-end gap-2">
                            <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">취소</button>
                            <button type="button" onClick={submit} disabled={pending || !reason.trim()} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">저장</button>
                        </div>
                    </div>
                </div>
            )}
            {splitOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
                    <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 text-sm shadow-2xl">
                        <div className="mb-4 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-slate-900">{splitTitle}</h2>
                            <button type="button" onClick={() => { setSplitOpen(false); resetSplitState(); }} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
                        </div>
                        <div className="rounded-xl bg-orange-50 p-3 text-xs text-orange-900">
                            <p className="font-semibold">{props.transactionDate} · {props.productName}</p>
                            <p className="mt-1">
                                일부 수량은 {splitTitle}로 처리하고, 전체 수량을 입력하면 선택한 {isSales ? '거래처' : '매입처'}로 이관됩니다.
                                날짜와 단가는 그대로 유지됩니다.
                            </p>
                        </div>
                        <div className="mt-4 grid gap-3">
                            <label className="space-y-1">
                                <span className="font-semibold text-slate-600">{targetLabel}</span>
                                {selectedCustomer && isSales ? (
                                    <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-3 py-2">
                                        <span className="font-semibold text-green-800">{selectedCustomer.companyName}</span>
                                        <button type="button" onClick={() => setSelectedCustomer(null)} className="text-xs font-semibold text-green-700 hover:text-green-900">다시 선택</button>
                                    </div>
                                ) : selectedSupplier && !isSales ? (
                                    <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-3 py-2">
                                        <span className="font-semibold text-green-800">{selectedSupplier.supplierName}</span>
                                        <button type="button" onClick={() => setSelectedSupplier(null)} className="text-xs font-semibold text-green-700 hover:text-green-900">다시 선택</button>
                                    </div>
                                ) : (
                                    <>
                                        <input
                                            value={targetQuery}
                                            onChange={(event) => setTargetQuery(event.target.value)}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter') {
                                                    event.preventDefault();
                                                    if (isSales && customerResults[0]) setSelectedCustomer(customerResults[0]);
                                                    if (!isSales && supplierResults[0]) setSelectedSupplier(supplierResults[0]);
                                                }
                                            }}
                                            placeholder={`${isSales ? '거래처명' : '매입처명'} 입력 후 선택`}
                                            className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-orange-500"
                                        />
                                        <div className="max-h-40 overflow-auto rounded-lg border border-slate-100">
                                            {isSales ? customerResults.map((customer) => (
                                                <button key={customer.id} type="button" onClick={() => setSelectedCustomer(customer)} className="flex w-full items-center justify-between border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50">
                                                    <span className="font-medium text-slate-800">{customer.companyName}</span>
                                                    <span className="text-xs text-slate-400">{customer.customerCode ?? ''}</span>
                                                </button>
                                            )) : supplierResults.map((supplier) => (
                                                <button key={supplier.id} type="button" onClick={() => setSelectedSupplier(supplier)} className="flex w-full items-center justify-between border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50">
                                                    <span className="font-medium text-slate-800">{supplier.supplierName}</span>
                                                    <span className="text-xs text-slate-400">{supplier.contactPerson ?? supplier.phone ?? ''}</span>
                                                </button>
                                            ))}
                                            {((isSales && customerResults.length === 0) || (!isSales && supplierResults.length === 0)) && <p className="px-3 py-3 text-xs text-slate-400">{isSales ? '거래처명' : '매입처명'}을 입력하면 검색됩니다.</p>}
                                        </div>
                                    </>
                                )}
                            </label>
                            <label className="space-y-1">
                                <span className="font-semibold text-slate-600">분리 수량</span>
                                <div className="flex items-center gap-2">
                                    <input type="number" step="0.001" value={splitQuantity} onChange={(event) => setSplitQuantity(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-right outline-none focus:border-orange-500" />
                                    <span className="w-12 text-xs font-semibold text-slate-500">{props.unit}</span>
                                </div>
                            </label>
                            <label className="space-y-1">
                                <span className="font-semibold text-slate-600">메모</span>
                                <input value={splitReason} onChange={(event) => setSplitReason(event.target.value)} placeholder={isSales ? '예: 매출처 정정, 일부 이관' : '예: 매입처 정정, 일부 이관'} className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-orange-500" />
                            </label>
                        </div>
                        {splitMessage && <p className="mt-3 text-xs text-red-600">{splitMessage}</p>}
                        <div className="mt-4 flex justify-end gap-2">
                            <button type="button" onClick={() => { setSplitOpen(false); resetSplitState(); }} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">취소</button>
                            <button type="button" onClick={submitSplit} disabled={splitPending || !selectedTarget || !splitQuantity} className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">분리/이관 저장</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
