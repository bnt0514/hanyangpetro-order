import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import { prisma } from '@/lib/db';
import { isBusinessDate, previousBusinessDate } from '@/lib/korean-holidays';

const DEFAULT_SPREADSHEET_ID = process.env.ORDER_SPREADSHEET_ID || '13NGMp-iNJpRdeR0JlnwS367Xj8VZ5UYlfKc774g3j2w';
const HANWHA_SUPPLIER_NAME = '한화솔루션';
const CANCELLED_STATUSES = new Set(['CANCELLED', 'REJECTED']);
const QUANTITY_EPSILON = 0.0001;

type OrderBlock = {
    block: string;
    date: number;
    customer: number | null;
    fixedCustomer?: string;
    product: number;
    quantity: number;
    supplier: number | null;
    remark: number | null;
    baseRemark?: string;
    skipSuppliers?: readonly string[];
};

const ORDER_BLOCKS: readonly OrderBlock[] = [
    { block: 'A-H', date: 0, customer: 1, product: 2, quantity: 3, supplier: 4, remark: 7 },
    { block: 'I-P', date: 8, customer: 9, product: 10, quantity: 11, supplier: 12, remark: 15 },
    { block: 'Q-X', date: 16, customer: 17, product: 18, quantity: 19, supplier: 20, remark: 23 },
    { block: 'Y-AB', date: 24, customer: 25, product: 26, quantity: 27, supplier: null, remark: null, baseRemark: '영업팀' },
    { block: 'AE-AH', date: 30, customer: null, fixedCustomer: '영업팀', product: 32, quantity: 33, supplier: 31, remark: null, skipSuppliers: ['사수', '인수'] },
] as const;

const REMARK_OUT_COL = 29;
const REMARK_IN_COL = 35;

export type StaffActor = {
    id: string;
    name?: string | null;
    role?: string | null;
    userKind?: string | null;
};

export type ReconcileMatchStatus = 'MATCHED' | 'MISSING' | 'UNRESOLVED' | 'SUPPLIER_MISMATCH';

export type OrderSheetReconcileRow = {
    id: string;
    sourceRowNumber: number;
    sourceBlock: string;
    date: string;
    purchaseDate: string;
    deliveryDate: string;
    salesDate: string;
    rawCustomer: string;
    convertedCustomer: string;
    dbCustomerName: string;
    customerId: string;
    customerRepId: string | null;
    customerRepName: string;
    deliveryAddressId: string;
    deliveryAddressLabel: string;
    rawProduct: string;
    convertedProduct: string;
    dbProductName: string;
    dbProductCode: string;
    productId: string;
    quantity: number | null;
    rawSupplier: string;
    convertedSupplier: string;
    supplierName: string;
    supplierDefaulted: boolean;
    dbSupplierName: string;
    supplierId: string;
    remark: string;
    problems: string[];
    matchStatus: ReconcileMatchStatus;
    matchedOrderNo: string;
    matchedOrderItemId: string;
    matchNote: string;
    createStatus?: string;
    createdOrderNo?: string;
};

export type OrderSheetPreview = {
    date: string;
    sheetName: string;
    sourceLabel: string;
    generatedAt: string;
    canViewAll: boolean;
    selectedRepId: string;
    rows: OrderSheetReconcileRow[];
    visibleRows: OrderSheetReconcileRow[];
    hiddenRowCount: number;
    extraDbItems: ExistingOrderItem[];
    summary: {
        extracted: number;
        visible: number;
        matched: number;
        missing: number;
        unresolved: number;
        supplierMismatch: number;
        dbOnly: number;
    };
    warnings: string[];
};

type SourceEntry = {
    id: string;
    sourceRowNumber: number;
    sourceBlock: string;
    date: string;
    purchaseDate: string;
    deliveryDate: string;
    salesDate: string;
    rawCustomer: string;
    convertedCustomer: string;
    rawProduct: string;
    convertedProduct: string;
    quantity: number | null;
    rawSupplier: string;
    convertedSupplier: string;
    supplierName: string;
    supplierDefaulted: boolean;
    remark: string;
};

type DbContext = Awaited<ReturnType<typeof buildDbContext>>;

type ExistingOrderItem = {
    orderId: string;
    orderNo: string;
    orderStatus: string;
    customerId: string;
    customerName: string;
    customerRepId: string | null;
    customerRepName: string;
    deliveryAddressLabel: string;
    deliveryDate: string;
    salesDate: string;
    purchaseDate: string;
    itemId: string;
    productId: string;
    productName: string;
    productCode: string;
    productKey: string;
    quantity: number;
    supplierId: string;
    supplierName: string;
    fulfillmentType: string;
    ignored: boolean;
    used: boolean;
};

function normalizeText(value: unknown) {
    return String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function compactText(value: unknown) {
    return normalizeText(value).replace(/\s+/g, '');
}

function normalizeCompanyKey(value: unknown) {
    return compactText(value)
        .replace(/주식회사|유한회사|\(주\)|㈜|주\)/g, '')
        .replace(/[()（）[\]{}.,·ㆍ\-_\/\\]/g, '')
        .toLowerCase();
}

function normalizeProductKey(value: unknown) {
    return compactText(value)
        .replace(/^\s*(ITEM|IMP)[-_\s]+/i, '')
        .replace(/P\.P/gi, 'PP')
        .replace(/[<>()（）[\]{}.,·ㆍ\-_\/\\]/g, '')
        .toUpperCase();
}

function normalizeStaffName(value: unknown) {
    return compactText(value);
}

export function isYangHeeCheol(user?: { name?: string | null }) {
    return normalizeStaffName(user?.name) === '양희철';
}

function dateOnly(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dateIso(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDateValue(value: unknown, baseDate: Date): Date | null {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return dateOnly(value);

    if (typeof value === 'number' && Number.isFinite(value) && value > 10000 && value < 60000) {
        const excelOrigin = new Date(1899, 11, 30);
        excelOrigin.setDate(excelOrigin.getDate() + Math.floor(value));
        return dateOnly(excelOrigin);
    }

    const text = compactText(value);
    if (!text) return null;

    const numeric = Number(text);
    if (Number.isFinite(numeric) && numeric > 10000 && numeric < 60000) return parseDateValue(numeric, baseDate);

    let match = text.match(/^(20\d{2})[./-]?(\d{1,2})[./-]?(\d{1,2})\.?$/);
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));

    match = text.match(/^(\d{2})[./-](\d{1,2})[./-](\d{1,2})\.?$/);
    if (match) return new Date(2000 + Number(match[1]), Number(match[2]) - 1, Number(match[3]));

    match = text.match(/^(\d{1,2})[./-](\d{1,2})\.?$/) || text.match(/^(\d{1,2})월(\d{1,2})일?$/);
    if (match) return new Date(baseDate.getFullYear(), Number(match[1]) - 1, Number(match[2]));

    return null;
}

