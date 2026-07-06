'use client';

import { type ReactNode, useMemo, useRef, useState, useTransition } from 'react';
import { ArrowUpDown, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useF8SaveShortcut } from '@/hooks/useF8SaveShortcut';
import { createFinanceTransaction, deleteFinanceTransaction, updateFinanceTransaction } from './actions';

type CustomerOption = { id: string; companyName: string };
type SupplierOption = { id: string; supplierName: string };
type TxMode = 'IN' | 'PAYMENT' | 'NOTE_IN' | 'NOTE_TRANSFER' | 'NOTE_DECREASE';
type SortKey = 'txDate' | 'txType' | 'counterparty' | 'amount' | 'memo' | 'source';
type SortDirection = 'asc' | 'desc';

type NoteReceipt = {
    id: string;
    txDate: string;
    customerName: string | null;
    amount: number;
    transferredAmount: number;
    remainingAmount: number;
    noteNumber: string;
    noteMaturityDate: string | null;
    noteIssuer: string | null;
    noteDescription: string | null;
};

type Row = {
    id: string;
    txDate: string;
    txType: string;
    amount: number;
    memo: string | null;
    source: string;
    customerId: string | null;
    customerName: string | null;
    supplierId: string | null;
    supplierName: string | null;
    noteNumber: string | null;
    noteMaturityDate: string | null;
    noteIssuer: string | null;
    noteDescription: string | null;
};

const NOTE_TRANSFER_SUPPLIER_NAMES = ['한화솔루션', '에코텍', '율촌화학'];

const NOTE_TRANSFER_HS_POLYMER_NAME = '\uD76C\uC131\uD3F4\uB9AC\uBA38';

function money(value: number) {
    return value.toLocaleString('ko-KR');
}

function normalizeCounterpartyName(value: string) {
    return value.replace(/주식\s*회사/g, '').replace(/\(주\)|㈜|\s|[()]/g, '').trim().toLowerCase();
}

function txTypeLabel(value: string) {
    if (value === 'IN') return '입금';
    if (value === 'PAYMENT') return '출금';
    if (value === 'NOTE_IN') return '어음수취';
    if (value === 'NOTE_TRANSFER') return '어음지급';
    if (value === 'NOTE_DECREASE') return '어음감소';
    return value;
}

function rowCounterparty(row: Row) {
    return row.customerName ?? row.supplierName ?? '';
}

function rowMemoNote(row: Row) {
    return [row.memo, row.noteNumber, row.noteMaturityDate, row.noteIssuer, row.noteDescription].filter(Boolean).join(' ');
}

function rowSearchText(row: Row) {
    return [row.txDate, txTypeLabel(row.txType), rowCounterparty(row), row.amount, rowMemoNote(row), row.source].join(' ').toLowerCase();
}

