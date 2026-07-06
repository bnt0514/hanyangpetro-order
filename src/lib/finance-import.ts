import 'server-only';

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import * as xlsx from 'xlsx';
import { prisma } from '@/lib/db';

export type FinanceImportKind = 'IN' | 'PAYMENT';

export type FinanceImportRow = {
    key: string;
    kind: FinanceImportKind;
    rowNumber: number;
    originalName: string;
    convertedName: string;
    amount: number;
    txDate: string;
    targetId: string | null;
    targetName: string | null;
    targetType: 'customer' | 'supplier';
    sourceRef: string;
    duplicateCount: number;
    sourceExists: boolean;
    status: 'READY' | 'UNMATCHED' | 'DUPLICATE' | 'ALREADY_IMPORTED';
};

export type FinanceImportPreview = {
    ok: true;
    filePath: string;
    sheetName: string;
    rows: FinanceImportRow[];
    summary: {
        ready: number;
        duplicates: number;
        alreadyImported: number;
        unmatched: number;
        deposits: number;
        withdrawals: number;
    };
} | { ok: false; error: string };

const REFERENCE_FILE = path.join(process.cwd(), 'data', '정리된_거래처목록입출금.xlsx');
const SKIP_KEYWORDS = ['한양유화', '부국'];
const IGNORE_KEYWORDS = ['소계', '합계', '소 계', '합 계', '입금', '출금', '내용', '금액'];

function normalizeText(value: unknown) {
    return String(value ?? '')
        .replace(/㈜/g, '(주)')
        .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\ufeff\s]/g, '')
        .trim()
        .toLowerCase();
}

function normalizeCompanyName(value: unknown) {
    return normalizeText(value)
        .replace(/주식회사/g, '')
        .replace(/\(주\)|\(유\)|\(사\)|\(합\)|\(재\)/g, '')
        .replace(/[()[\]{}<>,.·•_\-/\\]/g, '');
}

function shouldSkip(name: string) {
    const normalized = normalizeText(name);
    return SKIP_KEYWORDS.some((keyword) => normalized.includes(normalizeText(keyword)));
}

function isIgnored(name: string) {
    const compact = normalizeText(name);
    return IGNORE_KEYWORDS.some((keyword) => compact.includes(normalizeText(keyword)));
}

function parseAmount(value: unknown) {
    if (value == null || value === '') return null;
    const parsed = Number.parseInt(String(value).replace(/,/g, '').replace(/\s/g, ''), 10);
    return Number.isFinite(parsed) && parsed !== 0 ? parsed : null;
}

function pad2(value: number | string) {
    return String(value).padStart(2, '0');
}

function dateToIso(date: Date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseExcelDate(value: unknown) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number') {
        const parsed = xlsx.SSF.parse_date_code(value);
        if (!parsed) return null;
        return new Date(parsed.y, parsed.m - 1, parsed.d);
    }
    let text = String(value).trim().replace(/-/g, '.').replace(/\//g, '.');
    if (/^\d{8}$/.test(text)) text = `${text.slice(0, 4)}.${text.slice(4, 6)}.${text.slice(6, 8)}`;
    const matched = text.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
    if (!matched) return null;
    return new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]));
}

function inferYearMonth(sheetSpec: string) {
    const now = new Date();
    const matched = sheetSpec.replace(/-/g, '.').match(/(\d{4})\.(\d{1,2})/);
    return {
        year: matched ? Number(matched[1]) : now.getFullYear(),
        month: matched ? Number(matched[2]) : now.getMonth() + 1,
    };
}

export function buildFinanceFilePath(sheetSpec: string) {
    const { year, month } = inferYearMonth(sheetSpec);
    return `E:\\#재무일보\\재무일보 ${year}\\재무일보${year} ${pad2(month)}월.XLSM`;
}

