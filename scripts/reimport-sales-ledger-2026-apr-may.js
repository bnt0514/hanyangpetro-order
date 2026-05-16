const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');
const DATA_DIR = path.join(process.cwd(), 'data');
const FILE_NAME = fs.readdirSync(DATA_DIR).find((name) => name.startsWith('26') && name.endsWith('.xlsx'));
const FILE_PATH = FILE_NAME ? path.join(DATA_DIR, FILE_NAME) : null;
const START_DATE = new Date(2026, 3, 1);
const END_DATE = new Date(2026, 5, 1);

function normalize(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(value) {
    return normalize(value)
        .replace(/주식회사|유한회사|\(주\)|㈜|주\)/g, '')
        .replace(/[^0-9a-zA-Z가-힣]/g, '')
        .toLowerCase();
}

function parseNumber(value) {
    const text = normalize(value).replace(/,/g, '');
    if (!text || text === '-') return 0;
    const number = Number(text);
    return Number.isFinite(number) ? number : 0;
}

function parseDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    }
    const text = normalize(value);
    const match = text.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function dateIso(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function shortHash(input) {
    return crypto.createHash('sha1').update(input).digest('hex').slice(0, 8).toUpperCase();
}

function sourceHash(entry) {
    return crypto.createHash('sha256').update(JSON.stringify({
        type: 'SALES',
        file: FILE_NAME,
        sheet: entry.sourceSheet,
        row: entry.sourceRowNumber,
        date: dateIso(entry.transactionDate),
        customer: entry.counterpartyName,
        product: entry.productName,
        quantity: entry.quantity,
        supplyAmount: entry.supplyAmount,
        vatAmount: entry.vatAmount,
        totalAmount: entry.totalAmount,
    })).digest('hex');
}

function parseWorkbook() {
    if (!FILE_PATH || !fs.existsSync(FILE_PATH)) throw new Error('Could not find 26*.xlsx in data directory.');

    const workbook = XLSX.readFile(FILE_PATH, { cellDates: true });
    const entries = [];

    for (const sheetName of workbook.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false });
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
            const row = rows[rowIndex];
            const transactionDate = parseDate(row[0]);
            const counterpartyName = normalize(row[1]);
            const productName = normalize(row[2]);
            if (!transactionDate || transactionDate < START_DATE || transactionDate >= END_DATE) continue;
            if (!counterpartyName || !productName) continue;

            const quantity = parseNumber(row[3]);
            const supplyAmount = parseNumber(row[4]);
            const vatAmount = parseNumber(row[5]);
            const totalAmount = parseNumber(row[6]);
            if (quantity === 0 && supplyAmount === 0 && totalAmount === 0) continue;

            entries.push({
                transactionDate,
                counterpartyName,
                productName,
                quantity,
                unitPrice: quantity > 0 ? supplyAmount / quantity : null,
                supplyAmount,
                vatAmount,
                totalAmount,
                sourceSheet: sheetName,
                sourceRowNumber: rowIndex + 1,
            });
        }
    }

    return entries;
}

async function buildMatchers() {
    const [customers, products] = await Promise.all([
        prisma.customer.findMany({ select: { id: true, companyName: true } }),
        prisma.product.findMany({ select: { id: true, productCode: true, productName: true } }),
    ]);

    return {
        customersByKey: new Map(customers.map((customer) => [normalizeKey(customer.companyName), customer])),
        productsByKey: new Map(products.flatMap((product) => [
            [normalizeKey(product.productName), product],
            [normalizeKey(product.productCode), product],
        ])),
    };
}

async function findOrCreateCustomer(db, entry, customersByKey) {
    const key = normalizeKey(entry.counterpartyName);
    const matched = customersByKey.get(key);
    if (matched) return matched.id;

    const customer = await db.customer.create({
        data: {
            customerCode: `SALES-${shortHash(entry.counterpartyName)}`,
            companyName: entry.counterpartyName,
            memo: `${FILE_NAME} sales ledger import auto-created customer`,
        },
        select: { id: true, companyName: true },
    });
    customersByKey.set(key, customer);
    return customer.id;
}