export default function FinanceTransactionClient({
    rows,
    customers,
    suppliers,
    noteReceipts,
}: {
    rows: Row[];
    customers: CustomerOption[];
    suppliers: SupplierOption[];
    noteReceipts: NoteReceipt[];
}) {
    const createFormRef = useRef<HTMLFormElement>(null);
    const [mode, setMode] = useState<TxMode>('IN');
    const [editing, setEditing] = useState<Row | null>(null);
    const [message, setMessage] = useState('');
    const [amountValue, setAmountValue] = useState('');
    const [selectedNote, setSelectedNote] = useState<NoteReceipt | null>(null);
    const [notePickerOpen, setNotePickerOpen] = useState(false);
    const [filterText, setFilterText] = useState('');
    const [sortKey, setSortKey] = useState<SortKey>('txDate');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
    const [isPending, startTransition] = useTransition();

    const noteTransferSuppliers = [...NOTE_TRANSFER_SUPPLIER_NAMES, NOTE_TRANSFER_HS_POLYMER_NAME].map((targetName) => {
        const normalizedTarget = normalizeCounterpartyName(targetName);
        return suppliers.find((supplier) => normalizeCounterpartyName(supplier.supplierName).includes(normalizedTarget)) ?? { id: targetName, supplierName: targetName };
    });

    const visibleRows = useMemo(() => {
        const normalizedFilter = filterText.trim().toLowerCase();
        const filtered = normalizedFilter ? rows.filter((row) => rowSearchText(row).includes(normalizedFilter)) : rows;
        return [...filtered].sort((a, b) => {
            const direction = sortDirection === 'asc' ? 1 : -1;
            if (sortKey === 'amount') return (a.amount - b.amount) * direction;
            const left = sortKey === 'txDate'
                ? a.txDate
                : sortKey === 'txType'
                    ? txTypeLabel(a.txType)
                    : sortKey === 'counterparty'
                        ? rowCounterparty(a)
                        : sortKey === 'memo'
                            ? rowMemoNote(a)
                            : a.source;
            const right = sortKey === 'txDate'
                ? b.txDate
                : sortKey === 'txType'
                    ? txTypeLabel(b.txType)
                    : sortKey === 'counterparty'
                        ? rowCounterparty(b)
                        : sortKey === 'memo'
                            ? rowMemoNote(b)
                            : b.source;
            return left.localeCompare(right, 'ko') * direction;
        });
    }, [filterText, rows, sortDirection, sortKey]);

    useF8SaveShortcut(() => createFormRef.current?.requestSubmit(), {
        disabled: isPending || notePickerOpen || !!editing,
        scopeRef: createFormRef,
        requireFocusWithin: false,
    });

    function changeMode(value: TxMode) {
        setMode(value);
        setSelectedNote(null);
        setAmountValue('');
    }

    function selectNote(note: NoteReceipt) {
        setSelectedNote(note);
        setAmountValue(String(note.remainingAmount));
        setNotePickerOpen(false);
    }

    function submitCreate(formData: FormData) {
        setMessage('');
        const txType = String(formData.get('txType') ?? '');
        const noteNumber = String(formData.get('noteNumber') ?? '').trim();
        if (txType === 'NOTE_IN' && noteReceipts.some((note) => note.noteNumber === noteNumber)) {
            window.alert('같은 어음번호로 등록된 어음이 있습니다. 중복 건입니다. 실제 다른 어음이면 어음번호를 한 자리 더 입력해주세요.');
            return;
        }
        if (txType === 'NOTE_TRANSFER' && !noteReceipts.some((note) => note.noteNumber === noteNumber)) {
            window.alert('등록된 어음에서 선택해주세요. 없는 어음은 지급 등록할 수 없습니다.');
            return;
        }
        startTransition(async () => {
            const result = await createFinanceTransaction(formData);
            if (result.ok) {
                createFormRef.current?.reset();
                setAmountValue('');
                setSelectedNote(null);
            }
            setMessage(result.ok ? '추가했습니다.' : result.error);
        });
    }

    function submitUpdate(formData: FormData) {
        setMessage('');
        startTransition(async () => {
            const result = await updateFinanceTransaction(formData);
            if (result.ok) setEditing(null);
            setMessage(result.ok ? '수정했습니다.' : result.error);
        });
    }

    function remove(id: string) {
        if (!window.confirm('이 입출금 내역을 삭제할까요?')) return;
        setMessage('');
        startTransition(async () => {
            const result = await deleteFinanceTransaction(id);
            setMessage(result.ok ? '삭제했습니다.' : result.error);
        });
    }

    function toggleSort(nextKey: SortKey) {
        if (sortKey === nextKey) {
            setSortDirection((value) => value === 'asc' ? 'desc' : 'asc');
            return;
        }
        setSortKey(nextKey);
        setSortDirection(nextKey === 'amount' ? 'desc' : 'asc');
    }

    function SortHeader({ column, align = 'left', children }: { column: SortKey; align?: 'left' | 'right'; children: ReactNode }) {
        const active = sortKey === column;
        return (
            <button type="button" onClick={() => toggleSort(column)} className={`inline-flex w-full items-center gap-1.5 ${align === 'right' ? 'justify-end' : 'justify-start'} text-xs font-semibold text-slate-500 hover:text-slate-900`}>
                <span>{children}</span>
                <ArrowUpDown size={13} className={active ? 'text-slate-900' : 'text-slate-300'} />
                {active && <span className="text-[10px] text-slate-400">{sortDirection === 'asc' ? '오름' : '내림'}</span>}
            </button>
        );
    }

    return (
        <div className="space-y-4">
            {message && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{message}</div>}

            <form ref={createFormRef} action={submitCreate} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="grid gap-3 md:grid-cols-[120px_160px_1fr_160px_1fr_auto] md:items-end">
                    <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-500">구분</label>
                        <select name="txType" value={mode} onChange={(event) => changeMode(event.target.value as TxMode)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
                            <option value="IN">입금</option>
                            <option value="PAYMENT">출금</option>
                            <option value="NOTE_IN">어음수취</option>
                            <option value="NOTE_TRANSFER">어음지급</option>
                            <option value="NOTE_DECREASE">어음감소</option>
                        </select>
                    </div>
                    <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-500">일자</label>
                        <input name="txDate" type="date" required className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                    </div>
                    <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-500">입력 매칭</label>
                        {mode === 'IN' || mode === 'NOTE_IN' || mode === 'NOTE_DECREASE' ? (
                            <>
                                <input name="customerName" list="finance-customer-list" required placeholder="거래처명 입력" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                                <datalist id="finance-customer-list">
                                    {customers.map((customer) => <option key={customer.id} value={customer.companyName} />)}
                                </datalist>
                            </>
                        ) : mode === 'NOTE_TRANSFER' ? (
                            <select name="supplierName" required defaultValue="" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
                                <option value="" disabled>지급 업체 선택</option>
                                {noteTransferSuppliers.map((supplier) => <option key={supplier.id} value={supplier.supplierName}>{supplier.supplierName}</option>)}
                            </select>
                        ) : (
                            <>
                                <input name="supplierName" list="finance-supplier-list" required placeholder="매입처명 입력" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                                <datalist id="finance-supplier-list">
                                    {suppliers.map((supplier) => <option key={supplier.id} value={supplier.supplierName} />)}
                                </datalist>
                            </>
                        )}
                    </div>
                    <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-500">금액</label>
                        <input name="amount" inputMode="numeric" required value={amountValue} onChange={(event) => setAmountValue(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                    </div>
                    <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-500">메모</label>
                        <input name="memo" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                    </div>
                    <button disabled={isPending} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
                        <Plus size={15} />
                        추가
                    </button>
                </div>

                {(mode === 'NOTE_IN' || mode === 'NOTE_DECREASE') && (
                    <div className="mt-3 grid gap-3 md:grid-cols-[1fr_160px_1fr_1.4fr]">
                        <div>
                            <label className="mb-1 block text-xs font-semibold text-slate-500">어음번호</label>
                            <input name="noteNumber" required className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-semibold text-slate-500">만기일</label>
                            <input name="noteMaturityDate" type="date" required className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-semibold text-slate-500">발행인</label>
                            <input name="noteIssuer" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-semibold text-slate-500">어음 적요</label>
                            <input name="noteDescription" placeholder="전자어음, 구매카드, 매출채권, 실물어음 등" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                        </div>
                    </div>
                )}

                {mode === 'NOTE_TRANSFER' && (
                    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <input type="hidden" name="noteNumber" value={selectedNote?.noteNumber ?? ''} />
                        <input type="hidden" name="noteMaturityDate" value={selectedNote?.noteMaturityDate ?? ''} />
                        <input type="hidden" name="noteIssuer" value={selectedNote?.noteIssuer ?? ''} />
                        <input type="hidden" name="noteDescription" value={selectedNote?.noteDescription ?? ''} />
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <p className="text-xs font-semibold text-slate-500">지급할 어음</p>
                                {selectedNote ? (
                                    <p className="mt-1 text-sm font-semibold text-slate-800">
                                        {selectedNote.noteNumber} / 잔액 {money(selectedNote.remainingAmount)}원 / 만기 {selectedNote.noteMaturityDate ?? '-'}
                                    </p>
                                ) : (
                                    <p className="mt-1 text-sm text-slate-500">기존 등록 어음에서 선택해주세요.</p>
                                )}
                            </div>
                            <button type="button" onClick={() => setNotePickerOpen(true)} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
                                기존 어음 선택
                            </button>
                        </div>
                        {selectedNote && (
                            <p className="mt-2 text-xs text-slate-500">
                                수취처 {selectedNote.customerName ?? '-'} / 수취일 {selectedNote.txDate} / 발행인 {selectedNote.noteIssuer ?? '-'} {selectedNote.noteDescription ? `/ ${selectedNote.noteDescription}` : ''}
                            </p>
                        )}
                    </div>
                )}
            </form>

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                    <div className="relative min-w-64 flex-1">
                        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input value={filterText} onChange={(event) => setFilterText(event.target.value)} placeholder="표 안에서 직접 검색" className="w-full rounded-xl border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-slate-500" />
                    </div>
                    <p className="text-xs text-slate-500">{visibleRows.length.toLocaleString('ko-KR')} / {rows.length.toLocaleString('ko-KR')}건</p>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[920px] text-sm">
                        <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
                            <tr>
                                <th className="px-4 py-3"><SortHeader column="txDate">일자</SortHeader></th>
                                <th className="px-4 py-3"><SortHeader column="txType">구분</SortHeader></th>
                                <th className="px-4 py-3"><SortHeader column="counterparty">거래처</SortHeader></th>
                                <th className="px-4 py-3 text-right"><SortHeader column="amount" align="right">금액</SortHeader></th>
                                <th className="px-4 py-3"><SortHeader column="memo">메모/어음</SortHeader></th>
                                <th className="px-4 py-3"><SortHeader column="source">출처</SortHeader></th>
                                <th className="px-4 py-3 text-right">관리</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {visibleRows.map((row) => (
                                <tr key={row.id} className="hover:bg-slate-50">
                                    <td className="px-4 py-3">{row.txDate}</td>
                                    <td className="px-4 py-3">{txTypeLabel(row.txType)}</td>
                                    <td className="px-4 py-3 font-medium text-slate-800">{rowCounterparty(row) || '-'}</td>
                                    <td className="px-4 py-3 text-right font-semibold">{money(row.amount)}</td>
                                    <td className="px-4 py-3 text-slate-600">
                                        <div>{row.memo ?? '-'}</div>
                                        {row.noteNumber && (
                                            <div className="mt-1 text-xs text-slate-400">
                                                {row.noteNumber} / 만기 {row.noteMaturityDate ?? '-'} / {row.noteIssuer ?? '-'} {row.noteDescription ? `/ ${row.noteDescription}` : ''}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-xs text-slate-500">{row.source}</td>
                                    <td className="px-4 py-3">
                                        <div className="flex justify-end gap-1.5">
                                            <button type="button" onClick={() => setEditing(row)} className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-50" title="수정">
                                                <Pencil size={14} />
                                            </button>
                                            <button type="button" onClick={() => remove(row.id)} className="rounded-lg border border-rose-200 p-2 text-rose-600 hover:bg-rose-50" title="삭제">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {visibleRows.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="px-4 py-12 text-center text-slate-400">표시할 입출금 내역이 없습니다.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </section>

            {notePickerOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
                    <div className="w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl">
                        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                            <h2 className="text-lg font-bold text-slate-900">지급할 어음 선택</h2>
                            <button type="button" onClick={() => setNotePickerOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
                        </div>
                        <div className="max-h-[70vh] overflow-auto">
                            <table className="w-full min-w-[760px] text-sm">
                                <thead className="sticky top-0 bg-slate-50 text-left text-xs font-semibold text-slate-500">
                                    <tr>
                                        <th className="px-4 py-3">어음번호</th>
                                        <th className="px-4 py-3">수취처</th>
                                        <th className="px-4 py-3">만기일</th>
                                        <th className="px-4 py-3 text-right">수취금액</th>
                                        <th className="px-4 py-3 text-right">지급가능</th>
                                        <th className="px-4 py-3">적요</th>
                                        <th className="px-4 py-3 text-right">선택</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {noteReceipts.map((note) => (
                                        <tr key={note.noteNumber} className="hover:bg-slate-50">
                                            <td className="px-4 py-3 font-semibold text-slate-800">{note.noteNumber}</td>
                                            <td className="px-4 py-3">{note.customerName ?? '-'}</td>
                                            <td className="px-4 py-3">{note.noteMaturityDate ?? '-'}</td>
                                            <td className="px-4 py-3 text-right">{money(note.amount)}</td>
                                            <td className="px-4 py-3 text-right font-semibold text-emerald-700">{money(note.remainingAmount)}</td>
                                            <td className="px-4 py-3 text-slate-500">{note.noteDescription ?? note.noteIssuer ?? '-'}</td>
                                            <td className="px-4 py-3 text-right">
                                                <button type="button" onClick={() => selectNote(note)} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800">
                                                    선택
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {noteReceipts.length === 0 && (
                                        <tr>
                                            <td colSpan={7} className="px-4 py-12 text-center text-slate-400">지급 가능한 등록 어음이 없습니다.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {editing && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
                    <form action={submitUpdate} className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
                        <div className="mb-4 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-slate-900">입출금 내역 수정</h2>
                            <button type="button" onClick={() => setEditing(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
                        </div>
                        <input type="hidden" name="id" value={editing.id} />
                        <div className="grid gap-3">
                            <div>
                                <label className="mb-1 block text-xs font-semibold text-slate-500">일자</label>
                                <input name="txDate" type="date" defaultValue={editing.txDate} required className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                            </div>
                            {(editing.txType === 'IN' || editing.txType === 'NOTE_IN' || editing.txType === 'NOTE_DECREASE') && (
                                <div>
                                    <label className="mb-1 block text-xs font-semibold text-slate-500">{'\uAC70\uB798\uCC98'}</label>
                                    <input name="customerName" list="finance-edit-customer-list" defaultValue={editing.customerName ?? ''} required className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                                    <datalist id="finance-edit-customer-list">
                                        {customers.map((customer) => <option key={customer.id} value={customer.companyName} />)}
                                    </datalist>
                                </div>
                            )}
                            {(editing.txType === 'PAYMENT' || editing.txType === 'NOTE_TRANSFER') && (
                                <div>
                                    <label className="mb-1 block text-xs font-semibold text-slate-500">{'\uB9E4\uC785\uCC98'}</label>
                                    <input name="supplierName" list="finance-edit-supplier-list" defaultValue={editing.supplierName ?? ''} required className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                                    <datalist id="finance-edit-supplier-list">
                                        {suppliers.map((supplier) => <option key={supplier.id} value={supplier.supplierName} />)}
                                    </datalist>
                                </div>
                            )}
                            <div>
                                <label className="mb-1 block text-xs font-semibold text-slate-500">금액</label>
                                <input name="amount" defaultValue={String(editing.amount)} required className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold text-slate-500">메모</label>
                                <textarea name="memo" defaultValue={editing.memo ?? ''} rows={3} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                            </div>
                            {(editing.txType === 'NOTE_IN' || editing.txType === 'NOTE_TRANSFER' || editing.txType === 'NOTE_DECREASE') && (
                                <div className="grid gap-3 md:grid-cols-2">
                                    <div>
                                        <label className="mb-1 block text-xs font-semibold text-slate-500">어음번호</label>
                                        <input name="noteNumber" defaultValue={editing.noteNumber ?? ''} required className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-semibold text-slate-500">만기일</label>
                                        <input name="noteMaturityDate" type="date" defaultValue={editing.noteMaturityDate ?? ''} required className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-semibold text-slate-500">발행인</label>
                                        <input name="noteIssuer" defaultValue={editing.noteIssuer ?? ''} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-semibold text-slate-500">어음 적요</label>
                                        <input name="noteDescription" defaultValue={editing.noteDescription ?? ''} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="mt-4 flex justify-end gap-2">
                            <button type="button" onClick={() => setEditing(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">취소</button>
                            <button disabled={isPending} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">저장</button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
}