function buildSheetCandidates(spec: string) {
    const clean = spec.trim().replace(/\s/g, '').replace(/-/g, '.');
    if (clean.includes('~')) {
        const [left, right] = clean.split('~', 2);
        const leftParts = left.split('.').filter(Boolean);
        const rightParts = right.split('.').filter(Boolean);
        const leftDay = leftParts[leftParts.length - 1];
        const rightDay = rightParts[rightParts.length - 1];
        return [`${pad2(leftDay)}~${pad2(rightDay)}`, `${Number(leftDay)}~${Number(rightDay)}`];
    }
    if (clean.includes(',')) {
        const tail = clean.split('.').slice(-1)[0] || clean;
        return [tail, tail.replace(/,/g, ', '), tail.replace(/,/g, ' ,')];
    }
    const tail = clean.split('.').slice(-1)[0] || clean;
    return [pad2(tail), String(Number(tail))];
}

function matchSheetName(workbook: xlsx.WorkBook, sheetSpec: string) {
    const candidates = buildSheetCandidates(sheetSpec);
    if (workbook.SheetNames.includes(sheetSpec)) return sheetSpec;
    for (const candidate of candidates) {
        if (workbook.SheetNames.includes(candidate)) return candidate;
    }
    for (const candidate of candidates) {
        const found = workbook.SheetNames.find((name) => name.includes(candidate));
        if (found) return found;
    }
    throw new Error(`시트 탭을 찾을 수 없습니다. 후보=${candidates.join(', ')}`);
}

function makeSourceRef(filePath: string, sheetName: string, rowNumber: number, kind: FinanceImportKind) {
    return crypto
        .createHash('sha256')
        .update(`${path.basename(filePath)}|${sheetName}|${rowNumber}|${kind}`)
        .digest('hex');
}

function loadNameMap() {
    const map = new Map<string, string>();
    if (!fs.existsSync(REFERENCE_FILE)) return map;

    try {
        const buffer = fs.readFileSync(REFERENCE_FILE);
        const workbook = xlsx.read(buffer, { type: 'buffer', cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
        for (const row of rows.slice(1)) {
            const cols = row.slice(0, 3);
            for (const col of cols) {
                if (!col) continue;
                const key = normalizeText(col);
                const converted = String(row[1] || row[2] || col).trim();
                if (key && converted) map.set(key, converted);
            }
        }
    } catch (error) {
        console.error('거래처 입출금 매핑 파일을 읽지 못했습니다:', REFERENCE_FILE, error);
    }
    return map;
}

function convertCustomerName(name: string, nameMap: Map<string, string>) {
    return nameMap.get(normalizeText(name)) ?? name;
}

function matchByName<T extends { name: string }>(items: T[], rawName: string) {
    const target = normalizeCompanyName(rawName);
    if (!target) return null;
    return items.find((item) => normalizeCompanyName(item.name) === target)
        ?? items.find((item) => {
            const current = normalizeCompanyName(item.name);
            return current.includes(target) || target.includes(current);
        })
        ?? null;
}

async function duplicateCount(kind: FinanceImportKind, targetId: string, date: Date, amount: number) {
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);
    return prisma.creditTransaction.count({
        where: {
            txType: kind,
            amount,
            txDate: { gte: date, lt: nextDate },
            ...(kind === 'IN' ? { customerId: targetId } : { supplierId: targetId }),
        },
    });
}

export async function previewFinanceImport(sheetSpec: string): Promise<FinanceImportPreview> {
    const trimmedSpec = sheetSpec.trim();
    if (!trimmedSpec) return { ok: false, error: '가져올 시트명을 입력해주세요.' };

    const filePath = buildFinanceFilePath(trimmedSpec);
    if (!fs.existsSync(filePath)) return { ok: false, error: `재무일보 파일을 찾을 수 없습니다: ${filePath}` };

    try {
        const workbook = xlsx.readFile(filePath, { cellDates: true });
        const sheetName = matchSheetName(workbook, trimmedSpec);
        const sheet = workbook.Sheets[sheetName];
        const rawRows = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
        const nameMap = loadNameMap();

        const [customers, suppliers] = await Promise.all([
            prisma.customer.findMany({ where: { isActive: true }, select: { id: true, companyName: true } }),
            prisma.supplier.findMany({ where: { isActive: true }, select: { id: true, supplierName: true } }),
        ]);
        const customerItems = customers.map((customer) => ({ id: customer.id, name: customer.companyName }));
        const supplierItems = suppliers.map((supplier) => ({ id: supplier.id, name: supplier.supplierName }));

        const sourceRefs: string[] = [];
        const candidates: Omit<FinanceImportRow, 'duplicateCount' | 'sourceExists' | 'status'>[] = [];

        function addCandidate(kind: FinanceImportKind, rowIndex: number, nameRaw: unknown, amountRaw: unknown, dateRaw: unknown) {
            const originalName = String(nameRaw ?? '').trim();
            if (!originalName || isIgnored(originalName) || shouldSkip(originalName)) return;
            const amount = parseAmount(amountRaw);
            const txDate = parseExcelDate(dateRaw);
            if (!amount || !txDate) return;

            const convertedName = convertCustomerName(originalName, nameMap);
            if (shouldSkip(convertedName)) return;
            const targetType = kind === 'IN' ? 'customer' : 'supplier';
            const matched = kind === 'IN' ? matchByName(customerItems, convertedName) : matchByName(supplierItems, convertedName);
            const sourceRef = makeSourceRef(filePath, sheetName, rowIndex, kind);
            sourceRefs.push(sourceRef);
            candidates.push({
                key: `${kind}:${rowIndex}`,
                kind,
                rowNumber: rowIndex,
                originalName,
                convertedName,
                amount,
                txDate: dateToIso(txDate),
                targetId: matched?.id ?? null,
                targetName: matched?.name ?? null,
                targetType,
                sourceRef,
            });
        }

        for (let index = 17; index < rawRows.length; index += 1) {
            const row = rawRows[index] ?? [];
            addCandidate('IN', index + 1, row[1], row[2], row[5]);
            addCandidate('PAYMENT', index + 1, row[3], row[4], row[6]);
        }

        const existingRefs = new Set((await prisma.creditTransaction.findMany({
            where: { sourceRef: { in: sourceRefs } },
            select: { sourceRef: true },
        })).map((item) => item.sourceRef).filter(Boolean) as string[]);

        const rows: FinanceImportRow[] = [];
        for (const candidate of candidates) {
            const sourceExists = existingRefs.has(candidate.sourceRef);
            const duplicates = candidate.targetId
                ? await duplicateCount(candidate.kind, candidate.targetId, new Date(`${candidate.txDate}T00:00:00`), candidate.amount)
                : 0;
            const status = sourceExists
                ? 'ALREADY_IMPORTED'
                : !candidate.targetId
                    ? 'UNMATCHED'
                    : duplicates > 0
                        ? 'DUPLICATE'
                        : 'READY';
            rows.push({ ...candidate, sourceExists, duplicateCount: duplicates, status });
        }

        return {
            ok: true,
            filePath,
            sheetName,
            rows,
            summary: {
                ready: rows.filter((row) => row.status === 'READY').length,
                duplicates: rows.filter((row) => row.status === 'DUPLICATE').length,
                alreadyImported: rows.filter((row) => row.status === 'ALREADY_IMPORTED').length,
                unmatched: rows.filter((row) => row.status === 'UNMATCHED').length,
                deposits: rows.filter((row) => row.kind === 'IN').length,
                withdrawals: rows.filter((row) => row.kind === 'PAYMENT').length,
            },
        };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : '재무일보를 읽는 중 오류가 발생했습니다.' };
    }
}

export function listFinanceWorkbookSheets(fileName: string, buffer: Buffer) {
    try {
        const workbook = xlsx.read(buffer, { type: 'buffer', cellDates: true });
        return {
            ok: true as const,
            fileName,
            sheets: workbook.SheetNames,
        };
    } catch (error) {
        return {
            ok: false as const,
            error: error instanceof Error ? error.message : '엑셀 파일을 읽는 중 오류가 발생했습니다.',
        };
    }
}

