const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const DEFAULT_SPREADSHEET_ID = process.env.ORDER_SPREADSHEET_ID || '13NGMp-iNJpRdeR0JlnwS367Xj8VZ5UYlfKc774g3j2w';
const HANWHA_SUPPLIER_NAME = '한화솔루션';
const CANCELLED_STATUSES = new Set(['CANCELLED', 'REJECTED']);
const QUANTITY_EPSILON = 0.0001;

const ORDER_BLOCKS = [
    { block: 'A-H', date: 0, customer: 1, product: 2, quantity: 3, supplier: 4, remark: 7 },
    { block: 'I-P', date: 8, customer: 9, product: 10, quantity: 11, supplier: 12, remark: 15 },
    { block: 'Q-X', date: 16, customer: 17, product: 18, quantity: 19, supplier: 20, remark: 23 },
    { block: 'Y-AB', date: 24, customer: 25, product: 26, quantity: 27, supplier: null, remark: null, baseRemark: '영업팀' },
    { block: 'AE-AH', date: 30, customer: null, fixedCustomer: '영업팀', product: 32, quantity: 33, supplier: 31, remark: null, skipSuppliers: ['사수', '인수'] },
];

const REMARK_OUT_COL = 29; // AD
const REMARK_IN_COL = 35; // AJ

function parseArgs(argv) {
    const args = {
        apply: false,
        createAddresses: false,
        fulfillmentType: 'DIRECT',
        headerRows: 0,
    };

    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--apply') {
            args.apply = true;
        } else if (arg === '--create-addresses') {
            args.createAddresses = true;
        } else if (arg === '--help' || arg === '-h') {
            args.help = true;
        } else if (arg.startsWith('--')) {
            const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
            const next = argv[i + 1];
            if (!next || next.startsWith('--')) {
                args[key] = true;
            } else {
                args[key] = next;
                i += 1;
            }
        }
    }

    return args;
}

function printHelp() {
    console.log(`
Usage:
  node scripts/reconcile-order-sheet.js --date 2026-06-02
  node scripts/reconcile-order-sheet.js --date 2026-06-02 --apply
  node scripts/reconcile-order-sheet.js --date 2026-06-02 --file "C:\\path\\order.xlsx" --sheet "26.06월"
  node scripts/reconcile-order-sheet.js --date 2026-06-02 --spreadsheet-id SHEET_ID --google-credentials "C:\\path\\service-account.json"

Options:
  --date YYYY-MM-DD            대조할 오더 날짜. YYYY.MM.DD, MM.DD도 가능.
  --sheet NAME                 오더시트 탭 이름. 없으면 날짜에서 "26.06월" 형식으로 추정.
  --file PATH                  Google Sheets 대신 로컬 xlsx/xls/csv 파일을 읽음.
  --spreadsheet-id ID          Google Sheets ID. 없으면 ORDER_SPREADSHEET_ID 또는 기존 오더시트 ID 사용.
  --google-credentials PATH    서비스 계정 JSON. 없으면 GOOGLE_APPLICATION_CREDENTIALS 또는 바탕화면\\구글api관련.json 사용.
  --customer-map PATH          거래처 변환표. 기본: 바탕화면\\정리된_거래처목록.xlsx
  --product-map PATH           품목 변환표. 기본: 바탕화면\\품목명_결과.xlsx
  --apply                      누락분 중 매칭 가능한 행을 홈페이지 DB에 실제 생성.
  --create-addresses           --apply 때 도착지가 없으면 원본 거래처명으로 도착지를 생성.
  --fulfillment-type VALUE     DIRECT 또는 WAREHOUSE. 기본 DIRECT.
`);
}

function normalizeText(value) {
    return String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function compactText(value) {
    return normalizeText(value).replace(/\s+/g, '');
}

function normalizeCompanyKey(value) {
    return compactText(value)
        .replace(/주식회사|유한회사|\(주\)|㈜|주\)/g, '')
        .replace(/[()（）[\]{}.,·ㆍ\-_\/\\]/g, '')
        .toLowerCase();
}

function normalizeProductKey(value) {
    return compactText(value)
        .replace(/^\s*(ITEM|IMP)[-_\s]+/i, '')
        .replace(/P\.P/gi, 'PP')
        .replace(/[<>()（）[\]{}.,·ㆍ\-_\/\\]/g, '')
        .toUpperCase();
}

