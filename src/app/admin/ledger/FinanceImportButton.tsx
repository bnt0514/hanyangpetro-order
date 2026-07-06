'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { Download, FileSpreadsheet, Loader2, RefreshCw, X } from 'lucide-react';
import { importFinanceUpload, listFinanceSheets, previewFinanceUpload } from './finance-import-actions';
import type { FinanceImportRow } from '@/lib/finance-import';

type PreviewState = Awaited<ReturnType<typeof previewFinanceUpload>>;

function statusLabel(row: FinanceImportRow) {
    if (row.status === 'READY') return '입력 가능';
    if (row.status === 'DUPLICATE') return '중복 의심';
    if (row.status === 'ALREADY_IMPORTED') return '이미 가져옴';
    return '미매칭';
}

export default function FinanceImportButton({ enabled }: { enabled: boolean }) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [open, setOpen] = useState(false);
    const [sheetSpec, setSheetSpec] = useState('');
    const [sheetNames, setSheetNames] = useState<string[]>([]);
    const [fileName, setFileName] = useState('');
    const [preview, setPreview] = useState<PreviewState | null>(null);
    const [message, setMessage] = useState('');
    const [isPending, startTransition] = useTransition();

    const duplicateRows = useMemo(() => {
        if (!preview?.ok) return [];
        return preview.rows.filter((row) => row.status === 'DUPLICATE');
    }, [preview]);

    if (!enabled) return null;

    function buildFormData() {
        const file = fileInputRef.current?.files?.[0];
        const formData = new FormData();
        if (file) formData.append('financeFile', file);
        formData.append('sheetSpec', sheetSpec);
        return formData;
    }

    function resetFileState(name = '') {
        setFileName(name);
        setSheetNames([]);
        setSheetSpec('');
        setPreview(null);
        setMessage('');
    }

    function loadSheets() {
        setMessage('');
        setPreview(null);
        startTransition(async () => {
            const result = await listFinanceSheets(buildFormData());
            if (!result.ok) {
                setSheetNames([]);
                setSheetSpec('');
                setMessage(result.error);
                return;
            }
            setSheetNames(result.sheets);
            setSheetSpec('');
            setMessage(result.sheets.length > 0 ? `${result.sheets.length}개 시트를 불러왔습니다. 가져올 시트를 선택해 주세요.` : '시트가 없습니다.');
        });
    }

    function runPreview() {
        setMessage('');
        startTransition(async () => {
            const result = await previewFinanceUpload(buildFormData());
            setPreview(result);
            if (!result.ok) setMessage(result.error);
        });
    }

    function runImport(allowDuplicates: boolean) {
        setMessage('');
        startTransition(async () => {
            const result = await importFinanceUpload(buildFormData(), allowDuplicates);
            if (!result.ok) {
                setMessage(result.error);
                return;
            }
            setPreview(result);
            const errorText = 'result' in result && result.result.errors.length > 0
                ? ` / 오류: ${result.result.errors.join(', ')}`
                : '';
            setMessage('result' in result ? `저장 ${result.result.created}건, 건너뜀 ${result.result.skipped}건${errorText}` : '처리되었습니다.');
        });
    }

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700"
            >
                <Download size={14} />
                입출금 업데이트
            </button>
            {open && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
                    <div className="max-h-[88vh] w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl">
                        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                            <div>
                                <h2 className="text-lg font-bold text-slate-900">재무일보 입출금 업데이트</h2>
                                <p className="mt-0.5 text-xs text-slate-500">재무일보 엑셀 파일을 선택한 뒤 가져올 시트를 선택하세요.</p>
                            </div>
                            <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="space-y-4 overflow-y-auto p-5">
                            <div className="flex flex-wrap items-end gap-2">
                                <div className="min-w-[280px] flex-1">
                                    <label className="mb-1 block text-xs font-semibold text-slate-600">재무일보 파일</label>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept=".xlsx,.xlsm,.xls"
                                        onChange={(event) => resetFileState(event.currentTarget.files?.[0]?.name ?? '')}
                                        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-700"
                                    />
                                    {fileName && <p className="mt-1 text-xs text-slate-500">{fileName}</p>}
                                </div>
                                <button
                                    type="button"
                                    onClick={loadSheets}
                                    disabled={isPending}
                                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                >
                                    {isPending ? <Loader2 className="animate-spin" size={15} /> : <FileSpreadsheet size={15} />}
                                    시트 불러오기
                                </button>
                                <div>
                                    <label className="mb-1 block text-xs font-semibold text-slate-600">가져올 시트</label>
                                    <input
                                        list="finance-sheet-list"
                                        value={sheetSpec}
                                        onChange={(event) => setSheetSpec(event.target.value)}
                                        className="w-52 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                                        placeholder="시트를 선택하세요"
                                    />
                                    <datalist id="finance-sheet-list">
                                        {sheetNames.map((name) => <option key={name} value={name} />)}
                                    </datalist>
                                </div>
                                <button
                                    type="button"
                                    onClick={runPreview}
                                    disabled={isPending || !sheetSpec}
                                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                >
                                    {isPending ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}
                                    미리보기
                                </button>
                            </div>

                            {message && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{message}</div>}

                            {preview?.ok && (
                                <>
                                    <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-6">
                                        <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">시트</p><p className="font-bold text-slate-800">{preview.sheetName}</p></div>
                                        <div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs text-emerald-700">입력 가능</p><p className="font-bold text-emerald-800">{preview.summary.ready}</p></div>
                                        <div className="rounded-xl bg-rose-50 p-3"><p className="text-xs text-rose-700">중복 의심</p><p className="font-bold text-rose-800">{preview.summary.duplicates}</p></div>
                                        <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">이미 가져옴</p><p className="font-bold text-slate-800">{preview.summary.alreadyImported}</p></div>
                                        <div className="rounded-xl bg-orange-50 p-3"><p className="text-xs text-orange-700">미매칭</p><p className="font-bold text-orange-800">{preview.summary.unmatched}</p></div>
                                        <div className="rounded-xl bg-blue-50 p-3"><p className="text-xs text-blue-700">전체</p><p className="font-bold text-blue-800">{preview.rows.length}</p></div>
                                    </div>

                                    {duplicateRows.length > 0 && (
                                        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                                            같은 거래처에 같은 날짜/금액의 입출금 내역이 {duplicateRows.length}건 있습니다. 아래에서 확인 후 중복 입력 또는 건너뛰기를 선택하세요.
                                        </div>
                                    )}

                                    <div className="max-h-80 overflow-auto rounded-xl border border-slate-200">
                                        <table className="w-full min-w-[820px] text-sm">
                                            <thead className="sticky top-0 bg-slate-50 text-left text-xs font-semibold text-slate-500">
                                                <tr>
                                                    <th className="px-3 py-2">상태</th>
                                                    <th className="px-3 py-2">구분</th>
                                                    <th className="px-3 py-2">행</th>
                                                    <th className="px-3 py-2">일자</th>
                                                    <th className="px-3 py-2">원본명</th>
                                                    <th className="px-3 py-2">매칭명</th>
                                                    <th className="px-3 py-2 text-right">금액</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {preview.rows.map((row) => (
                                                    <tr key={row.key} className={row.status === 'DUPLICATE' ? 'bg-rose-50/50' : row.status === 'UNMATCHED' ? 'bg-orange-50/50' : ''}>
                                                        <td className="px-3 py-2 text-xs font-semibold">{statusLabel(row)}</td>
                                                        <td className="px-3 py-2">{row.kind === 'IN' ? '입금' : '출금'}</td>
                                                        <td className="px-3 py-2">{row.rowNumber}</td>
                                                        <td className="px-3 py-2">{row.txDate}</td>
                                                        <td className="px-3 py-2">{row.originalName}</td>
                                                        <td className="px-3 py-2">{row.targetName ?? row.convertedName}</td>
                                                        <td className="px-3 py-2 text-right font-semibold">{row.amount.toLocaleString('ko-KR')}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>

                                    <div className="flex flex-wrap justify-end gap-2">
                                        {duplicateRows.length > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => runImport(true)}
                                                disabled={isPending}
                                                className="rounded-xl border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                                            >
                                                중복 포함 입력
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => runImport(false)}
                                            disabled={isPending}
                                            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                                        >
                                            {duplicateRows.length > 0 ? '중복 건너뛰고 입력' : '입력하기'}
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