export async function previewFinanceImportFromBuffer(
    fileName: string,
    buffer: Buffer,
    sheetSpec: string,
): Promise<FinanceImportPreview> {
    const trimmedSpec = sheetSpec.trim();
    if (!trimmedSpec) return { ok: false, error: '가져올 시트를 선택해주세요.' };

    try {
        const workbook = xlsx.read(buffer, { type: 'buffer', cellDates: true });
        const sheetName = matchSheetName(workbook, trimmedSpec);
        return previewFinanceWorkbook(workbook, fileName, sheetName);
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : '재무일보를 읽는 중 오류가 발생했습니다.' };
    }
}

async function previewFinanceWorkbook(
    workbook: xlsx.WorkBook,
    filePath: string,
    sheetName: string,
): Promise<FinanceImportPreview> {
    try {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) return { ok: false, error: `시트 탭을 찾을 수 없습니다: ${sheetName}` };
        const rawRows = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
        const nameMap = loadNameMap();

        const [customers, suppliers] = await Promise.all([
            prisma.customer.findMany({ where: { isActive: true }, select: { id: true, companyName: true } }),
            prisma.supplier.findMany({ where: { isActive: true }, select: { id: true, supplierName: true } }),
        ]);
        const customerItems = customers.map((customer) => ({ id: customer.id, name: customer.companyName }));
        const supplierItems = suppliers.map((supplier) => ({ id: supplier.id, name: supplier.supplierName }));

        const sourceRefs: string[] = [];
        const candidates: Omit<FinanceImportRow, 'duplicateCount' | 'sourceExists' | 'status'>[] = [];

        function addCandidate(kind: FinanceImportKind, rowIndex: number, nameRaw: unknown, amountRaw: unknown, dateRaw: unknown) {
            const originalName = String(nameRaw ?? '').trim();
            if (!originalName || isIgnored(originalName) || shouldSkip(originalName)) return;
            const amount = parseAmount(amountRaw);
            const txDate = parseExcelDate(dateRaw);
            if (!amount || !txDate) return;

            const convertedName = convertCustomerName(originalName, nameMap);
            if (shouldSkip(convertedName)) return;
            const targetType = kind === 'IN' ? 'customer' : 'supplier';
            const matched = kind === 'IN' ? matchByName(customerItems, convertedName) : matchByName(supplierItems, convertedName);
            const sourceRef = makeSourceRef(filePath, sheetName, rowIndex, kind);
            sourceRefs.push(sourceRef);
            candidates.push({
                key: `${kind}:${rowIndex}`,
                kind,
                rowNumber: rowIndex,
                originalName,
                convertedName,
                amount,
                txDate: dateToIso(txDate),
                targetId: matched?.id ?? null,
                targetName: matched?.name ?? null,
                targetType,
                sourceRef,
            });
        }

        for (let index = 17; index < rawRows.length; index += 1) {
            const row = rawRows[index] ?? [];
            addCandidate('IN', index + 1, row[1], row[2], row[5]);
            addCandidate('PAYMENT', index + 1, row[3], row[4], row[6]);
        }

        const existingRefs = new Set((await prisma.creditTransaction.findMany({
            where: { sourceRef: { in: sourceRefs } },
            select: { sourceRef: true },
        })).map((item) => item.sourceRef).filter(Boolean) as string[]);

        const rows: FinanceImportRow[] = [];
        for (const candidate of candidates) {
            const sourceExists = existingRefs.has(candidate.sourceRef);
            const duplicates = candidate.targetId
                ? await duplicateCount(candidate.kind, candidate.targetId, new Date(`${candidate.txDate}T00:00:00`), candidate.amount)
                : 0;
            const status = sourceExists
                ? 'ALREADY_IMPORTED'
                : !candidate.targetId
                    ? 'UNMATCHED'
                    : duplicates > 0
                        ? 'DUPLICATE'
                        : 'READY';
            rows.push({ ...candidate, sourceExists, duplicateCount: duplicates, status });
        }

        return {
            ok: true,
            filePath,
            sheetName,
            rows,
            summary: {
                ready: rows.filter((row) => row.status === 'READY').length,
                duplicates: rows.filter((row) => row.status === 'DUPLICATE').length,
                alreadyImported: rows.filter((row) => row.status === 'ALREADY_IMPORTED').length,
                unmatched: rows.filter((row) => row.status === 'UNMATCHED').length,
                deposits: rows.filter((row) => row.kind === 'IN').length,
                withdrawals: rows.filter((row) => row.kind === 'PAYMENT').length,
            },
        };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : '재무일보를 읽는 중 오류가 발생했습니다.' };
    }
}