function dateOnly(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dateIso(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDateValue(value, baseDate) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return dateOnly(value);
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        if (value > 10000 && value < 60000) {
            const excelOrigin = new Date(1899, 11, 30);
            excelOrigin.setDate(excelOrigin.getDate() + Math.floor(value));
            return dateOnly(excelOrigin);
        }
    }

    const text = compactText(value);
    if (!text) return null;

    const numeric = Number(text);
    if (Number.isFinite(numeric) && numeric > 10000 && numeric < 60000) {
        return parseDateValue(numeric, baseDate);
    }

    let match = text.match(/^(20\d{2})[./-]?(\d{1,2})[./-]?(\d{1,2})\.?$/);
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));

    match = text.match(/^(\d{2})[./-](\d{1,2})[./-](\d{1,2})\.?$/);
    if (match) return new Date(2000 + Number(match[1]), Number(match[2]) - 1, Number(match[3]));

    match = text.match(/^(\d{1,2})[./-](\d{1,2})\.?$/) || text.match(/^(\d{1,2})월(\d{1,2})일?$/);
    if (match) return new Date(baseDate.getFullYear(), Number(match[1]) - 1, Number(match[2]));

    return null;
}

function parseTargetDate(value) {
    const base = new Date();
    const parsed = parseDateValue(value, base);
    if (!parsed) throw new Error(`날짜 형식을 알 수 없습니다: ${value}`);
    return parsed;
}

function inferSheetName(targetDate) {
    return `${String(targetDate.getFullYear()).slice(2)}.${String(targetDate.getMonth() + 1).padStart(2, '0')}월`;
}

function parseQuantity(value) {
    const text = normalizeText(value).replace(/,/g, '');
    if (!text || text === '-' || text.toLowerCase() === 'nan') return null;
    const number = Number(text);
    if (!Number.isFinite(number)) return null;
    return Number.isInteger(number) ? number : Number(number.toFixed(3));
}

function safeCell(row, index) {
    if (index == null || index < 0) return '';
    const value = row[index];
    const text = normalizeText(value);
    if (!text || text === 'None' || text.toLowerCase() === 'nan') return '';
    return text;
}

function buildMergedRemark(baseRemark, row) {
    const base = normalizeText(baseRemark);
    const extras = [safeCell(row, REMARK_OUT_COL), safeCell(row, REMARK_IN_COL)].filter(Boolean).join(' ');
    if (!extras) return base;
    if (!base) return extras;
    if (extras.includes(base)) return extras;
    return `${base} ${extras}`.trim();
}

function defaultExistingPath(...parts) {
    const target = path.join(...parts);
    return fs.existsSync(target) ? target : null;
}

function firstExistingPath(paths) {
    return paths.find((candidate) => candidate && fs.existsSync(candidate)) ?? null;
}

function readWorkbookRows(filePath, sheetName) {
    const workbook = XLSX.readFile(filePath, { cellDates: true });
    const resolvedSheetName = sheetName && workbook.SheetNames.includes(sheetName) ? sheetName : workbook.SheetNames[0];
    if (!resolvedSheetName) throw new Error(`시트를 찾지 못했습니다: ${filePath}`);
    const worksheet = workbook.Sheets[resolvedSheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: false });
    return { rows, sheetName: resolvedSheetName };
}

