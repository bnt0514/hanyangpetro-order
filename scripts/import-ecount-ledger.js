const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const DATA_DIR = path.join(process.cwd(), 'data');

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');

function normalize(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeCompanyName(value) {
    return normalize(value)
        .replace(/\(주\)|㈜|주식회사|유한회사|\(유\)/g, '')
        .replace(/[^0-9a-zA-Z가-힣]/g, '')
        .toLowerCase();
}

function digits(value) {
    return normalize(value).replace(/[^0-9]/g, '');
}

function parseNumber(value) {
    const text = normalize(value).replace(/,/g, '');
    if (!text || text === '-') return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
}

function parseDate(value, previousDate) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    const text = normalize(value);
    if (!text) return previousDate;
    const m = text.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function dateIso(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function shortHash(input) {
    return crypto.createHash('sha1').update(input).digest('hex').slice(0, 10);
}

function sourceHash(input) {
    return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function isTotalLabel(value) {
    const text = normalize(value);
    return text === '계' || text === '합계' || /\s계$/.test(text) || / 계\s*$/.test(text);
}

function findHeader(rows) {
    const aliases = {
        date: ['일별', '일자', '매출일자', '매입일자', '날짜'],
        counterparty: ['거래처별', '거래처', '매출처', '매입처', '상호'],
        product: ['품목별', '품목', '품목명', '제품', '제품명'],
        quantity: ['수량'],
        unitPrice: ['단가'],
        supplyAmount: ['공급가액', '공급액', '공급금액'],
        vatAmount: ['부가세', '세액'],
        totalAmount: ['합계', '총액', '금액'],
        counterpartyCode: ['거래처코드', '코드', '사업자번호'],
    };

    for (let rowIndex = 0; rowIndex < Math.min(rows.length, 30); rowIndex += 1) {
        const row = rows[rowIndex].map(normalize);
        const index = {};
        for (const [key, names] of Object.entries(aliases)) {
            const found = row.findIndex((cell) => names.some((name) => cell === name || cell.includes(name)));
            if (found >= 0) index[key] = found;
        }
        if (index.date != null && index.counterparty != null && index.quantity != null && (index.supplyAmount != null || index.totalAmount != null)) {
            return { rowIndex, index };
        }
    }
    return null;
}

function detectLedgerType(fileName) {
    if (fileName.includes('매입')) return 'PURCHASE';
    if (fileName.includes('매출')) return 'SALES';
    return null;
}

function isKoreanTotalLabel(value) {
    const text = normalize(value);
    return text === '계' || text.includes('합계') || /\s계$/.test(text);
}

function parseWorkbook(filePath) {
    const fileName = path.basename(filePath);
    const ledgerType = detectLedgerType(fileName);
    if (!ledgerType) return [];

    const wb = XLSX.readFile(filePath, { cellDates: true });
    const parsed = [];

    for (const sheetName of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: '' });
        const header = findHeader(rows);
        if (!header) continue;

        let carryDate = null;
        let carryCounterparty = '';
        let carryProduct = '';

        for (let rowIndex = header.rowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
            const row = rows[rowIndex];
            const value = (key) => row[header.index[key]];
            const rawDate = normalize(value('date'));
            const rawCounterparty = normalize(value('counterparty'));
            const rawProduct = normalize(value('product'));

            const maybeDate = parseDate(rawDate, carryDate);
            if (maybeDate) carryDate = maybeDate;
            if (rawCounterparty) carryCounterparty = rawCounterparty;
            if (rawProduct) carryProduct = rawProduct;

            const counterpartyName = rawCounterparty || carryCounterparty;
            const productName = rawProduct || carryProduct || '품목 미지정';
            const quantity = parseNumber(value('quantity')) ?? 0;
            const explicitUnitPrice = parseNumber(value('unitPrice'));
            const supplyAmount = parseNumber(value('supplyAmount'));
            const vatAmount = parseNumber(value('vatAmount'));
            const totalAmount = parseNumber(value('totalAmount'));
            const unitPrice = explicitUnitPrice ?? (quantity > 0 && supplyAmount != null ? supplyAmount / quantity : null);
            const counterpartyCode = header.index.counterpartyCode != null ? normalize(value('counterpartyCode')) : null;

            if (!carryDate || !counterpartyName) continue;
            if (
                isTotalLabel(rawDate) || isTotalLabel(counterpartyName) || isTotalLabel(productName)
                || isKoreanTotalLabel(rawDate) || isKoreanTotalLabel(rawCounterparty) || isKoreanTotalLabel(rawProduct)
                || isKoreanTotalLabel(counterpartyName) || isKoreanTotalLabel(productName)
            ) continue;
            if (quantity === 0 && supplyAmount == null && totalAmount == null) continue;

            parsed.push({
                ledgerType,
                transactionDate: carryDate,
                counterpartyCode: counterpartyCode || null,
                counterpartyName,
                productName,
                quantity,
                unitPrice,
                supplyAmount,
                vatAmount,
                totalAmount,
                sourceFile: fileName,
                sourceSheet: sheetName,
                sourceRowNumber: rowIndex + 1,
            });
        }
    }

    return parsed;
}

async function findOrCreateCustomer(entry) {
    const codeDigits = digits(entry.counterpartyCode);
    const name = entry.counterpartyName;
    const existing = await prisma.customer.findFirst({
        where: {
            OR: [
                ...(codeDigits ? [{ customerCode: codeDigits }, { businessNumber: codeDigits }] : []),
                { companyName: name },
            ],
        },
        select: { id: true },
    });
    if (existing) return existing.id;

    const normalizedName = normalizeCompanyName(name);
    const candidates = await prisma.customer.findMany({
        select: { id: true, companyName: true },
    });
    const normalizedMatch = candidates.find((customer) => normalizeCompanyName(customer.companyName) === normalizedName);
    if (normalizedMatch) return normalizedMatch.id;

    const customer = await prisma.customer.create({
        data: {
            customerCode: codeDigits || `ECOUNT-SALES-${shortHash(name)}`,
            companyName: name,
            businessNumber: codeDigits || null,
            memo: '이카운트 원장 이관 중 자동 생성',
        },
        select: { id: true },
    });
    return customer.id;
}

async function findOrCreateSupplier(entry) {
    const name = entry.counterpartyName;
    const existing = await prisma.supplier.findFirst({
        where: { supplierName: name },
        select: { id: true },
    });
    if (existing) return existing.id;

    const normalizedName = normalizeCompanyName(name);
    const candidates = await prisma.supplier.findMany({
        select: { id: true, supplierName: true },
    });
    const normalizedMatch = candidates.find((supplier) => normalizeCompanyName(supplier.supplierName) === normalizedName);
    if (normalizedMatch) return normalizedMatch.id;

    const supplier = await prisma.supplier.create({
        data: {
            supplierName: name,
            memo: entry.counterpartyCode ? `이카운트 코드 ${entry.counterpartyCode}` : '이카운트 원장 이관 중 자동 생성',
        },
        select: { id: true },
    });
    return supplier.id;
}

async function findProduct(entry) {
    const product = await prisma.product.findFirst({
        where: {
            OR: [
                { productName: entry.productName },
                { productCode: entry.productName },
            ],
        },
        select: { id: true, productCode: true, productName: true },
    });
    return product;
}

async function main() {
    if (!fs.existsSync(DATA_DIR)) throw new Error(`data 폴더가 없습니다: ${DATA_DIR}`);
    const files = fs.readdirSync(DATA_DIR)
        .filter((name) => /매입24-26|매출24-26/i.test(name) && /\.xlsx$/i.test(name))
        .map((name) => path.join(DATA_DIR, name));

    if (files.length === 0) {
        console.log('매칭 파일이 없습니다. data 폴더에 매입24-26*.xlsx, 매출24-26*.xlsx 파일을 넣어주세요.');
        return;
    }

    const defaultSalesEntity = await prisma.companyEntity.findFirst({ where: { isDefaultSales: true }, select: { id: true } });
    const defaultPurchaseEntity = await prisma.companyEntity.findFirst({ where: { isDefaultPurchase: true }, select: { id: true } });
    const allEntries = files.flatMap(parseWorkbook);
    const counts = { total: allEntries.length, sales: allEntries.filter((e) => e.ledgerType === 'SALES').length, purchase: allEntries.filter((e) => e.ledgerType === 'PURCHASE').length, inserted: 0, skipped: 0 };

    console.log(`파싱 완료: 총 ${counts.total}건 (매출 ${counts.sales}, 매입 ${counts.purchase})`);
    console.log(APPLY ? 'DB 반영 모드입니다.' : '미리보기 모드입니다. 실제 반영은 --apply 옵션을 붙이세요.');
    console.table(allEntries.slice(0, 10).map((entry) => ({
        type: entry.ledgerType,
        date: dateIso(entry.transactionDate),
        counterparty: entry.counterpartyName,
        product: entry.productName,
        quantity: entry.quantity,
        unitPrice: entry.unitPrice,
        supplyAmount: entry.supplyAmount,
    })));

    if (!APPLY) return;

    for (const entry of allEntries) {
        const product = await findProduct(entry);
        const hash = sourceHash({
            type: entry.ledgerType,
            file: entry.sourceFile,
            sheet: entry.sourceSheet,
            row: entry.sourceRowNumber,
            date: dateIso(entry.transactionDate),
            counterparty: entry.counterpartyName,
            product: entry.productName,
            quantity: entry.quantity,
            unitPrice: entry.unitPrice,
            supplyAmount: entry.supplyAmount,
            vatAmount: entry.vatAmount,
            totalAmount: entry.totalAmount,
        });

        const exists = await prisma.ledgerEntry.findUnique({ where: { sourceHash: hash }, select: { id: true } });
        if (exists) {
            counts.skipped += 1;
            continue;
        }

        const customerId = entry.ledgerType === 'SALES' ? await findOrCreateCustomer(entry) : null;
        const supplierId = entry.ledgerType === 'PURCHASE' ? await findOrCreateSupplier(entry) : null;

        await prisma.ledgerEntry.create({
            data: {
                ledgerType: entry.ledgerType,
                transactionDate: entry.transactionDate,
                companyEntityId: entry.ledgerType === 'SALES' ? defaultSalesEntity?.id ?? null : defaultPurchaseEntity?.id ?? null,
                customerId,
                supplierId,
                counterpartyCode: entry.counterpartyCode,
                counterpartyName: entry.counterpartyName,
                productId: product?.id ?? null,
                productCode: product?.productCode ?? null,
                productName: product?.productName ?? entry.productName,
                quantity: entry.quantity,
                unit: 'TON',
                unitPrice: entry.unitPrice,
                supplyAmount: entry.supplyAmount,
                vatAmount: entry.vatAmount,
                totalAmount: entry.totalAmount,
                memo: '이카운트 일별/거래처별/품목별 원장 이관',
                sourceFile: entry.sourceFile,
                sourceSheet: entry.sourceSheet,
                sourceRowNumber: entry.sourceRowNumber,
                sourceHash: hash,
            },
        });
        counts.inserted += 1;
    }

    console.log(`반영 완료: 신규 ${counts.inserted}건, 중복 스킵 ${counts.skipped}건`);
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });