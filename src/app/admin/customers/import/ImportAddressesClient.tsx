'use client';

import { useState, useTransition } from 'react';
import { bulkImportDeliveryAddresses, type AddressImportRow } from '../actions';

const SAMPLE = `customerCode\tcompanyName\tlabel\taddressLine1\taddressLine2\tpostalCode\tcontactName\tcontactPhone\tmemo
HY-001\t주식회사 예시\t본사창고\t서울시 강남구 테헤란로 1\t101호\t06100\t홍길동\t010-0000-0000\t납품 전 연락`;

export default function ImportAddressesClient() {
    const [text, setText] = useState(SAMPLE);
    const [pending, startTransition] = useTransition();
    const [result, setResult] = useState<Awaited<ReturnType<typeof bulkImportDeliveryAddresses>> | null>(null);

    function runImport() {
        const rows = parseTable(text);
        startTransition(async () => {
            const next = await bulkImportDeliveryAddresses(rows);
            setResult(next);
        });
    }

    return (
        <div className="space-y-5">
            <div>
                <h1 className="text-2xl font-bold text-slate-800">도착지 자료 가져오기</h1>
                <p className="mt-1 text-sm text-slate-500">
                    엑셀에서 표를 복사해 붙여넣거나 CSV/TSV 내용을 붙여넣으면, 거래처코드 또는 업체명으로 기존 업체와 매칭합니다.
                </p>
            </div>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-xs text-slate-600 leading-6">
                    <p className="font-semibold text-slate-700">지원 컬럼명</p>
                    <p>`customerCode`, `companyName`, `label`, `addressLine1`, `addressLine2`, `postalCode`, `contactName`, `contactPhone`, `memo`</p>
                    <p className="mt-1">같은 도착지명(`label`)이 이미 있으면 주소를 업데이트하고, 없으면 새로 추가합니다.</p>
                </div>
                <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={14}
                    className="w-full rounded-xl border border-slate-300 p-3 font-mono text-xs outline-none focus:border-blue-500"
                />
                <div className="flex justify-end">
                    <button
                        type="button"
                        onClick={runImport}
                        disabled={pending}
                        className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                        {pending ? '가져오는 중...' : '매칭 후 저장'}
                    </button>
                </div>
            </section>

            {result && (
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
                    {!result.ok ? (
                        <p className="text-sm text-red-600">{result.error}</p>
                    ) : (
                        <>
                            <div className="grid grid-cols-3 gap-3 text-center">
                                <Stat label="신규 추가" value={result.created} />
                                <Stat label="기존 업데이트" value={result.updated} />
                                <Stat label="미매칭" value={result.unmatched.length} />
                            </div>
                            {result.unmatched.length > 0 && (
                                <div className="overflow-x-auto">
                                    <p className="mb-2 text-sm font-semibold text-slate-700">수기 확인 필요</p>
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="bg-slate-50 text-left text-slate-500">
                                                <th className="px-3 py-2">사유</th>
                                                <th className="px-3 py-2">거래처코드</th>
                                                <th className="px-3 py-2">업체명</th>
                                                <th className="px-3 py-2">도착지명</th>
                                                <th className="px-3 py-2">주소</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {result.unmatched.map((row, index) => (
                                                <tr key={index}>
                                                    <td className="px-3 py-2 text-red-600">{row.reason}</td>
                                                    <td className="px-3 py-2">{row.customerCode ?? '-'}</td>
                                                    <td className="px-3 py-2">{row.companyName ?? '-'}</td>
                                                    <td className="px-3 py-2">{row.label ?? '-'}</td>
                                                    <td className="px-3 py-2">{row.addressLine1 ?? '-'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </>
                    )}
                </section>
            )}
        </div>
    );
}

function parseTable(value: string): AddressImportRow[] {
    const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    const delimiter = lines[0].includes('\t') ? '\t' : ',';
    const headers = splitLine(lines[0], delimiter).map((header) => header.trim());

    return lines.slice(1).map((line) => {
        const cells = splitLine(line, delimiter);
        return headers.reduce<Record<string, string>>((acc, header, index) => {
            acc[header] = cells[index]?.trim() ?? '';
            return acc;
        }, {}) as AddressImportRow;
    });
}

function splitLine(line: string, delimiter: string) {
    if (delimiter === '\t') return line.split('\t');
    return line.split(',').map((cell) => cell.replace(/^"|"$/g, ''));
}

function Stat({ label, value }: { label: string; value: number }) {
    return (
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-4">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-bold text-slate-800">{value}</p>
        </div>
    );
}