function loadCustomerNameMap(filePath) {
    const map = new Map();
    if (!filePath || !fs.existsSync(filePath)) return map;

    const { rows } = readWorkbookRows(filePath);
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

function loadProductNameMap(filePath) {
    const map = new Map([
        [normalizeProductKey('5316OG'), 'LDPE<5316 OG>'],
        [normalizeProductKey('B310'), 'P.P<B310>'],
    ]);
    if (!filePath || !fs.existsSync(filePath)) return map;

    const { rows } = readWorkbookRows(filePath);
    for (const row of rows.slice(1)) {
        const original = normalizeText(row[0]);
        const converted = normalizeText(row[1]);
        if (!original || !converted) continue;
        map.set(normalizeProductKey(original), converted);
        map.set(normalizeProductKey(converted), converted);
    }
    return map;
}

function convertProductName(value, productNameMap) {
    const text = normalizeText(value);
    return productNameMap.get(normalizeProductKey(text)) || text;
}

function convertCustomerName(value, customerNameMap) {
    const text = normalizeText(value);
    return customerNameMap.get(normalizeCompanyKey(text)) || text;
}

function extractOrderRows(rows, targetDate, customerNameMap, productNameMap) {
    const entries = [];
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
            const convertedSupplier = convertCustomerName(supplierName, customerNameMap);

            if (!rawCustomer && !rawProduct && quantity == null) continue;

            entries.push({
                sourceRowNumber: rowIndex + 1,
                sourceBlock: block.block,
                date: targetIso,
                rawCustomer,
                convertedCustomer: convertCustomerName(rawCustomer, customerNameMap),
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

function base64Url(input) {
    return Buffer.from(input).toString('base64url');
}

async function fetchGoogleAccessToken(credentialsPath) {
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
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
    const assertion = `${unsigned}.${signature}`;

    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion,
        }),
    });
    const payload = await response.json();
    if (!response.ok) {
        throw new Error(`Google token 요청 실패: ${payload.error_description || payload.error || response.statusText}`);
    }
    return payload.access_token;
}

