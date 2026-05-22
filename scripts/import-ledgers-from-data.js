const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const xlsx = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const REPLACE = process.argv.includes('--replace');
const DATA_DIR = path.resolve(process.cwd(), process.argv.includes('--data-dir') ? process.argv[process.argv.indexOf('--data-dir') + 1] : 'data');
const SOURCE_TYPE = 'XLSX_LEDGER_IMPORT';

function normalizeCompanyName(name) {
    return String(name || '')
        .replace(/주식회사\s*/g, '')
        .replace(/\(주\)/g, '')
        .replace(/㈜/g, '')
        .replace(/\(유\)/g, '')
        .replace(/유한회사\s*/g, '')
        .replace(/합자회사\s*/g, '')
        .replace(/\s+/g, '')
        .toLowerCase()
        .trim();
}

function normalizeProductCode(name) {
    const text = String(name || '').trim();
    const bracket = text.match(/<([^>]+)>/);
    if (bracket?.[1]) return bracket[1].trim().toUpperCase();
    return text.replace(/\s+/g, '').replace(/[^a-zA-Z0-9가-힣_-]/g, '').slice(0, 80).toUpperCase();
}

function parseAmount(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(String(value).replace(/,/g, '').replace(/\s/g, ''));
    return Number.isFinite(n) ? n : null;
}

function parseDate(value) {
    if (!value) return null;
    if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    const s = String(value).trim().replace(/-/g, '/');
    const m = s.match(/^(20\d{2})\/(\d{1,2})\/(\d{1,2})/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function isoDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function sourceHash(file, sheet, rowNumber, ledgerType) {
    return crypto.createHash('sha256').update(`${SOURCE_TYPE}|${path.basename(file)}|${sheet}|${rowNumber}|${ledgerType}`).digest('hex');
}

function matchByName(list, key, rawName) {
    const norm = normalizeCompanyName(rawName);
    if (!norm) return null;
    let found = list.find((item) => normalizeCompanyName(item[key]) === norm);
    if (!found) {
        found = list.find((item) => {
            const candidate = normalizeCompanyName(item[key]);
            return candidate && (candidate.includes(norm) || norm.includes(candidate));
        });
    }
    return found || null;
}

async function getOrCreateCustomer(rawName, cache) {
    const found = matchByName(cache.customers, 'companyName', rawName);
    if (found) return found;
    const norm = normalizeCompanyName(rawName);
    const created = await prisma.customer.create({
        data: {
            customerCode: `LEDGER-${crypto.createHash('sha1').update(norm).digest('hex').slice(0, 10).toUpperCase()}`,
            companyName: rawName,
            isActive: true,
        },
        select: { id: true, companyName: true },
    });
    cache.customers.push(created);
    cache.createdCustomers++;
    return created;
}

async function getOrCreateSupplier(rawName, cache) {
    const found = matchByName(cache.suppliers, 'supplierName', rawName);
    if (found) return found;
    const created = await prisma.supplier.create({
        data: {
            supplierName: rawName,
            isActive: true,
        },
        select: { id: true, supplierName: true },
    });
    cache.suppliers.push(created);
    cache.createdSuppliers++;
    return created;
}

async function getOrCreateProduct(rawName, cache) {
    const productName = String(rawName || '').trim();
    const productCode = normalizeProductCode(productName);
    if (!productName || !productCode) return null;
    let found = cache.productsByCode.get(productCode);
    if (found) return found;
    found = await prisma.product.upsert({
        where: { productCode },
        update: { productName },
        create: { productCode, productName, isActive: true },
        select: { id: true, productCode: true, productName: true },
    });
    cache.productsByCode.set(productCode, found);
    cache.createdOrUpdatedProducts++;
    return found;
}

function parseLedgerRows(filePath, ledgerType, minDate, maxDate) {
    const wb = xlsx.readFile(filePath, { cellDates: false });
    const sheetName = wb.SheetNames[0];
    const rows = xlsx.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null, raw: false });
    const parsed = [];
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const date = parseDate(row?.[0]);
        if (!date) continue;
        if (minDate && date < minDate) continue;
        if (maxDate && date > maxDate) continue;
        const counterpartyName = String(row[1] || '').trim();
        const productName = String(row[2] || '').trim();
        if (!counterpartyName || !productName) continue;
        if (counterpartyName.includes('계') || productName.includes('계')) continue;
        const quantity = parseAmount(row[3]) ?? 0;
        const supplyAmount = parseAmount(row[4]);
        const vatAmount = parseAmount(row[5]);
        const totalAmount = parseAmount(row[6]);
        parsed.push({
            ledgerType,
            sourceFile: path.basename(filePath),
            sourceSheet: sheetName,
            sourceRowNumber: i + 1,
            sourceHash: sourceHash(filePath, sheetName, i + 1, ledgerType),
            transactionDate: date,
            counterpartyName,
            productName,
            quantity,
            supplyAmount,
            vatAmount,
            totalAmount,
            unitPrice: quantity ? Math.round((supplyAmount ?? 0) / quantity) : null,
        });
    }
    return parsed;
}