export function parseTargetDate(value: string) {
    const parsed = parseDateValue(value, new Date());
    if (!parsed) throw new Error(`날짜 형식을 알 수 없습니다: ${value}`);
    return parsed;
}

export function todayIso() {
    return dateIso(new Date());
}

function inferSheetName(targetDate: Date) {
    return `${String(targetDate.getFullYear()).slice(2)}.${String(targetDate.getMonth() + 1).padStart(2, '0')}월`;
}

function parseQuantity(value: unknown) {
    const text = normalizeText(value).replace(/,/g, '');
    if (!text || text === '-' || text.toLowerCase() === 'nan') return null;
    const number = Number(text);
    if (!Number.isFinite(number)) return null;
    return Number.isInteger(number) ? number : Number(number.toFixed(3));
}

function safeCell(row: unknown[], index: number | null) {
    if (index == null || index < 0) return '';
    const text = normalizeText(row[index]);
    if (!text || text === 'None' || text.toLowerCase() === 'nan') return '';
    return text;
}

function buildMergedRemark(baseRemark: string, row: unknown[]) {
    const base = normalizeText(baseRemark);
    const extras = [safeCell(row, REMARK_OUT_COL), safeCell(row, REMARK_IN_COL)].filter(Boolean).join(' ');
    if (!extras) return base;
    if (!base) return extras;
    if (extras.includes(base)) return extras;
    return `${base} ${extras}`.trim();
}

function nextMonthFirst(date: Date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

function nextBusinessDate(date: Date) {
    const cursor = dateOnly(date);
    cursor.setDate(cursor.getDate() + 1);
    for (let i = 0; i < 14; i += 1) {
        if (isBusinessDate(dateIso(cursor))) return new Date(cursor);
        cursor.setDate(cursor.getDate() + 1);
    }
    return new Date(cursor);
}

function nextWeekdayAfter(date: Date, weekday: number) {
    const cursor = dateOnly(date);
    const diff = (weekday - cursor.getDay() + 7) % 7 || 7;
    cursor.setDate(cursor.getDate() + diff);
    return cursor;
}

function dateWithDayNear(baseDate: Date, day: number) {
    const candidate = new Date(baseDate.getFullYear(), baseDate.getMonth(), day);
    if (candidate < dateOnly(baseDate)) return new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, day);
    return candidate;
}

function parsePurchaseSalesRemarkDates(purchaseDate: Date, remark: string) {
    const normalized = normalizeText(remark);
    const compact = compactText(remark);
    let deliveryDate = dateOnly(purchaseDate);
    let purchaseDateFromArrival = false;

    const explicitDayMatch = compact.match(/(\d{1,2})(?:\uC77C\uB3C4\uCC29|\uC77C\uCC29|\uC77C\uC785\uACE0|\uC77C)$/u);
    if (explicitDayMatch) {
        deliveryDate = dateWithDayNear(purchaseDate, Number(explicitDayMatch[1]));
        purchaseDateFromArrival = true;
    } else if (compact.includes('\uB2F9\uC77C')) {
        deliveryDate = dateOnly(purchaseDate);
    } else {
        const weekdayMap: Record<string, number> = { '\uC77C': 0, '\uC6D4': 1, '\uD654': 2, '\uC218': 3, '\uBAA9': 4, '\uAE08': 5, '\uD1A0': 6 };
        const weekdayMatch = compact.match(/([\uC77C\uC6D4\uD654\uC218\uBAA9\uAE08\uD1A0])\uCC29/u);
        if (weekdayMatch) {
            deliveryDate = nextWeekdayAfter(purchaseDate, weekdayMap[weekdayMatch[1]]);
            purchaseDateFromArrival = true;
        } else {
            deliveryDate = nextBusinessDate(purchaseDate);
        }
    }

    const arrivalPurchaseDate = purchaseDateFromArrival ? previousBusinessDate(deliveryDate) ?? dateOnly(purchaseDate) : dateOnly(purchaseDate);
    const purchaseLedgerDate = compact.includes('\uB9E4\uC785\uC774\uC6D4') ? nextMonthFirst(purchaseDate) : arrivalPurchaseDate;
    const salesLedgerDate = compact.includes('\uB9E4\uCD9C\uC774\uC6D4') ? nextMonthFirst(purchaseDate) : dateOnly(deliveryDate);
    return {
        purchaseDate: purchaseLedgerDate,
        deliveryDate,
        salesDate: salesLedgerDate,
        note: normalized,
    };
}

function defaultExistingPath(...parts: string[]) {
    const target = path.join(...parts);
    return fs.existsSync(target) ? target : null;
}

function firstExistingPath(paths: Array<string | null | undefined>) {
    return paths.find((candidate): candidate is string => Boolean(candidate && fs.existsSync(candidate))) ?? null;
}

function readWorkbookRows(filePath: string) {
    const workbook = XLSX.readFile(filePath, { cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];
    return XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false });
}

function readWorkbookBuffer(fileName: string, buffer: Buffer) {
    try {
        return XLSX.read(buffer, { type: 'buffer', cellDates: true });
    } catch (error) {
        throw new Error(error instanceof Error ? error.message : `${fileName} 파일을 읽지 못했습니다.`);
    }
}

function matchWorkbookSheetName(workbook: XLSX.WorkBook, requestedSheetName: string, targetDate: Date) {
    const trimmed = requestedSheetName.trim();
    const inferred = inferSheetName(targetDate);
    if (trimmed && workbook.SheetNames.includes(trimmed)) return trimmed;
    if (workbook.SheetNames.includes(inferred)) return inferred;
    if (trimmed) {
        const found = workbook.SheetNames.find((name) => name.includes(trimmed) || trimmed.includes(name));
        if (found) return found;
        throw new Error(`시트 탭을 찾지 못했습니다: ${trimmed}`);
    }
    const firstSheet = workbook.SheetNames[0];
    if (!firstSheet) throw new Error('엑셀 파일에 시트가 없습니다.');
    return firstSheet;
}

function readWorkbookSheetRows(workbook: XLSX.WorkBook, sheetName: string) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error(`시트 탭을 찾지 못했습니다: ${sheetName}`);
    return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false });
}

function loadCustomerNameMap(filePath: string | null) {
    const map = new Map<string, string>();
    if (!filePath || !fs.existsSync(filePath)) return map;

    const rows = readWorkbookRows(filePath);
    for (const row of rows.slice(1)) {
        const original = normalizeText(row[0]);
        const matched = normalizeText(row[1]);
        const actual = normalizeText(row[2]);
        const official = matched || actual || original;
        if (!official) continue;
        for (const alias of [original, matched, actual, official]) {
            const key = normalizeCompanyKey(alias);
            if (key) map.set(key, official);
        }
    }
    return map;
}