async function readGoogleSheetRows({ spreadsheetId, sheetName, credentialsPath }) {
    if (!credentialsPath || !fs.existsSync(credentialsPath)) {
        throw new Error(`Google 서비스 계정 JSON을 찾지 못했습니다: ${credentialsPath || '(empty)'}`);
    }
    const token = await fetchGoogleAccessToken(credentialsPath);
    const quotedSheetName = `'${sheetName.replace(/'/g, "''")}'`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(quotedSheetName)}?majorDimension=ROWS`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const payload = await response.json();
    if (!response.ok) {
        throw new Error(`Google Sheets 읽기 실패: ${payload.error?.message || response.statusText}`);
    }
    return payload.values || [];
}

function findByNormalized(map, value) {
    return map.get(normalizeCompanyKey(value));
}

function findProductByKey(productsByKey, value) {
    return productsByKey.get(normalizeProductKey(value));
}

function findSupplierByName(context, value) {
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
    const [customers, addresses, products, suppliers, companies, users] = await Promise.all([
        prisma.customer.findMany({ where: { isActive: true }, select: { id: true, companyName: true, customerCode: true } }),
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
                defaultSupplierId: true,
                defaultSalesEntityId: true,
                defaultPurchaseEntityId: true,
            },
        }),
        prisma.supplier.findMany({ where: { isActive: true }, select: { id: true, supplierName: true } }),
        prisma.companyEntity.findMany({
            where: { isActive: true },
            select: { id: true, code: true, displayName: true, legalName: true, isDefaultSales: true, isDefaultPurchase: true },
        }),
        prisma.user.findMany({
            where: { isActive: true },
            select: { id: true, name: true, role: true },
            orderBy: [{ role: 'asc' }, { name: 'asc' }],
        }),
    ]);

    const customersByKey = new Map();
    for (const customer of customers) {
        customersByKey.set(normalizeCompanyKey(customer.companyName), customer);
        customersByKey.set(normalizeCompanyKey(customer.customerCode), customer);
    }

    const addressesByCustomer = new Map();
    const addressesByGlobalKey = new Map();
    for (const address of addresses) {
        if (!addressesByCustomer.has(address.customerId)) addressesByCustomer.set(address.customerId, []);
        addressesByCustomer.get(address.customerId).push(address);
        for (const alias of [address.label, address.addressLine1]) {
            const key = normalizeCompanyKey(alias);
            if (key) addressesByGlobalKey.set(key, address);
        }
    }

    const productsByKey = new Map();
    for (const product of products) {
        productsByKey.set(normalizeProductKey(product.productName), product);
        productsByKey.set(normalizeProductKey(product.productCode), product);
    }

    const suppliersByKey = new Map();
    for (const supplier of suppliers) {
        suppliersByKey.set(normalizeCompanyKey(supplier.supplierName), supplier);
    }
    const hanwhaSupplier = suppliers.find((supplier) => normalizeCompanyKey(supplier.supplierName).includes(normalizeCompanyKey(HANWHA_SUPPLIER_NAME)));
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
    const importUser = users.find((user) => user.role === 'ADMIN' || user.role === 'EXECUTIVE') || users[0] || null;

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
        importUser,
    };
}

function resolveEntry(entry, context) {
    let customer = findByNormalized(context.customersByKey, entry.convertedCustomer);
    let address = null;

    const globalAddress = findByNormalized(context.addressesByGlobalKey, entry.rawCustomer)
        || findByNormalized(context.addressesByGlobalKey, entry.convertedCustomer);
    if (!customer && globalAddress) {
        address = globalAddress;
        customer = context.customers.find((candidate) => candidate.id === globalAddress.customerId) || null;
    }

    if (customer) {
        const customerAddresses = context.addressesByCustomer.get(customer.id) || [];
        address = address && address.customerId === customer.id ? address : null;
        address ||= customerAddresses.find((candidate) => normalizeCompanyKey(candidate.label) === normalizeCompanyKey(entry.rawCustomer));
        address ||= customerAddresses.find((candidate) => normalizeCompanyKey(candidate.addressLine1) === normalizeCompanyKey(entry.rawCustomer));
        address ||= customerAddresses.find((candidate) => candidate.isDefault);
        address ||= customerAddresses[0] || null;
    }

    const product = findProductByKey(context.productsByKey, entry.convertedProduct)
        || findProductByKey(context.productsByKey, entry.rawProduct);
    const supplier = findSupplierByName(context, entry.convertedSupplier)
        || findSupplierByName(context, entry.supplierName)
        || (entry.supplierDefaulted ? context.hanwhaSupplier : null);

    const problems = [];
    if (!customer) problems.push('CUSTOMER_NOT_FOUND');
    if (!product) problems.push('PRODUCT_NOT_FOUND');
    if (!supplier) problems.push('SUPPLIER_NOT_FOUND');
    if (entry.quantity == null || entry.quantity <= 0) problems.push('QUANTITY_INVALID');
    if (!address) problems.push('ADDRESS_NOT_FOUND');

    return {
        ...entry,
        customerId: customer?.id || '',
        dbCustomerName: customer?.companyName || '',
        deliveryAddressId: address?.id || '',
        deliveryAddressLabel: address?.label || '',
        productId: product?.id || '',
        dbProductName: product?.productName || '',
        dbProductCode: product?.productCode || '',
        supplierId: supplier?.id || '',
        dbSupplierName: supplier?.supplierName || '',
        problems,
    };
}

function itemExactKey(item) {
    return [
        item.customerId,
        item.productKey,
        Number(item.quantity || 0).toFixed(4),
        item.supplierId || '',
    ].join('|');
}

function itemLooseKey(item) {
    return [
        item.customerId,
        item.productKey,
        Number(item.quantity || 0).toFixed(4),
    ].join('|');
}

async function loadExistingOrderItems(targetDate) {
    const start = dateOnly(targetDate);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const orders = await prisma.order.findMany({
        where: {
            requestedDeliveryDate: { gte: start, lt: end },
            deletedAt: null,
        },
        select: {
            id: true,
            orderNo: true,
            customerId: true,
            status: true,
            orderSource: true,
            customer: { select: { companyName: true } },
            deliveryAddress: { select: { label: true } },
            items: {
                select: {
                    id: true,
                    productId: true,
                    requestedQuantity: true,
                    purchaseSupplierId: true,
                    fulfillmentType: true,
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
        orderSource: order.orderSource,
        customerId: order.customerId,
        customerName: order.customer.companyName,
        deliveryAddressLabel: order.deliveryAddress.label,
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

function reconcile(resolvedEntries, existingItems) {
    const activeItems = existingItems.filter((item) => !item.ignored);

    for (const entry of resolvedEntries) {
        entry.productKey = normalizeProductKey(entry.dbProductName || entry.convertedProduct || entry.rawProduct);
        entry.matchStatus = '';
        entry.matchedOrderNo = '';
        entry.matchedOrderItemId = '';
        entry.matchNote = '';

        if (entry.problems.length > 0) {
            entry.matchStatus = 'UNRESOLVED';
            entry.matchNote = entry.problems.join(', ');
            continue;
        }

        const exact = activeItems.find((item) =>
            !item.used
            && item.customerId === entry.customerId
            && item.productKey === entry.productKey
            && Math.abs(item.quantity - entry.quantity) < QUANTITY_EPSILON
            && (item.supplierId || '') === (entry.supplierId || '')
        );

        if (exact) {
            exact.used = true;
            entry.matchStatus = 'MATCHED';
            entry.matchedOrderNo = exact.orderNo;
            entry.matchedOrderItemId = exact.itemId;
            continue;
        }

        const loose = activeItems.find((item) =>
            !item.used
            && item.customerId === entry.customerId
            && item.productKey === entry.productKey
            && Math.abs(item.quantity - entry.quantity) < QUANTITY_EPSILON
        );

        if (loose) {
            loose.used = true;
            entry.matchStatus = 'SUPPLIER_MISMATCH';
            entry.matchedOrderNo = loose.orderNo;
            entry.matchedOrderItemId = loose.itemId;
            entry.matchNote = `시트 매입처=${entry.dbSupplierName || entry.supplierName}, DB 매입처=${loose.supplierName || '(없음)'}`;
            continue;
        }

        entry.matchStatus = 'MISSING';
    }

    const extraDbItems = activeItems
        .filter((item) => !item.used)
        .map((item) => ({
            orderNo: item.orderNo,
            status: item.orderStatus,
            customerName: item.customerName,
            deliveryAddressLabel: item.deliveryAddressLabel,
            productName: item.productName,
            quantity: item.quantity,
            supplierName: item.supplierName,
            fulfillmentType: item.fulfillmentType,
        }));

    return { rows: resolvedEntries, extraDbItems };
}

async function getNextOrderNo(tx, orderDateIso) {
    const orderDate = new Date(`${orderDateIso}T00:00:00`);
    const prefix = `HY-${String(orderDate.getFullYear()).slice(2)}${String(orderDate.getMonth() + 1).padStart(2, '0')}${String(orderDate.getDate()).padStart(2, '0')}-`;

    let seqRow = await tx.orderSequence.findUnique({ where: { orderDate }, select: { lastSeq: true } });
    if (!seqRow) {
        const lastOrder = await tx.order.findFirst({
            where: { orderNo: { startsWith: prefix } },
            select: { orderNo: true },
            orderBy: { orderNo: 'desc' },
        });
        const seedSeq = lastOrder?.orderNo.match(/-(\d{4})$/)?.[1] ? Number(lastOrder.orderNo.match(/-(\d{4})$/)[1]) : 0;
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

async function createMissingOrders(missingEntries, options, context) {
    const created = [];
    const skipped = [];

    await prisma.$transaction(async (tx) => {
        for (const entry of missingEntries) {
            let deliveryAddressId = entry.deliveryAddressId;
            if (!deliveryAddressId && options.createAddresses) {
                const label = entry.rawCustomer || entry.dbCustomerName;
                const address = await tx.deliveryAddress.create({
                    data: {
                        customerId: entry.customerId,
                        label,
                        addressLine1: label,
                        isDefault: false,
                        isActive: true,
                        memo: '오더시트 자동 입력 시 생성',
                    },
                    select: { id: true, label: true },
                });
                deliveryAddressId = address.id;
                entry.deliveryAddressLabel = address.label;
            }

            if (!deliveryAddressId) {
                skipped.push({ ...entry, createStatus: 'SKIPPED_ADDRESS_NOT_FOUND' });
                continue;
            }

            const product = context.products.find((candidate) => candidate.id === entry.productId);
            const orderNo = await getNextOrderNo(tx, entry.date);
            const salesEntityId = product?.defaultSalesEntityId || context.defaultSalesEntity?.id || null;
            const purchaseEntityId = product?.defaultPurchaseEntityId || context.defaultPurchaseEntity?.id || salesEntityId;
            const memo = [
                '[오더시트 자동 입력]',
                `원본 ${entry.sourceBlock} / ${entry.sourceRowNumber}행`,
                entry.supplierDefaulted ? '매입처 공란 → 한화솔루션 적용' : null,
                entry.remark || null,
            ].filter(Boolean).join(' / ');

            const order = await tx.order.create({
                data: {
                    orderNo,
                    customerId: entry.customerId,
                    deliveryAddressId,
                    requestedByUserId: context.importUser?.id || undefined,
                    salesRepId: context.importUser?.id || undefined,
                    orderSource: 'SPREADSHEET',
                    status: 'REQUESTED',
                    requestedDeliveryDate: new Date(`${entry.date}T00:00:00`),
                    memo,
                    items: {
                        create: {
                            productId: entry.productId,
                            requestedQuantity: entry.quantity,
                            salesEntityId,
                            purchaseEntityId,
                            purchaseSupplierId: entry.supplierId,
                            purchaseSupplierConfirmedAt: entry.supplierId ? new Date() : null,
                            fulfillmentType: options.fulfillmentType,
                            unit: 'TON',
                            memo: entry.remark || null,
                        },
                    },
                    statusHistory: {
                        create: {
                            previousStatus: null,
                            newStatus: 'REQUESTED',
                            changedByUserId: context.importUser?.id || undefined,
                            changeReason: `오더시트 자동 입력 (${entry.sourceBlock} / ${entry.sourceRowNumber}행)`,
                        },
                    },
                },
                include: { items: true },
            });

            await tx.customerProductWhitelist.upsert({
                where: {
                    customerId_productId: {
                        customerId: entry.customerId,
                        productId: entry.productId,
                    },
                },
                update: {
                    lastOrderedAt: new Date(),
                    totalOrderCount: { increment: 1 },
                },
                create: {
                    customerId: entry.customerId,
                    productId: entry.productId,
                    firstOrderedAt: new Date(),
                    lastOrderedAt: new Date(),
                    totalOrderCount: 1,
                    isVisibleInPortal: true,
                },
            });

            created.push({
                ...entry,
                createStatus: 'CREATED',
                createdOrderNo: order.orderNo,
                createdOrderId: order.id,
            });
        }
    }, { timeout: 60000 });

    return { created, skipped };
}

function toReportRow(row) {
    return {
        상태: row.matchStatus,
        비고: row.matchNote,
        날짜: row.date,
        원본행: row.sourceRowNumber,
        구역: row.sourceBlock,
        원본거래처: row.rawCustomer,
        변환거래처: row.convertedCustomer,
        DB거래처: row.dbCustomerName,
        도착지: row.deliveryAddressLabel,
        원본품목: row.rawProduct,
        변환품목: row.convertedProduct,
        DB품목: row.dbProductName,
        수량: row.quantity,
        원본매입처: row.rawSupplier,
        변환매입처: row.convertedSupplier,
        적용매입처: row.supplierName,
        DB매입처: row.dbSupplierName,
        매입처기본값적용: row.supplierDefaulted ? 'Y' : '',
        매칭오더번호: row.matchedOrderNo,
        문제: row.problems?.join(', ') || '',
        메모: row.remark,
        생성상태: row.createStatus || '',
        생성오더번호: row.createdOrderNo || '',
    };
}

function writeReport({ rows, extraDbItems, outputPath, createdRows, skippedRows }) {
    const workbook = XLSX.utils.book_new();
    const summary = [
        { 항목: '시트 추출 행', 값: rows.length },
        { 항목: '정상 매칭', 값: rows.filter((row) => row.matchStatus === 'MATCHED').length },
        { 항목: '매입처 차이', 값: rows.filter((row) => row.matchStatus === 'SUPPLIER_MISMATCH').length },
        { 항목: '홈페이지 누락', 값: rows.filter((row) => row.matchStatus === 'MISSING').length },
        { 항목: '매칭 불가', 값: rows.filter((row) => row.matchStatus === 'UNRESOLVED').length },
        { 항목: 'DB에만 있는 품목', 값: extraDbItems.length },
        { 항목: '생성 완료', 값: createdRows.length },
        { 항목: '생성 스킵', 값: skippedRows.length },
    ];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summary), '요약');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.map(toReportRow)), '전체대조');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.filter((row) => row.matchStatus === 'MISSING').map(toReportRow)), '홈페이지누락');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.filter((row) => row.matchStatus === 'UNRESOLVED').map(toReportRow)), '매칭불가');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.filter((row) => row.matchStatus === 'SUPPLIER_MISMATCH').map(toReportRow)), '매입처차이');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(extraDbItems), 'DB에만있음');
    if (createdRows.length > 0) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(createdRows.map(toReportRow)), '생성완료');
    if (skippedRows.length > 0) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(skippedRows.map(toReportRow)), '생성스킵');
    XLSX.writeFile(workbook, outputPath);
}

async function main() {
    const args = parseArgs(process.argv);
    if (args.help) {
        printHelp();
        return;
    }
    if (!args.date) throw new Error('--date 값을 입력해 주세요. 예: --date 2026-06-02');

    const targetDate = parseTargetDate(args.date);
    const sheetName = args.sheet || inferSheetName(targetDate);
    const desktop = path.join(os.homedir(), 'Desktop');
    const customerMapPath = args.customerMap || firstExistingPath([
        process.env.ORDER_CUSTOMER_MAP_FILE,
        defaultExistingPath(desktop, '정리된_거래처목록.xlsx'),
        defaultExistingPath(process.cwd(), '새 폴더', '정리된_거래처목록.xlsx'),
        defaultExistingPath(process.cwd(), 'data', '정리된_거래처목록입출금.xlsx'),
    ]);
    const productMapPath = args.productMap || firstExistingPath([
        process.env.ORDER_PRODUCT_MAP_FILE,
        defaultExistingPath(desktop, '품목명_결과.xlsx'),
        defaultExistingPath(process.cwd(), '새 폴더', '품목명_결과.xlsx'),
    ]);

    const customerNameMap = loadCustomerNameMap(customerMapPath);
    const productNameMap = loadProductNameMap(productMapPath);

    let rows;
    let sourceLabel;
    if (args.file) {
        const local = readWorkbookRows(path.resolve(args.file), args.sheet);
        rows = local.rows;
        sourceLabel = `${args.file} / ${local.sheetName}`;
    } else {
        const credentialsPath = args.googleCredentials
            || process.env.GOOGLE_APPLICATION_CREDENTIALS
            || defaultExistingPath(desktop, '구글api관련.json');
        const spreadsheetId = args.spreadsheetId || DEFAULT_SPREADSHEET_ID;
        rows = await readGoogleSheetRows({ spreadsheetId, sheetName, credentialsPath });
        sourceLabel = `Google Sheets ${spreadsheetId} / ${sheetName}`;
    }

    const sourceEntries = extractOrderRows(rows, targetDate, customerNameMap, productNameMap);
    const context = await buildDbContext();
    const resolvedEntries = sourceEntries.map((entry) => resolveEntry(entry, context));
    const existingItems = await loadExistingOrderItems(targetDate);
    const { rows: reconciledRows, extraDbItems } = reconcile(resolvedEntries, existingItems);

    const creatableMissing = reconciledRows.filter((row) => row.matchStatus === 'MISSING');
    let createdRows = [];
    let skippedRows = [];
    if (args.apply) {
        const result = await createMissingOrders(creatableMissing, args, context);
        createdRows = result.created;
        skippedRows = result.skipped;
        for (const created of createdRows) {
            const row = reconciledRows.find((candidate) => candidate.sourceRowNumber === created.sourceRowNumber && candidate.sourceBlock === created.sourceBlock);
            if (row) {
                row.createStatus = created.createStatus;
                row.createdOrderNo = created.createdOrderNo;
            }
        }
        for (const skipped of skippedRows) {
            const row = reconciledRows.find((candidate) => candidate.sourceRowNumber === skipped.sourceRowNumber && candidate.sourceBlock === skipped.sourceBlock);
            if (row) row.createStatus = skipped.createStatus;
        }
    }

    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
    const outputPath = path.join(process.cwd(), 'data', `order-sheet-reconcile_${dateIso(targetDate).replace(/-/g, '')}_${timestamp}${args.apply ? '_apply' : '_preview'}.xlsx`);
    writeReport({ rows: reconciledRows, extraDbItems, outputPath, createdRows, skippedRows });

    const count = (status) => reconciledRows.filter((row) => row.matchStatus === status).length;
    console.log(`오더시트 대조: ${dateIso(targetDate)}`);
    console.log(`소스: ${sourceLabel}`);
    console.log(`거래처 변환표: ${customerMapPath || '(없음)'}`);
    console.log(`품목 변환표: ${productMapPath || '(없음)'}`);
    console.log(`추출 ${reconciledRows.length}건 | 매칭 ${count('MATCHED')}건 | 누락 ${count('MISSING')}건 | 매입처 차이 ${count('SUPPLIER_MISMATCH')}건 | 매칭불가 ${count('UNRESOLVED')}건`);
    if (args.apply) console.log(`생성 ${createdRows.length}건 | 생성 스킵 ${skippedRows.length}건`);
    else console.log('--apply를 붙이면 누락분 중 매칭 가능한 행을 DB에 생성합니다.');
    console.log(`리포트: ${outputPath}`);
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