async function main() {
    if (!fs.existsSync(DATA_DIR)) throw new Error(`data dir not found: ${DATA_DIR}`);
    const files = {
        purchase: path.join(DATA_DIR, '매입24-26.xlsx'),
        salesOld: path.join(DATA_DIR, '매출24-26.xlsx'),
        salesNew: path.join(DATA_DIR, '26매출4월부터.xlsx'),
    };
    for (const [key, file] of Object.entries(files)) if (!fs.existsSync(file)) throw new Error(`${key} file not found: ${file}`);

    const salesOldMax = new Date(2026, 2, 31);
    const salesNewMin = new Date(2026, 3, 1);
    const entries = [
        ...parseLedgerRows(files.purchase, 'PURCHASE'),
        ...parseLedgerRows(files.salesOld, 'SALES', null, salesOldMax),
        ...parseLedgerRows(files.salesNew, 'SALES', salesNewMin, null),
    ];

    console.log(`DATA_DIR=${DATA_DIR}`);
    console.log(`Parsed ledger rows: ${entries.length}`);
    const byType = entries.reduce((acc, e) => { acc[e.ledgerType] = (acc[e.ledgerType] || 0) + 1; return acc; }, {});
    console.log(JSON.stringify(byType, null, 2));
    console.log(`Date range: ${entries.map(e => isoDate(e.transactionDate)).sort()[0]} ~ ${entries.map(e => isoDate(e.transactionDate)).sort().at(-1)}`);

    if (!APPLY) {
        console.log('[DRY RUN] 실제 저장 안 함. 적용하려면 --apply 사용');
        return;
    }

    if (REPLACE) {
        const deleted = await prisma.ledgerEntry.deleteMany({ where: { sourceType: SOURCE_TYPE } });
        console.log(`Deleted existing ${SOURCE_TYPE}: ${deleted.count}`);
    }

    const [customers, suppliers, products] = await Promise.all([
        prisma.customer.findMany({ select: { id: true, companyName: true } }),
        prisma.supplier.findMany({ select: { id: true, supplierName: true } }),
        prisma.product.findMany({ select: { id: true, productCode: true, productName: true } }),
    ]);
    const cache = {
        customers,
        suppliers,
        productsByCode: new Map(products.map((p) => [p.productCode, p])),
        createdCustomers: 0,
        createdSuppliers: 0,
        createdOrUpdatedProducts: 0,
    };

    let saved = 0;
    let skipped = 0;
    for (const entry of entries) {
        const exists = await prisma.ledgerEntry.findUnique({ where: { sourceHash: entry.sourceHash }, select: { id: true } });
        if (exists) { skipped++; continue; }
        const product = await getOrCreateProduct(entry.productName, cache);
        const customer = entry.ledgerType === 'SALES' ? await getOrCreateCustomer(entry.counterpartyName, cache) : null;
        const supplier = entry.ledgerType === 'PURCHASE' ? await getOrCreateSupplier(entry.counterpartyName, cache) : null;
        await prisma.ledgerEntry.create({
            data: {
                ledgerType: entry.ledgerType,
                transactionDate: entry.transactionDate,
                customerId: customer?.id ?? null,
                supplierId: supplier?.id ?? null,
                counterpartyName: entry.counterpartyName,
                productId: product?.id ?? null,
                productCode: product?.productCode ?? null,
                productName: entry.productName,
                quantity: entry.quantity,
                unit: 'TON',
                unitPrice: entry.unitPrice,
                supplyAmount: entry.supplyAmount,
                vatAmount: entry.vatAmount,
                totalAmount: entry.totalAmount,
                sourceType: SOURCE_TYPE,
                sourceFile: entry.sourceFile,
                sourceSheet: entry.sourceSheet,
                sourceRowNumber: entry.sourceRowNumber,
                sourceHash: entry.sourceHash,
            },
        });
        saved++;
        if (saved % 500 === 0) console.log(`saved ${saved}/${entries.length}`);
    }

    console.log(JSON.stringify({ saved, skipped, createdCustomers: cache.createdCustomers, createdSuppliers: cache.createdSuppliers, createdOrUpdatedProducts: cache.createdOrUpdatedProducts }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