function loadProductNameMap(filePath: string | null) {
    const map = new Map<string, string>([
        [normalizeProductKey('5316OG'), 'LDPE<5316 OG>'],
        [normalizeProductKey('B310'), 'P.P<B310>'],
        [normalizeProductKey('LLDPE<M1605EN>'), 'mLLDPE<M1605EN>'],
        [normalizeProductKey('M1605EN'), 'mLLDPE<M1605EN>'],
        [normalizeProductKey('LDPE<R5301>'), 'PCR LDPE<R5301>'],
        [normalizeProductKey('R5301'), 'PCR LDPE<R5301>'],
    ]);
    if (!filePath || !fs.existsSync(filePath)) return map;

    const rows = readWorkbookRows(filePath);
    addProductNameMapRows(map, rows);
    applyBuiltInProductAliases(map);
    return map;
}

function loadProductNameMapFromBuffer(fileName: string, buffer: Buffer | null) {
    const map = new Map<string, string>([
        [normalizeProductKey('5316OG'), 'LDPE<5316 OG>'],
        [normalizeProductKey('B310'), 'P.P<B310>'],
        [normalizeProductKey('LLDPE<M1605EN>'), 'mLLDPE<M1605EN>'],
        [normalizeProductKey('M1605EN'), 'mLLDPE<M1605EN>'],
        [normalizeProductKey('LDPE<R5301>'), 'PCR LDPE<R5301>'],
        [normalizeProductKey('R5301'), 'PCR LDPE<R5301>'],
    ]);
    if (!buffer || buffer.length === 0) return map;

    const workbook = readWorkbookBuffer(fileName, buffer);
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return map;
    const rows = readWorkbookSheetRows(workbook, sheetName);
    addProductNameMapRows(map, rows);
    applyBuiltInProductAliases(map);
    return map;
}

function addProductNameMapRows(map: Map<string, string>, rows: unknown[][]) {
    for (const row of rows.slice(1)) {
        const original = normalizeText(row[0]);
        const converted = normalizeText(row[1]);
        if (!original || !converted) continue;
        map.set(normalizeProductKey(original), converted);
        map.set(normalizeProductKey(converted), converted);
    }
}

function applyBuiltInProductAliases(map: Map<string, string>) {
    for (const alias of ['LDPE<R5301>', 'PCR LDPE<R5301>', 'R5301', 'LDPE R5301']) {
        map.set(normalizeProductKey(alias), 'PCR LDPE<R5301>');
    }
}

function convertCompanyName(value: string, customerNameMap: Map<string, string>) {
    const text = normalizeText(value);
    return customerNameMap.get(normalizeCompanyKey(text)) || text;
}

function convertProductName(value: string, productNameMap: Map<string, string>) {
    const text = normalizeText(value);
    return productNameMap.get(normalizeProductKey(text)) || text;
}

function convertPurchaseSalesCustomerName(value: string, supplierName: string) {
    const key = normalizeCompanyKey(value);
    if (key === normalizeCompanyKey('부국')) return '부국티엔씨(주)';
    if (key === normalizeCompanyKey('영업소')) {
        if (normalizeCompanyKey(supplierName).includes(normalizeCompanyKey('비엔티'))) return '비엔티';
        return '(주)한양유화';
    }
    return normalizeText(value);
}

function base64Url(input: string) {
    return Buffer.from(input).toString('base64url');
}

async function fetchGoogleAccessToken(credentialsPath: string) {
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8')) as { client_email?: string; private_key?: string };
    if (!credentials.client_email || !credentials.private_key) {
        throw new Error(`서비스 계정 JSON 형식이 올바르지 않습니다: ${credentialsPath}`);
    }

    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claim = {
        iss: credentials.client_email,
        scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
    };
    const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
    const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(credentials.private_key, 'base64url');
    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: `${unsigned}.${signature}`,
        }),
    });
    const payload = await response.json() as { access_token?: string; error?: string; error_description?: string };
    if (!response.ok || !payload.access_token) {
        throw new Error(`Google token 요청 실패: ${payload.error_description || payload.error || response.statusText}`);
    }
    return payload.access_token;
}