async function findOrCreateProduct(db, entry, productsByKey) {
    const key = normalizeKey(entry.productName);
    const matched = productsByKey.get(key);
    if (matched) return matched;

    const product = await db.product.create({
        data: {
            productCode: `IMP-${shortHash(entry.productName)}`,
            productName: entry.productName,
            memo: `${FILE_NAME} sales ledger import auto-created product`,
        },
        select: { id: true, productCode: true, productName: true },
    });
    productsByKey.set(key, product);
    productsByKey.set(normalizeKey(product.productCode), product);
    return product;
}

function summarize(entries) {
    return entries.reduce((acc, entry) => {
        const month = `${entry.transactionDate.getFullYear()}-${String(entry.transactionDate.getMonth() + 1).padStart(2, '0')}`;
        acc.total.count += 1;
        acc.total.quantity += entry.quantity;
        acc.total.supplyAmount += entry.supplyAmount;
        acc.total.vatAmount += entry.vatAmount;
        acc.total.totalAmount += entry.totalAmount;
        acc.byMonth[month] ||= { count: 0, quantity: 0, supplyAmount: 0, vatAmount: 0, totalAmount: 0 };
        acc.byMonth[month].count += 1;
        acc.byMonth[month].quantity += entry.quantity;
        acc.byMonth[month].supplyAmount += entry.supplyAmount;
        acc.byMonth[month].vatAmount += entry.vatAmount;
        acc.byMonth[month].totalAmount += entry.totalAmount;
        return acc;
    }, { total: { count: 0, quantity: 0, supplyAmount: 0, vatAmount: 0, totalAmount: 0 }, byMonth: {} });
}

async function main() {
    const entries = parseWorkbook();
    const { customersByKey, productsByKey } = await buildMatchers();
    const unmatchedCustomers = new Map();
    const unmatchedProducts = new Map();

    for (const entry of entries) {
        if (!customersByKey.has(normalizeKey(entry.counterpartyName))) unmatchedCustomers.set(entry.counterpartyName, (unmatchedCustomers.get(entry.counterpartyName) || 0) + 1);
        if (!productsByKey.has(normalizeKey(entry.productName))) unmatchedProducts.set(entry.productName, (unmatchedProducts.get(entry.productName) || 0) + 1);
    }

    const existingSales = await prisma.ledgerEntry.aggregate({
        where: { ledgerType: 'SALES', transactionDate: { gte: START_DATE, lt: END_DATE } },
        _count: { _all: true },
        _sum: { quantity: true, supplyAmount: true, vatAmount: true, totalAmount: true },
    });

    console.log('File:', FILE_NAME);
    console.log('Existing Apr-May SALES:', existingSales);
    console.log('Parsed:', JSON.stringify(summarize(entries), null, 2));
    console.log('Customers to auto-create:', Array.from(unmatchedCustomers.entries()));
    console.log('Products to auto-create:', Array.from(unmatchedProducts.entries()));

    if (!APPLY) {
        console.log('Preview only. Use --apply to replace Apr-May sales ledger entries.');
        return;
    }

    const defaultSalesEntity = await prisma.companyEntity.findFirst({ where: { isDefaultSales: true }, select: { id: true } });

    await prisma.$transaction(async (tx) => {
        await tx.ledgerEntry.deleteMany({
            where: { ledgerType: 'SALES', transactionDate: { gte: START_DATE, lt: END_DATE } },
        });

        for (const entry of entries) {
            const customerId = await findOrCreateCustomer(tx, entry, customersByKey);
            const product = await findOrCreateProduct(tx, entry, productsByKey);
            await tx.ledgerEntry.create({
                data: {
                    ledgerType: 'SALES',
                    transactionDate: entry.transactionDate,
                    companyEntityId: defaultSalesEntity?.id ?? null,
                    customerId,
                    counterpartyName: entry.counterpartyName,
                    productId: product.id,
                    productCode: product.productCode,
                    productName: product.productName,
                    quantity: entry.quantity,
                    unit: 'TON',
                    unitPrice: entry.unitPrice,
                    supplyAmount: entry.supplyAmount,
                    vatAmount: entry.vatAmount,
                    totalAmount: entry.totalAmount,
                    memo: `${FILE_NAME} sales ledger reimport`,
                    sourceFile: FILE_NAME,
                    sourceSheet: entry.sourceSheet,
                    sourceRowNumber: entry.sourceRowNumber,
                    sourceHash: sourceHash(entry),
                },
            });
        }
    }, { timeout: 60000 });

    console.log(`Done. Replaced Apr-May SALES with ${entries.length} rows.`);
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