export async function applyFinanceImport(sheetSpec: string, options: { allowDuplicates: boolean }) {
    const preview = await previewFinanceImport(sheetSpec);
    if (!preview.ok) return preview;

    let created = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const row of preview.rows) {
        if (!row.targetId) {
            skipped += 1;
            continue;
        }
        if (row.sourceExists) {
            skipped += 1;
            continue;
        }
        if (row.duplicateCount > 0 && !options.allowDuplicates) {
            skipped += 1;
            continue;
        }

        try {
            await prisma.creditTransaction.create({
                data: {
                    customerId: row.kind === 'IN' ? row.targetId : null,
                    supplierId: row.kind === 'PAYMENT' ? row.targetId : null,
                    txDate: new Date(`${row.txDate}T00:00:00`),
                    txType: row.kind,
                    amount: row.amount,
                    source: 'FINANCE_IMPORT',
                    sourceRef: row.sourceRef,
                    memo: `재무일보 ${row.kind === 'IN' ? '입금' : '출금'} (${path.basename(preview.filePath)} / ${preview.sheetName} / ${row.rowNumber}행 / 원본: ${row.originalName})`,
                },
            });
            created += 1;
        } catch (error) {
            errors.push(`${row.rowNumber}행 ${row.convertedName}: ${error instanceof Error ? error.message : '저장 실패'}`);
            break;
        }
    }

    return {
        ok: true as const,
        filePath: preview.filePath,
        sheetName: preview.sheetName,
        rows: preview.rows,
        summary: preview.summary,
        result: { created, skipped, errors },
    };
}

export async function applyFinanceImportFromBuffer(
    fileName: string,
    buffer: Buffer,
    sheetSpec: string,
    options: { allowDuplicates: boolean },
) {
    const preview = await previewFinanceImportFromBuffer(fileName, buffer, sheetSpec);
    if (!preview.ok) return preview;

    let created = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const row of preview.rows) {
        if (!row.targetId || row.sourceExists || (row.duplicateCount > 0 && !options.allowDuplicates)) {
            skipped += 1;
            continue;
        }

        try {
            await prisma.creditTransaction.create({
                data: {
                    customerId: row.kind === 'IN' ? row.targetId : null,
                    supplierId: row.kind === 'PAYMENT' ? row.targetId : null,
                    txDate: new Date(`${row.txDate}T00:00:00`),
                    txType: row.kind,
                    amount: row.amount,
                    source: 'FINANCE_IMPORT',
                    sourceRef: row.sourceRef,
                    memo: `재무일보 ${row.kind === 'IN' ? '입금' : '출금'} (${path.basename(preview.filePath)} / ${preview.sheetName} / ${row.rowNumber}행 / 원본: ${row.originalName})`,
                },
            });
            created += 1;
        } catch (error) {
            errors.push(`${row.rowNumber}행 ${row.convertedName}: ${error instanceof Error ? error.message : '저장 실패'}`);
            break;
        }
    }

    return {
        ok: true as const,
        filePath: preview.filePath,
        sheetName: preview.sheetName,
        rows: preview.rows,
        summary: preview.summary,
        result: { created, skipped, errors },
    };
}