async function readGoogleSheetRows(spreadsheetId: string, sheetName: string, credentialsPath: string) {
    if (!credentialsPath || !fs.existsSync(credentialsPath)) {
        throw new Error(`Google 서비스 계정 JSON을 찾지 못했습니다: ${credentialsPath || '(empty)'}`);
    }
    const token = await fetchGoogleAccessToken(credentialsPath);
    const quotedSheetName = `'${sheetName.replace(/'/g, "''")}'`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(quotedSheetName)}?majorDimension=ROWS`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const payload = await response.json() as { values?: unknown[][]; error?: { message?: string } };
    if (!response.ok) throw new Error(`Google Sheets 읽기 실패: ${payload.error?.message || response.statusText}`);
    return payload.values || [];
}

function extractOrderRows(rows: unknown[][], targetDate: Date, customerNameMap: Map<string, string>, productNameMap: Map<string, string>) {
    const entries: SourceEntry[] = [];
    const targetIso = dateIso(targetDate);

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex];
        for (const block of ORDER_BLOCKS) {
            const parsedDate = parseDateValue(row[block.date], targetDate);
            if (!parsedDate || dateIso(parsedDate) !== targetIso) continue;

            const rawSupplier = block.supplier == null ? '' : safeCell(row, block.supplier);
            if (block.skipSuppliers?.some((skip) => normalizeCompanyKey(skip) === normalizeCompanyKey(rawSupplier))) continue;

            const rawCustomer = block.fixedCustomer || safeCell(row, block.customer);
            const rawProduct = safeCell(row, block.product);
            const quantity = parseQuantity(row[block.quantity]);
            const rawRemark = block.remark == null ? block.baseRemark || '' : safeCell(row, block.remark);
            const supplierName = rawSupplier || HANWHA_SUPPLIER_NAME;

            if (!rawCustomer && !rawProduct && quantity == null) continue;

            const convertedSupplier = convertCompanyName(supplierName, customerNameMap);
            const sourceRowNumber = rowIndex + 1;
            entries.push({
                id: `${targetIso}:${sourceRowNumber}:${block.block}`,
                sourceRowNumber,
                sourceBlock: block.block,
                date: targetIso,
                purchaseDate: targetIso,
                deliveryDate: targetIso,
                salesDate: targetIso,
                rawCustomer,
                convertedCustomer: convertCompanyName(rawCustomer, customerNameMap),
                rawProduct,
                convertedProduct: convertProductName(rawProduct, productNameMap),
                quantity,
                rawSupplier,
                convertedSupplier,
                supplierName,
                supplierDefaulted: !rawSupplier,
                remark: buildMergedRemark(rawRemark, row),
            });
        }
    }
    return entries;
}

function extractPurchaseSalesRows(rows: unknown[][], targetDate: Date, productNameMap: Map<string, string>) {
    const entries: SourceEntry[] = [];
    const targetIso = dateIso(targetDate);

    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex];
        const dateCell = safeCell(row, 0);
        const parsedDate = parseDateValue(dateCell, targetDate);
        if (parsedDate && dateIso(parsedDate) !== targetIso) continue;
        const purchaseBaseDate = parsedDate || targetDate;

        const rawCustomer = safeCell(row, 1);
        const rawProduct = safeCell(row, 2);
        const quantity = parseQuantity(row[3]);
        const rawSupplier = safeCell(row, 4);
        const rawRemark = safeCell(row, 5);

        if (!rawCustomer && !rawProduct && quantity == null) continue;
        if (!rawCustomer || !rawProduct) continue;

        const supplierName = rawSupplier || HANWHA_SUPPLIER_NAME;
        const sourceRowNumber = rowIndex + 1;
        const ledgerDates = parsePurchaseSalesRemarkDates(purchaseBaseDate, rawRemark);
        const convertedCustomer = convertPurchaseSalesCustomerName(rawCustomer, supplierName);
        entries.push({
            id: `${targetIso}:${sourceRowNumber}:purchase-sales`,
            sourceRowNumber,
            sourceBlock: '매입매출',
            date: targetIso,
            purchaseDate: dateIso(ledgerDates.purchaseDate),
            deliveryDate: dateIso(ledgerDates.deliveryDate),
            salesDate: dateIso(ledgerDates.salesDate),
            rawCustomer,
            convertedCustomer,
            rawProduct,
            convertedProduct: convertProductName(rawProduct, productNameMap),
            quantity,
            rawSupplier,
            convertedSupplier: supplierName,
            supplierName,
            supplierDefaulted: !rawSupplier,
            remark: rawRemark,
        });
    }
    return entries;
}

function findByNormalized<T>(map: Map<string, T>, value: string) {
    return map.get(normalizeCompanyKey(value));
}

function findProductByKey<T>(map: Map<string, T>, value: string) {
    return map.get(normalizeProductKey(value));
}

function findSupplierByName(context: DbContext, value: string) {
    const exact = findByNormalized(context.suppliersByKey, value);
    if (exact) return exact;

    const key = normalizeCompanyKey(value);
    if (key.length < 2) return null;

    const candidates = context.suppliers.filter((supplier) => {
        const supplierKey = normalizeCompanyKey(supplier.supplierName);
        return supplierKey.includes(key) || key.includes(supplierKey);
    });
    return candidates.length === 1 ? candidates[0] : null;
}

async function buildDbContext() {
    const [customers, addresses, products, suppliers, companies] = await Promise.all([
        prisma.customer.findMany({
            where: { isActive: true },
            select: {
                id: true,
                companyName: true,
                customerCode: true,
                defaultSalesRepId: true,
                defaultSalesRep: { select: { name: true } },
            },
        }),
        prisma.deliveryAddress.findMany({
            where: { isActive: true, customer: { isActive: true } },
            select: { id: true, customerId: true, label: true, addressLine1: true, isDefault: true },
            orderBy: [{ isDefault: 'desc' }, { label: 'asc' }],
        }),
        prisma.product.findMany({
            where: { isActive: true },
            select: {
                id: true,
                productCode: true,
                productName: true,
                defaultSalesEntityId: true,
                defaultPurchaseEntityId: true,
            },
        }),
        prisma.supplier.findMany({ where: { isActive: true }, select: { id: true, supplierName: true } }),
        prisma.companyEntity.findMany({
            where: { isActive: true },
            select: { id: true, code: true, displayName: true, legalName: true, isDefaultSales: true, isDefaultPurchase: true },
        }),
    ]);

    const customersByKey = new Map<string, (typeof customers)[number]>();
    for (const customer of customers) {
        customersByKey.set(normalizeCompanyKey(customer.companyName), customer);
        customersByKey.set(normalizeCompanyKey(customer.customerCode), customer);
    }

    const addressesByCustomer = new Map<string, typeof addresses>();
    const addressesByGlobalKey = new Map<string, (typeof addresses)[number]>();
    for (const address of addresses) {
        if (!addressesByCustomer.has(address.customerId)) addressesByCustomer.set(address.customerId, []);
        addressesByCustomer.get(address.customerId)!.push(address);
        for (const alias of [address.label, address.addressLine1]) {
            const key = normalizeCompanyKey(alias);
            if (key) addressesByGlobalKey.set(key, address);
        }
    }

    const productsByKey = new Map<string, (typeof products)[number]>();
    for (const product of products) {
        productsByKey.set(normalizeProductKey(product.productName), product);
        productsByKey.set(normalizeProductKey(product.productCode), product);
    }

    const suppliersByKey = new Map<string, (typeof suppliers)[number]>();
    for (const supplier of suppliers) suppliersByKey.set(normalizeCompanyKey(supplier.supplierName), supplier);

    const hanwhaSupplier = suppliers.find((supplier) => normalizeCompanyKey(supplier.supplierName).includes(normalizeCompanyKey(HANWHA_SUPPLIER_NAME))) ?? null;
    if (hanwhaSupplier) {
        suppliersByKey.set(normalizeCompanyKey('한화'), hanwhaSupplier);
        suppliersByKey.set(normalizeCompanyKey(HANWHA_SUPPLIER_NAME), hanwhaSupplier);
    }

    const hanyangEntity = companies.find((company) =>
        company.code === 'HANYANG_PETRO'
        || normalizeCompanyKey(company.displayName) === normalizeCompanyKey('한양유화')
        || normalizeCompanyKey(company.legalName) === normalizeCompanyKey('한양유화')
    );
    const defaultSalesEntity = hanyangEntity || companies.find((company) => company.isDefaultSales) || companies[0] || null;
    const defaultPurchaseEntity = hanyangEntity || companies.find((company) => company.isDefaultPurchase) || defaultSalesEntity;

    return {
        customers,
        customersByKey,
        addressesByCustomer,
        addressesByGlobalKey,
        products,
        productsByKey,
        suppliers,
        suppliersByKey,
        hanwhaSupplier,
        defaultSalesEntity,
        defaultPurchaseEntity,
    };
}

function resolveEntry(entry: SourceEntry, context: DbContext): OrderSheetReconcileRow {
    let customer = findByNormalized(context.customersByKey, entry.convertedCustomer);
    let address: { id: string; customerId: string; label: string; addressLine1: string; isDefault: boolean } | null = null;

    const globalAddress = findByNormalized(context.addressesByGlobalKey, entry.rawCustomer)
        || findByNormalized(context.addressesByGlobalKey, entry.convertedCustomer);
    if (!customer && globalAddress) {
        address = globalAddress;
        customer = context.customers.find((candidate) => candidate.id === globalAddress.customerId) || undefined;
    }

    if (customer) {
        const customerAddresses = context.addressesByCustomer.get(customer.id) || [];
        address = address && address.customerId === customer.id ? address : null;
        address ||= customerAddresses.find((candidate) => normalizeCompanyKey(candidate.label) === normalizeCompanyKey(entry.rawCustomer)) ?? null;
        address ||= customerAddresses.find((candidate) => normalizeCompanyKey(candidate.addressLine1) === normalizeCompanyKey(entry.rawCustomer)) ?? null;
        address ||= customerAddresses.find((candidate) => candidate.isDefault) ?? null;
        address ||= customerAddresses[0] || null;
    }

    const product = findProductByKey(context.productsByKey, entry.convertedProduct)
        || findProductByKey(context.productsByKey, entry.rawProduct);
    const supplier = findSupplierByName(context, entry.convertedSupplier)
        || findSupplierByName(context, entry.supplierName)
        || (entry.supplierDefaulted ? context.hanwhaSupplier : null);

    const problems: string[] = [];
    if (!customer) problems.push('CUSTOMER_NOT_FOUND');
    if (!product) problems.push('PRODUCT_NOT_FOUND');
    if (!supplier) problems.push('SUPPLIER_NOT_FOUND');
    if (entry.quantity == null || entry.quantity <= 0) problems.push('QUANTITY_INVALID');
    if (!address) problems.push('ADDRESS_NOT_FOUND');

    return {
        ...entry,
        customerId: customer?.id || '',
        dbCustomerName: customer?.companyName || '',
        customerRepId: customer?.defaultSalesRepId ?? null,
        customerRepName: customer?.defaultSalesRep?.name ?? '미지정',
        deliveryAddressId: address?.id || '',
        deliveryAddressLabel: address?.label || '',
        productId: product?.id || '',
        dbProductName: product?.productName || '',
        dbProductCode: product?.productCode || '',
        supplierId: supplier?.id || '',
        dbSupplierName: supplier?.supplierName || '',
        problems,
        matchStatus: problems.length > 0 ? 'UNRESOLVED' : 'MISSING',
        matchedOrderNo: '',
        matchedOrderItemId: '',
        matchNote: '',
    };
}

async function loadExistingOrderItems(targetDate: Date): Promise<ExistingOrderItem[]> {
    const start = dateOnly(targetDate);
    start.setDate(start.getDate() - 14);
    const end = new Date(start);
    end.setDate(end.getDate() + 60);

    const orders = await prisma.order.findMany({
        where: {
            OR: [
                { requestedDeliveryDate: { gte: start, lt: end } },
                { items: { some: { salesLedgerDate: { gte: start, lt: end } } } },
                { items: { some: { purchaseLedgerDate: { gte: start, lt: end } } } },
            ],
            deletedAt: null,
        },
        select: {
            id: true,
            orderNo: true,
            customerId: true,
            status: true,
            customer: { select: { companyName: true, defaultSalesRepId: true, defaultSalesRep: { select: { name: true } } } },
            deliveryAddress: { select: { label: true } },
            requestedDeliveryDate: true,
            items: {
                select: {
                    id: true,
                    productId: true,
                    requestedQuantity: true,
                    purchaseSupplierId: true,
                    fulfillmentType: true,
                    salesLedgerDate: true,
                    purchaseLedgerDate: true,
                    product: { select: { productName: true, productCode: true } },
                    purchaseSupplier: { select: { supplierName: true } },
                },
            },
        },
        orderBy: { orderNo: 'asc' },
    });

    return orders.flatMap((order) => order.items.map((item) => ({
        orderId: order.id,
        orderNo: order.orderNo,
        orderStatus: order.status,
        customerId: order.customerId,
        customerName: order.customer.companyName,
        customerRepId: order.customer.defaultSalesRepId ?? null,
        customerRepName: order.customer.defaultSalesRep?.name ?? '미지정',
        deliveryAddressLabel: order.deliveryAddress.label,
        deliveryDate: order.requestedDeliveryDate ? dateIso(dateOnly(order.requestedDeliveryDate)) : '',
        salesDate: item.salesLedgerDate
            ? dateIso(dateOnly(item.salesLedgerDate))
            : (order.requestedDeliveryDate ? dateIso(dateOnly(order.requestedDeliveryDate)) : ''),
        purchaseDate: item.purchaseLedgerDate
            ? dateIso(dateOnly(item.purchaseLedgerDate))
            : (previousBusinessDate(order.requestedDeliveryDate)
                ? dateIso(previousBusinessDate(order.requestedDeliveryDate)!)
                : (order.requestedDeliveryDate ? dateIso(dateOnly(order.requestedDeliveryDate)) : '')),
        itemId: item.id,
        productId: item.productId,
        productName: item.product.productName,
        productCode: item.product.productCode,
        productKey: normalizeProductKey(item.product.productName || item.product.productCode),
        quantity: item.requestedQuantity,
        supplierId: item.purchaseSupplierId || '',
        supplierName: item.purchaseSupplier?.supplierName || '',
        fulfillmentType: item.fulfillmentType || '',
        ignored: CANCELLED_STATUSES.has(order.status),
        used: false,
    })));
}

function reconcileRows(rows: OrderSheetReconcileRow[], existingItems: ExistingOrderItem[]) {
    const activeItems = existingItems.filter((item) => !item.ignored);

    for (const row of rows) {
        const productKey = normalizeProductKey(row.dbProductName || row.convertedProduct || row.rawProduct);
        row.matchStatus = row.problems.length > 0 ? 'UNRESOLVED' : 'MISSING';
        row.matchedOrderNo = '';
        row.matchedOrderItemId = '';
        row.matchNote = row.problems.join(', ');
        if (row.problems.length > 0 || row.quantity == null) continue;

        const exact = activeItems.find((item) =>
            !item.used
            && item.customerId === row.customerId
            && item.productKey === productKey
            && Math.abs(item.quantity - row.quantity!) < QUANTITY_EPSILON
            && item.purchaseDate === row.purchaseDate
            && item.salesDate === row.salesDate
            && (item.supplierId || '') === (row.supplierId || '')
        );

        if (exact) {
            exact.used = true;
            row.matchStatus = 'MATCHED';
            row.matchedOrderNo = exact.orderNo;
            row.matchedOrderItemId = exact.itemId;
            row.matchNote = '';
            continue;
        }

        const loose = activeItems.find((item) =>
            !item.used
            && item.customerId === row.customerId
            && item.productKey === productKey
            && Math.abs(item.quantity - row.quantity!) < QUANTITY_EPSILON
            && item.purchaseDate === row.purchaseDate
            && item.salesDate === row.salesDate
        );

        if (loose) {
            loose.used = true;
            row.matchStatus = 'SUPPLIER_MISMATCH';
            row.matchedOrderNo = loose.orderNo;
            row.matchedOrderItemId = loose.itemId;
            row.matchNote = `시트 매입처=${row.dbSupplierName || row.supplierName}, DB 매입처=${loose.supplierName || '(없음)'}`;
        }
    }

    return activeItems.filter((item) => !item.used);
}

function filterRowsForActor(rows: OrderSheetReconcileRow[], actor: StaffActor, selectedRepId: string) {
    const canViewAll = isYangHeeCheol(actor);
    if (canViewAll && selectedRepId === 'all') return rows;
    const repId = canViewAll ? selectedRepId : actor.id;
    return rows.filter((row) => row.customerRepId === repId);
}

function filterDbOnlyForActor(items: ExistingOrderItem[], actor: StaffActor, selectedRepId: string) {
    const canViewAll = isYangHeeCheol(actor);
    if (canViewAll && selectedRepId === 'all') return items;
    const repId = canViewAll ? selectedRepId : actor.id;
    return items.filter((item) => item.customerRepId === repId);
}

export async function getOrderSheetStaffUsers() {
    return prisma.user.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
    });
}

async function previewOrderSheetRows(input: {
    date: string;
    actor: StaffActor;
    selectedRepId?: string;
    sheetName: string;
    sourceLabel: string;
    sheetRows: unknown[][];
    warnings?: string[];
}) {
    if (input.actor.userKind !== 'staff') throw new Error('직원만 오더시트 대조를 사용할 수 있습니다.');

    const targetDate = parseTargetDate(input.date);
    const desktop = path.join(os.homedir(), 'Desktop');
    const customerMapPath = firstExistingPath([
        process.env.ORDER_CUSTOMER_MAP_FILE,
        defaultExistingPath(desktop, '정리된_거래처목록.xlsx'),
        defaultExistingPath(process.cwd(), '새 폴더', '정리된_거래처목록.xlsx'),
        defaultExistingPath(process.cwd(), 'data', '정리된_거래처목록입출금.xlsx'),
    ]);
    const productMapPath = firstExistingPath([
        process.env.ORDER_PRODUCT_MAP_FILE,
        defaultExistingPath(desktop, '품목명_결과.xlsx'),
        defaultExistingPath(process.cwd(), '새 폴더', '품목명_결과.xlsx'),
    ]);
    const warnings = [...(input.warnings ?? [])];
    if (!customerMapPath) warnings.push('거래처 변환표를 찾지 못했습니다.');
    if (!productMapPath) warnings.push('품목 변환표를 찾지 못했습니다.');

    const [customerNameMap, productNameMap] = [
        loadCustomerNameMap(customerMapPath),
        loadProductNameMap(productMapPath),
    ];
    const sourceEntries = extractOrderRows(input.sheetRows, targetDate, customerNameMap, productNameMap);
    return previewOrderSourceEntries({
        date: input.date,
        actor: input.actor,
        selectedRepId: input.selectedRepId,
        sheetName: input.sheetName,
        sourceLabel: input.sourceLabel,
        sourceEntries,
        warnings,
    });
}

async function previewOrderSourceEntries(input: {
    date: string;
    actor: StaffActor;
    selectedRepId?: string;
    sheetName: string;
    sourceLabel: string;
    sourceEntries: SourceEntry[];
    warnings?: string[];
}) {
    if (input.actor.userKind !== 'staff') throw new Error('직원만 오더 대조를 사용할 수 있습니다.');

    const targetDate = parseTargetDate(input.date);
    const targetIso = dateIso(targetDate);
    const canViewAll = isYangHeeCheol(input.actor);
    const selectedRepId = canViewAll ? (input.selectedRepId || 'all') : input.actor.id;
    const warnings = [...(input.warnings ?? [])];
    const sourceEntries = input.sourceEntries;
    const context = await buildDbContext();
    const resolvedRows = sourceEntries.map((entry) => resolveEntry(entry, context));
    const existingItems = await loadExistingOrderItems(targetDate);
    const dbOnly = reconcileRows(resolvedRows, existingItems);
    const visibleRows = filterRowsForActor(resolvedRows, input.actor, selectedRepId);
    const visibleDbOnly = filterDbOnlyForActor(dbOnly, input.actor, selectedRepId);
    const count = (status: ReconcileMatchStatus) => visibleRows.filter((row) => row.matchStatus === status).length;

    return {
        date: targetIso,
        sheetName: input.sheetName,
        sourceLabel: input.sourceLabel,
        generatedAt: new Date().toISOString(),
        canViewAll,
        selectedRepId,
        rows: resolvedRows,
        visibleRows,
        hiddenRowCount: resolvedRows.length - visibleRows.length,
        extraDbItems: visibleDbOnly,
        summary: {
            extracted: resolvedRows.length,
            visible: visibleRows.length,
            matched: count('MATCHED'),
            missing: count('MISSING'),
            unresolved: count('UNRESOLVED'),
            supplierMismatch: count('SUPPLIER_MISMATCH'),
            dbOnly: visibleDbOnly.length,
        },
        warnings,
    } satisfies OrderSheetPreview;
}

export async function previewOrderSheetReconciliation(input: {
    date: string;
    actor: StaffActor;
    selectedRepId?: string;
}) {
    const targetDate = parseTargetDate(input.date);
    const sheetName = inferSheetName(targetDate);
    const desktop = path.join(os.homedir(), 'Desktop');
    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || defaultExistingPath(desktop, '구글api관련.json');
    const spreadsheetId = DEFAULT_SPREADSHEET_ID;
    const sheetRows = await readGoogleSheetRows(spreadsheetId, sheetName, credentialsPath || '');
    return previewOrderSheetRows({
        ...input,
        sheetName,
        sourceLabel: `Google Sheets / ${sheetName}`,
        sheetRows,
    });
}

export function listOrderSheetWorkbookSheets(fileName: string, buffer: Buffer) {
    const workbook = readWorkbookBuffer(fileName, buffer);
    return {
        ok: true as const,
        fileName,
        sheets: workbook.SheetNames,
    };
}

export async function previewOrderSheetReconciliationFromBuffer(input: {
    fileName: string;
    buffer: Buffer;
    sheetName: string;
    date: string;
    actor: StaffActor;
    selectedRepId?: string;
}) {
    if (input.actor.userKind !== 'staff') throw new Error('직원만 오더시트 대조를 사용할 수 있습니다.');
    const targetDate = parseTargetDate(input.date);
    const workbook = readWorkbookBuffer(input.fileName, input.buffer);
    const sheetName = matchWorkbookSheetName(workbook, input.sheetName, targetDate);
    const sheetRows = readWorkbookSheetRows(workbook, sheetName);
    return previewOrderSheetRows({
        date: input.date,
        actor: input.actor,
        selectedRepId: input.selectedRepId,
        sheetName,
        sourceLabel: `${input.fileName} / ${sheetName}`,
        sheetRows,
    });
}

function monthlyPurchaseSalesFilePath(targetDate: Date) {
    const dir = process.env.ORDER_PURCHASE_SALES_DIR || 'E:\\매입매출';
    const fileName = `${targetDate.getFullYear()}.${String(targetDate.getMonth() + 1).padStart(2, '0')}월매입매출.xlsx`;
    return path.join(dir, fileName);
}

function matchPurchaseSalesSheetName(workbook: XLSX.WorkBook, targetDate: Date) {
    const padded = String(targetDate.getDate()).padStart(2, '0');
    const unpadded = String(targetDate.getDate());
    if (workbook.SheetNames.includes(padded)) return padded;
    if (workbook.SheetNames.includes(unpadded)) return unpadded;
    throw new Error(`매입매출 파일에서 ${padded} 시트를 찾지 못했습니다.`);
}

function matchPurchaseSalesUploadedSheetName(workbook: XLSX.WorkBook, requestedSheetName: string, targetDate: Date) {
    const trimmed = requestedSheetName.trim();
    if (trimmed && workbook.SheetNames.includes(trimmed)) return trimmed;
    if (trimmed) {
        const found = workbook.SheetNames.find((name) => name.includes(trimmed) || trimmed.includes(name));
        if (found) return found;
        throw new Error(`매입매출 파일에서 ${trimmed} 시트를 찾지 못했습니다.`);
    }
    return matchPurchaseSalesSheetName(workbook, targetDate);
}

export function listPurchaseSalesWorkbookSheets(fileName: string, buffer: Buffer) {
    const workbook = readWorkbookBuffer(fileName, buffer);
    return {
        ok: true as const,
        fileName,
        sheets: workbook.SheetNames,
    };
}

export async function previewPurchaseSalesReconciliationFromBuffer(input: {
    fileName: string;
    buffer: Buffer;
    productMapFileName?: string;
    productMapBuffer?: Buffer | null;
    sheetName: string;
    date: string;
    actor: StaffActor;
    selectedRepId?: string;
}) {
    if (input.actor.userKind !== 'staff') throw new Error('직원만 오더 대조를 사용할 수 있습니다.');

    const targetDate = parseTargetDate(input.date);
    const workbook = readWorkbookBuffer(input.fileName, input.buffer);
    const sheetName = matchPurchaseSalesUploadedSheetName(workbook, input.sheetName, targetDate);
    const sheetRows = readWorkbookSheetRows(workbook, sheetName);
    const warnings: string[] = [];
    if (!input.productMapBuffer || input.productMapBuffer.length === 0) warnings.push('품목명 파일을 선택하지 않아 기본 수동 매핑만 적용했습니다.');

    const sourceEntries = extractPurchaseSalesRows(
        sheetRows,
        targetDate,
        loadProductNameMapFromBuffer(input.productMapFileName || '품목명_결과.xlsx', input.productMapBuffer ?? null),
    );

    return previewOrderSourceEntries({
        date: input.date,
        actor: input.actor,
        selectedRepId: input.selectedRepId,
        sheetName,
        sourceLabel: `${input.fileName} / ${sheetName}`,
        sourceEntries,
        warnings,
    });
}

export async function previewPurchaseSalesReconciliation(input: {
    date: string;
    actor: StaffActor;
    selectedRepId?: string;
}) {
    if (input.actor.userKind !== 'staff') throw new Error('직원만 오더 대조를 사용할 수 있습니다.');

    const targetDate = parseTargetDate(input.date);
    const filePath = monthlyPurchaseSalesFilePath(targetDate);
    if (!fs.existsSync(filePath)) {
        throw new Error(`매입매출 파일을 찾지 못했습니다: ${filePath}`);
    }

    const workbook = XLSX.readFile(filePath, { cellDates: true });
    const sheetName = matchPurchaseSalesSheetName(workbook, targetDate);
    const sheetRows = readWorkbookSheetRows(workbook, sheetName);
    const desktop = path.join(os.homedir(), 'Desktop');
    const customerMapPath = firstExistingPath([
        process.env.ORDER_CUSTOMER_MAP_FILE,
        defaultExistingPath(desktop, '정리된_거래처목록.xlsx'),
        defaultExistingPath(process.cwd(), '새 폴더', '정리된_거래처목록.xlsx'),
        defaultExistingPath(process.cwd(), 'data', '정리된_거래처목록입출금.xlsx'),
    ]);
    const productMapPath = firstExistingPath([
        process.env.ORDER_PRODUCT_MAP_FILE,
        defaultExistingPath(desktop, '품목명_결과.xlsx'),
        defaultExistingPath(process.cwd(), '새 폴더', '품목명_결과.xlsx'),
    ]);
    const warnings: string[] = [];
    if (!customerMapPath) warnings.push('거래처 변환표를 찾지 못했습니다.');
    if (!productMapPath) warnings.push('품목 변환표를 찾지 못했습니다.');

    const sourceEntries = extractPurchaseSalesRows(
        sheetRows,
        targetDate,
        loadProductNameMap(productMapPath),
    );

    return previewOrderSourceEntries({
        date: input.date,
        actor: input.actor,
        selectedRepId: input.selectedRepId,
        sheetName,
        sourceLabel: filePath,
        sourceEntries,
        warnings,
    });
}

async function getNextOrderNo(tx: Prisma.TransactionClient, orderDateIso: string) {
    const orderDate = new Date(`${orderDateIso}T00:00:00`);
    const prefix = `HY-${String(orderDate.getFullYear()).slice(2)}${String(orderDate.getMonth() + 1).padStart(2, '0')}${String(orderDate.getDate()).padStart(2, '0')}-`;

    let seqRow = await tx.orderSequence.findUnique({ where: { orderDate }, select: { lastSeq: true } });
    if (!seqRow) {
        const lastOrder = await tx.order.findFirst({
            where: { orderNo: { startsWith: prefix } },
            select: { orderNo: true },
            orderBy: { orderNo: 'desc' },
        });
        const seedSeq = lastOrder?.orderNo.match(/-(\d{4})$/)?.[1] ? Number(lastOrder.orderNo.match(/-(\d{4})$/)?.[1]) : 0;
        seqRow = await tx.orderSequence.upsert({
            where: { orderDate },
            create: { orderDate, lastSeq: seedSeq + 1 },
            update: { lastSeq: { increment: 1 } },
            select: { lastSeq: true },
        });
    } else {
        seqRow = await tx.orderSequence.update({
            where: { orderDate },
            data: { lastSeq: { increment: 1 } },
            select: { lastSeq: true },
        });
    }

    return `${prefix}${String(seqRow.lastSeq).padStart(4, '0')}`;
}

async function createMissingRowsFromPreview(input: {
    preview: OrderSheetPreview;
    actor: StaffActor;
    rowIds: string[];
    mode: 'all' | 'selected';
}) {
    const preview = input.preview;
    const selectedIds = new Set(input.rowIds);
    const targets = preview.visibleRows.filter((row) =>
        row.matchStatus === 'MISSING'
        && (input.mode === 'all' || selectedIds.has(row.id))
    );
    if (targets.length === 0) return { ok: false as const, error: '입력할 누락 항목을 선택해 주세요.', created: 0, skipped: 0 };

    const context = await buildDbContext();
    const created: Array<{ rowId: string; orderNo: string }> = [];
    const skipped: Array<{ rowId: string; reason: string }> = [];

    await prisma.$transaction(async (tx) => {
        for (const row of targets) {
            if (!row.customerId || !row.deliveryAddressId || !row.productId || !row.supplierId || row.quantity == null || row.quantity <= 0) {
                skipped.push({ rowId: row.id, reason: '필수 매칭 정보 부족' });
                continue;
            }
            const product = context.products.find((candidate) => candidate.id === row.productId);
            const customer = context.customers.find((candidate) => candidate.id === row.customerId);
            const orderNo = await getNextOrderNo(tx, row.deliveryDate || row.date);
            const salesEntityId = product?.defaultSalesEntityId || context.defaultSalesEntity?.id || null;
            const purchaseEntityId = product?.defaultPurchaseEntityId || context.defaultPurchaseEntity?.id || salesEntityId;
            const deliveryDate = new Date(`${row.deliveryDate || row.date}T00:00:00`);
            const salesDate = new Date(`${row.salesDate || row.deliveryDate || row.date}T00:00:00`);
            const purchaseDate = new Date(`${row.purchaseDate || row.date}T00:00:00`);
            const defaultPurchaseDate = previousBusinessDate(deliveryDate) ?? deliveryDate;
            const memo = [
                '[오더시트 자동 입력]',
                `원본 ${row.sourceBlock} / ${row.sourceRowNumber}행`,
                row.supplierDefaulted ? '매입처 공란 → 한화솔루션 적용' : null,
                row.remark || null,
            ].filter(Boolean).join(' / ');

            const order = await tx.order.create({
                data: {
                    orderNo,
                    customerId: row.customerId,
                    deliveryAddressId: row.deliveryAddressId,
                    requestedByUserId: input.actor.id,
                    salesRepId: customer?.defaultSalesRepId || input.actor.id,
                    orderSource: 'SPREADSHEET',
                    status: 'REQUESTED',
                    requestedDeliveryDate: deliveryDate,
                    memo,
                    items: {
                        create: {
                            productId: row.productId,
                            requestedQuantity: row.quantity,
                            salesEntityId,
                            purchaseEntityId,
                            purchaseSupplierId: row.supplierId,
                            purchaseSupplierConfirmedAt: new Date(),
                            salesLedgerDate: dateIso(salesDate) !== dateIso(deliveryDate) ? salesDate : null,
                            purchaseLedgerDate: dateIso(purchaseDate) !== dateIso(defaultPurchaseDate) ? purchaseDate : null,
                            fulfillmentType: 'DIRECT',
                            unit: 'TON',
                            memo: row.remark || null,
                        },
                    },
                    statusHistory: {
                        create: {
                            previousStatus: null,
                            newStatus: 'REQUESTED',
                            changedByUserId: input.actor.id,
                            changeReason: `오더시트 자동 입력 (${row.sourceBlock} / ${row.sourceRowNumber}행)`,
                        },
                    },
                },
                select: { id: true, orderNo: true },
            });

            await tx.customerProductWhitelist.upsert({
                where: { customerId_productId: { customerId: row.customerId, productId: row.productId } },
                update: {
                    lastOrderedAt: new Date(),
                    totalOrderCount: { increment: 1 },
                },
                create: {
                    customerId: row.customerId,
                    productId: row.productId,
                    firstOrderedAt: new Date(),
                    lastOrderedAt: new Date(),
                    totalOrderCount: 1,
                    isVisibleInPortal: true,
                },
            });

            created.push({ rowId: row.id, orderNo: order.orderNo });
        }
    }, { timeout: 60000 });

    return {
        ok: true as const,
        created: created.length,
        skipped: skipped.length,
        orderNos: created.map((item) => item.orderNo),
        skippedRows: skipped,
    };
}

export async function createMissingOrderSheetRows(input: {
    date: string;
    actor: StaffActor;
    selectedRepId?: string;
    rowIds: string[];
    mode: 'all' | 'selected';
}) {
    const preview = await previewOrderSheetReconciliation({
        date: input.date,
        actor: input.actor,
        selectedRepId: input.selectedRepId,
    });
    return createMissingRowsFromPreview({
        preview,
        actor: input.actor,
        rowIds: input.rowIds,
        mode: input.mode,
    });
}

export async function createMissingOrderSheetRowsFromBuffer(input: {
    fileName: string;
    buffer: Buffer;
    sheetName: string;
    date: string;
    actor: StaffActor;
    selectedRepId?: string;
    rowIds: string[];
    mode: 'all' | 'selected';
}) {
    const preview = await previewOrderSheetReconciliationFromBuffer({
        fileName: input.fileName,
        buffer: input.buffer,
        sheetName: input.sheetName,
        date: input.date,
        actor: input.actor,
        selectedRepId: input.selectedRepId,
    });
    return createMissingRowsFromPreview({
        preview,
        actor: input.actor,
        rowIds: input.rowIds,
        mode: input.mode,
    });
}

export async function createMissingPurchaseSalesRows(input: {
    date: string;
    actor: StaffActor;
    selectedRepId?: string;
    rowIds: string[];
    mode: 'all' | 'selected';
}) {
    const preview = await previewPurchaseSalesReconciliation({
        date: input.date,
        actor: input.actor,
        selectedRepId: input.selectedRepId,
    });
    return createMissingRowsFromPreview({
        preview,
        actor: input.actor,
        rowIds: input.rowIds,
        mode: input.mode,
    });
}

export async function createMissingPurchaseSalesRowsFromBuffer(input: {
    fileName: string;
    buffer: Buffer;
    productMapFileName?: string;
    productMapBuffer?: Buffer | null;
    sheetName: string;
    date: string;
    actor: StaffActor;
    selectedRepId?: string;
    rowIds: string[];
    mode: 'all' | 'selected';
}) {
    const preview = await previewPurchaseSalesReconciliationFromBuffer({
        fileName: input.fileName,
        buffer: input.buffer,
        productMapFileName: input.productMapFileName,
        productMapBuffer: input.productMapBuffer,
        sheetName: input.sheetName,
        date: input.date,
        actor: input.actor,
        selectedRepId: input.selectedRepId,
    });
    return createMissingRowsFromPreview({
        preview,
        actor: input.actor,
        rowIds: input.rowIds,
        mode: input.mode,
    });
}
