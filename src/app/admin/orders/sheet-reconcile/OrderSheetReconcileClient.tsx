'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { CheckSquare, FileSpreadsheet, ListPlus, Loader2, RefreshCw } from 'lucide-react';
import { importPurchaseSalesUpload, listPurchaseSalesSheets, previewPurchaseSalesUpload } from './actions';
import type { OrderSheetPreview, OrderSheetReconcileRow } from '@/lib/order-sheet-reconcile';

type StaffUserOption = { id: string; name: string };
type PreviewResult = OrderSheetPreview | { ok: false; error: string };
type FilePickerWindow = Window & {
    showOpenFilePicker?: (options?: {
        id?: string;
        multiple?: boolean;
        types?: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<Array<{ getFile: () => Promise<File> }>>;
};

function fmtNumber(value: number | null | undefined) {
    if (value == null) return '-';
    return value.toLocaleString('ko-KR');
}

function inferDaySheet(date: string) {
    const parsed = new Date(`${date}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return '';
    return String(parsed.getDate()).padStart(2, '0');
}

function isPreviewOk(result: PreviewResult | null): result is OrderSheetPreview {
    return !!result && !('ok' in result && result.ok === false);
}

function statusLabel(status: OrderSheetReconcileRow['matchStatus']) {
    if (status === 'MATCHED') return '일치';
    if (status === 'MISSING') return '홈페이지 누락';
    if (status === 'SUPPLIER_MISMATCH') return '매입처 차이';
    return '매칭 불가';
}

function statusClass(status: OrderSheetReconcileRow['matchStatus']) {
    if (status === 'MATCHED') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    if (status === 'MISSING') return 'border-orange-200 bg-orange-50 text-orange-700';
    if (status === 'SUPPLIER_MISMATCH') return 'border-amber-200 bg-amber-50 text-amber-700';
    return 'border-red-200 bg-red-50 text-red-700';
}

function SummaryCard({ label, value, tone = 'slate' }: { label: string; value: number; tone?: 'slate' | 'orange' | 'red' | 'emerald' | 'amber' }) {
    const tones = {
        slate: 'border-slate-200 bg-white text-slate-900',
        orange: 'border-orange-200 bg-orange-50 text-orange-800',
        red: 'border-red-200 bg-red-50 text-red-800',
        emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
        amber: 'border-amber-200 bg-amber-50 text-amber-800',
    };
    return (
        <div className={`rounded-xl border px-4 py-3 ${tones[tone]}`}>
            <p className="text-xs font-bold opacity-70">{label}</p>
            <p className="mt-1 text-2xl font-black">{fmtNumber(value)}</p>
        </div>
    );
}

function StatusBadge({ status }: { status: OrderSheetReconcileRow['matchStatus'] }) {
    return (
        <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-bold ${statusClass(status)}`}>
            {statusLabel(status)}
        </span>
    );
}

function RowCells({ row }: { row: OrderSheetReconcileRow }) {
    return (
        <>
            <td className="px-3 py-3 text-slate-500">
                <div>{row.sourceRowNumber}행</div>
                <div className="mt-1 whitespace-nowrap text-xs text-slate-400">매입 {row.purchaseDate}</div>
                <div className="whitespace-nowrap text-xs text-slate-400">매출 {row.salesDate}</div>
                <div className="whitespace-nowrap text-xs text-slate-400">도착 {row.deliveryDate}</div>
            </td>
            <td className="px-3 py-3">
                <div className="font-bold text-slate-900">{row.dbCustomerName || row.convertedCustomer || row.rawCustomer}</div>
                <div className="text-xs text-slate-400">{row.rawCustomer} / {row.customerRepName}</div>
            </td>
            <td className="px-3 py-3 text-slate-600">{row.deliveryAddressLabel || '-'}</td>
            <td className="px-3 py-3">
                <div className="font-semibold text-slate-800">{row.dbProductName || row.convertedProduct || row.rawProduct}</div>
                <div className="text-xs text-slate-400">{row.rawProduct}</div>
            </td>
            <td className="px-3 py-3 text-right font-mono text-slate-700">{fmtNumber(row.quantity)}</td>
            <td className="px-3 py-3">
                <div className="font-semibold text-slate-700">{row.dbSupplierName || row.convertedSupplier || row.supplierName}</div>
                <div className="text-xs text-slate-400">{row.supplierDefaulted ? '공란 -> 한화솔루션' : row.rawSupplier}</div>
            </td>
            <td className="px-3 py-3 text-slate-500">{row.remark || '-'}</td>
        </>
    );
}

function IssueTable({ rows, title }: { rows: OrderSheetReconcileRow[]; title: string }) {
    if (rows.length === 0) return null;
    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-black text-slate-900">{title}</h2>
            <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs font-bold text-slate-500">
                        <tr>
                            <th className="px-3 py-2">상태</th>
                            <th className="px-3 py-2">원본</th>
                            <th className="px-3 py-2">거래처</th>
                            <th className="px-3 py-2">품목</th>
                            <th className="px-3 py-2 text-right">수량</th>
                            <th className="px-3 py-2">매입처</th>
                            <th className="px-3 py-2">확인 내용</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {rows.map((row) => (
                            <tr key={row.id}>
                                <td className="px-3 py-3"><StatusBadge status={row.matchStatus} /></td>
                                <td className="px-3 py-3 text-slate-500">{row.sourceRowNumber}행</td>
                                <td className="px-3 py-3 text-slate-700">{row.dbCustomerName || row.convertedCustomer || row.rawCustomer}</td>
                                <td className="px-3 py-3 text-slate-700">{row.dbProductName || row.convertedProduct || row.rawProduct}</td>
                                <td className="px-3 py-3 text-right font-mono text-slate-700">{fmtNumber(row.quantity)}</td>
                                <td className="px-3 py-3 text-slate-700">{row.dbSupplierName || row.convertedSupplier || row.supplierName}</td>
                                <td className="px-3 py-3 text-slate-500">{row.matchNote || row.problems.join(', ') || '-'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

export default function OrderSheetReconcileClient({
    defaultDate,
    canViewAll,
    initialRepId,
    staffUsers,
}: {
    defaultDate: string;
    canViewAll: boolean;
    initialRepId: string;
    staffUsers: StaffUserOption[];
}) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const productMapInputRef = useRef<HTMLInputElement>(null);
    const [date, setDate] = useState(defaultDate);
    const [repId, setRepId] = useState(initialRepId);
    const [sheetName, setSheetName] = useState(inferDaySheet(defaultDate));
    const [sheetNames, setSheetNames] = useState<string[]>([]);
    const [fileName, setFileName] = useState('');
    const [purchaseSalesFile, setPurchaseSalesFile] = useState<File | null>(null);
    const [productMapFileName, setProductMapFileName] = useState('');
    const [productMapFile, setProductMapFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<PreviewResult | null>(null);
    const [message, setMessage] = useState('');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isPending, startTransition] = useTransition();

    const previewOk = isPreviewOk(preview) ? preview : null;
    const missingRows = previewOk?.visibleRows.filter((row) => row.matchStatus === 'MISSING') ?? [];
    const unresolvedRows = previewOk?.visibleRows.filter((row) => row.matchStatus === 'UNRESOLVED') ?? [];
    const supplierMismatchRows = previewOk?.visibleRows.filter((row) => row.matchStatus === 'SUPPLIER_MISMATCH') ?? [];
    const allMissingSelected = missingRows.length > 0 && missingRows.every((row) => selectedIds.has(row.id));

    const errorMessage = useMemo(() => {
        if (preview && 'ok' in preview && preview.ok === false) return preview.error;
        return '';
    }, [preview]);

    function buildFormData() {
        const file = purchaseSalesFile || fileInputRef.current?.files?.[0];
        const nextProductMapFile = productMapFile || productMapInputRef.current?.files?.[0];
        const formData = new FormData();
        if (file) formData.append('purchaseSalesFile', file);
        if (nextProductMapFile) formData.append('productMapFile', nextProductMapFile);
        formData.append('date', date);
        formData.append('repId', repId);
        formData.append('sheetName', sheetName);
        return formData;
    }

    function resetFileState(name = '') {
        setFileName(name);
        setPurchaseSalesFile(fileInputRef.current?.files?.[0] ?? null);
        setSheetNames([]);
        setSheetName(inferDaySheet(date));
        setPreview(null);
        setMessage('');
        setSelectedIds(new Set());
    }

    async function selectRememberedFile(kind: 'purchaseSales' | 'productMap') {
        const picker = (window as FilePickerWindow).showOpenFilePicker;
        if (!picker) {
            if (kind === 'purchaseSales') fileInputRef.current?.click();
            else productMapInputRef.current?.click();
            return;
        }

        try {
            const [handle] = await picker({
                id: kind === 'purchaseSales' ? 'hanyang-purchase-sales-file' : 'hanyang-product-map-file',
                multiple: false,
                types: [
                    {
                        description: 'Excel files',
                        accept: {
                            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
                            'application/vnd.ms-excel.sheet.macroEnabled.12': ['.xlsm'],
                            'application/vnd.ms-excel': ['.xls'],
                        },
                    },
                ],
            });
            const file = await handle.getFile();
            if (kind === 'purchaseSales') {
                setPurchaseSalesFile(file);
                setFileName(file.name);
                setSheetNames([]);
                setSheetName(inferDaySheet(date));
                setSelectedIds(new Set());
            } else {
                setProductMapFile(file);
                setProductMapFileName(file.name);
            }
            setPreview(null);
            setMessage('');
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return;
            setMessage(error instanceof Error ? error.message : '파일을 선택하지 못했습니다.');
        }
    }

    function loadSheets() {
        setMessage('');
        setPreview(null);
        startTransition(async () => {
            const result = await listPurchaseSalesSheets(buildFormData());
            if (!result.ok) {
                setSheetNames([]);
                setMessage(result.error);
                return;
            }
            const inferred = inferDaySheet(date);
            const nextSheet = result.sheets.includes(inferred) ? inferred : result.sheets[0] ?? '';
            setSheetNames(result.sheets);
            setSheetName(nextSheet);
            setMessage(result.sheets.length > 0 ? `${result.sheets.length}개 시트를 불러왔습니다.` : '시트가 없습니다.');
        });
    }

    async function doPreview() {
        setMessage('');
        setSelectedIds(new Set());
        const result = await previewPurchaseSalesUpload(buildFormData());
        setPreview(result);
        if ('ok' in result && result.ok === false) setMessage(result.error);
        return result;
    }

    function runPreview() {
        startTransition(async () => {
            await doPreview();
        });
    }

    function toggleRow(rowId: string) {
        setSelectedIds((current) => {
            const next = new Set(current);
            if (next.has(rowId)) next.delete(rowId);
            else next.add(rowId);
            return next;
        });
    }

    function toggleAllMissing() {
        setSelectedIds((current) => {
            if (allMissingSelected) {
                const next = new Set(current);
                for (const row of missingRows) next.delete(row.id);
                return next;
            }
            return new Set([...current, ...missingRows.map((row) => row.id)]);
        });
    }

    function runImport(mode: 'all' | 'selected') {
        if (mode === 'selected' && selectedIds.size === 0) {
            setMessage('입력할 항목을 선택해 주세요.');
            return;
        }
        setMessage('');
        startTransition(async () => {
            const result = await importPurchaseSalesUpload(buildFormData(), mode, Array.from(selectedIds));
            if (!result.ok) {
                setMessage(result.error);
                return;
            }
            setMessage(`${result.created}건 입력 완료${result.skipped > 0 ? `, ${result.skipped}건 스킵` : ''}${result.orderNos?.length ? ` / ${result.orderNos.join(', ')}` : ''}`);
            await doPreview();
        });
    }

    return (
        <div className="space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-end gap-3">
                    <label className="grid min-w-[260px] flex-1 gap-1">
                        <span className="text-xs font-bold text-slate-500">매입매출 파일</span>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".xlsx,.xlsm,.xls"
                            onChange={(event) => resetFileState(event.currentTarget.files?.[0]?.name ?? '')}
                            className="h-10 rounded-xl border border-slate-300 px-3 py-1.5 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-700"
                        />
                        <button type="button" onClick={() => selectRememberedFile('purchaseSales')} className="h-8 w-fit rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50">
                            최근 폴더에서 선택
                        </button>
                        {fileName && <span className="text-xs text-slate-400">{fileName}</span>}
                    </label>
                    <label className="grid min-w-[220px] flex-1 gap-1">
                        <span className="text-xs font-bold text-slate-500">품목명 파일</span>
                        <input
                            ref={productMapInputRef}
                            type="file"
                            accept=".xlsx,.xlsm,.xls"
                            onChange={(event) => {
                                const file = event.currentTarget.files?.[0] ?? null;
                                setProductMapFile(file);
                                setProductMapFileName(file?.name ?? '');
                                setPreview(null);
                                setMessage('');
                            }}
                            className="h-10 rounded-xl border border-slate-300 px-3 py-1.5 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-700"
                        />
                        <button type="button" onClick={() => selectRememberedFile('productMap')} className="h-8 w-fit rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50">
                            최근 폴더에서 선택
                        </button>
                        {productMapFileName && <span className="text-xs text-slate-400">{productMapFileName}</span>}
                    </label>
                    <label className="grid gap-1">
                        <span className="text-xs font-bold text-slate-500">날짜</span>
                        <input
                            type="date"
                            value={date}
                            onChange={(event) => {
                                setDate(event.target.value);
                                setSheetName(inferDaySheet(event.target.value));
                                setPreview(null);
                            }}
                            className="h-10 rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                        />
                    </label>
                    {canViewAll && (
                        <label className="grid gap-1">
                            <span className="text-xs font-bold text-slate-500">담당자</span>
                            <select value={repId} onChange={(event) => setRepId(event.target.value)} className="h-10 rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100">
                                <option value="all">전체 담당자</option>
                                {staffUsers.map((user) => (
                                    <option key={user.id} value={user.id}>{user.name}</option>
                                ))}
                            </select>
                        </label>
                    )}
                    <button type="button" onClick={loadSheets} disabled={isPending} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                        {isPending ? <Loader2 className="animate-spin" size={16} /> : <FileSpreadsheet size={16} />} 시트 불러오기
                    </button>
                    <label className="grid gap-1">
                        <span className="text-xs font-bold text-slate-500">시트</span>
                        <select
                            value={sheetName}
                            onChange={(event) => setSheetName(event.target.value)}
                            className="h-10 w-36 rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                        >
                            {sheetNames.length === 0 ? (
                                <option value={sheetName}>{sheetName || '시트 선택'}</option>
                            ) : sheetNames.map((name) => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                        </select>
                    </label>
                    <button type="button" onClick={runPreview} disabled={isPending} className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-50">
                        {isPending ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />} 대조
                    </button>
                </div>
            </section>

            {(message || errorMessage) && (
                <div className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${errorMessage ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                    {errorMessage || message}
                </div>
            )}

            {previewOk && (
                <>
                    {previewOk.warnings.length > 0 && (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                            {previewOk.warnings.join(' / ')}
                        </div>
                    )}

                    <section className="grid gap-3 md:grid-cols-5">
                        <SummaryCard label="대조 대상" value={previewOk.summary.visible} />
                        <SummaryCard label="홈페이지 누락" value={previewOk.summary.missing} tone="orange" />
                        <SummaryCard label="일치" value={previewOk.summary.matched} tone="emerald" />
                        <SummaryCard label="매입처 차이" value={previewOk.summary.supplierMismatch} tone="amber" />
                        <SummaryCard label="매칭 불가" value={previewOk.summary.unresolved} tone="red" />
                    </section>

                    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h2 className="text-base font-black text-slate-900">홈페이지 누락 리스트</h2>
                                <p className="mt-1 text-xs text-slate-500">{previewOk.sourceLabel} / {previewOk.selectedRepId === 'all' ? '전체 담당자' : '담당자 필터 적용'}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={() => runImport('selected')} disabled={isPending || missingRows.length === 0} className="inline-flex h-10 items-center gap-2 rounded-xl border border-orange-200 bg-white px-4 text-sm font-bold text-orange-700 hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-50">
                                    <CheckSquare size={16} /> 선택 입력
                                </button>
                                <button type="button" onClick={() => runImport('all')} disabled={isPending || missingRows.length === 0} className="inline-flex h-10 items-center gap-2 rounded-xl bg-orange-600 px-4 text-sm font-bold text-white hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50">
                                    <ListPlus size={16} /> 전체 입력
                                </button>
                            </div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-left text-sm">
                                <thead className="bg-slate-50 text-xs font-bold text-slate-500">
                                    <tr>
                                        <th className="w-12 px-3 py-2">
                                            <input type="checkbox" checked={allMissingSelected} onChange={toggleAllMissing} className="h-4 w-4 rounded border-slate-300 text-orange-600 focus:ring-orange-500" />
                                        </th>
                                        <th className="px-3 py-2">원본</th>
                                        <th className="px-3 py-2">거래처</th>
                                        <th className="px-3 py-2">도착지</th>
                                        <th className="px-3 py-2">품목</th>
                                        <th className="px-3 py-2 text-right">수량</th>
                                        <th className="px-3 py-2">매입처</th>
                                        <th className="px-3 py-2">메모</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {missingRows.length === 0 ? (
                                        <tr>
                                            <td colSpan={8} className="px-3 py-10 text-center text-slate-400">누락 항목이 없습니다.</td>
                                        </tr>
                                    ) : missingRows.map((row) => (
                                        <tr key={row.id} className="align-top">
                                            <td className="px-3 py-3">
                                                <input type="checkbox" checked={selectedIds.has(row.id)} onChange={() => toggleRow(row.id)} className="h-4 w-4 rounded border-slate-300 text-orange-600 focus:ring-orange-500" />
                                            </td>
                                            <RowCells row={row} />
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>

                    <IssueTable rows={supplierMismatchRows} title="매입처 차이" />
                    <IssueTable rows={unresolvedRows} title="매칭 불가" />
                </>
            )}
        </div>
    );
}
