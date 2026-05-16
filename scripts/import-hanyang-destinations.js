const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const inputPath = path.resolve(process.cwd(), process.argv[2] || 'data/한양유화도착지_DB매칭_검토용.xlsx');
const reportPath = path.resolve(process.cwd(), process.argv[3] || 'data/한양유화도착지_DB반영_결과.xlsx');

function cleanText(value) {
    return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function normalizeName(value) {
    return cleanText(value)
        .toLowerCase()
        .replace(/[㈜]/g, '주')
        .replace(/\((주|유|재|사)\)/g, '')
        .replace(/（(주|유|재|사)）/g, '')
        .replace(/\b(주|유)\b/g, '')
        .replace(/주식회사|유한회사|합자회사|합명회사/g, '')
        .replace(/[\[\]{}()（）.,·ㆍ\-_/\\&]/g, '')
        .replace(/\s+/g, '');
}

function normalizeAddress(value) {
    return cleanText(value)
        .toLowerCase()
        .replace(/특별자치도|광역시|특별시/g, '')
        .replace(/경기도/g, '경기')
        .replace(/충청남도/g, '충남')
        .replace(/충청북도/g, '충북')
        .replace(/전라남도/g, '전남')
        .replace(/전라북도/g, '전북')
        .replace(/경상남도/g, '경남')
        .replace(/경상북도/g, '경북')
        .replace(/강원도/g, '강원')
        .replace(/[\s,._\-()（）]/g, '');
}

function shouldSkip(row) {
    const review = cleanText(row['검토결과']).toLowerCase();
    return /제외|보류|삭제|skip|no|x/.test(review);
}

function readRows() {
    const workbook = XLSX.readFile(inputPath);
    const targetSheets = ['확실한것', '애매한것', '미매칭'].filter((sheet) => workbook.SheetNames.includes(sheet));
    if (targetSheets.length === 0) throw new Error('반영할 시트(확실한것/애매한것/미매칭)를 찾지 못했습니다.');

    return targetSheets.flatMap((sheet) => XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { defval: '' })
        .map((row) => ({ ...row, 분류: cleanText(row['분류']) || sheet })));
}

async function createCustomerCodeGenerator(tx) {
    const customers = await tx.customer.findMany({ select: { customerCode: true } });
    let maxNumber = 0;
    let bestPrefix = 'CUS-';
    let bestWidth = 6;

    for (const customer of customers) {
        const match = cleanText(customer.customerCode).match(/^(.*?)(\d+)$/);
        if (!match) continue;
        const number = Number(match[2]);
        if (number > maxNumber) {
            maxNumber = number;
            bestPrefix = match[1];
            bestWidth = match[2].length;
        }
    }

    const used = new Set(customers.map((customer) => customer.customerCode));
    return () => {
        let code;
        do {
            maxNumber += 1;
            code = `${bestPrefix}${String(maxNumber).padStart(bestWidth, '0')}`;
        } while (used.has(code));
        used.add(code);
        return code;
    };
}

async function resolveCustomer(tx, row, getNextCode) {
    const classification = cleanText(row['분류']);
    const sourceName = cleanText(row['원본_도착지']);
    const overrideCode = cleanText(row['수정_거래처코드']);
    const matchedId = cleanText(row['거래처ID']);
    const matchedCode = cleanText(row['거래처코드']);

    let customer = null;
    if (overrideCode) customer = await tx.customer.findUnique({ where: { customerCode: overrideCode } });
    if (!customer && matchedId && classification !== '미매칭') customer = await tx.customer.findUnique({ where: { id: matchedId } });
    if (!customer && matchedCode && classification !== '미매칭') customer = await tx.customer.findUnique({ where: { customerCode: matchedCode } });

    if (!customer) {
        const customers = await tx.customer.findMany({ select: { id: true, customerCode: true, companyName: true } });
        const normalizedSource = normalizeName(sourceName);
        customer = customers.find((item) => normalizeName(item.companyName) === normalizedSource) ?? null;
    }

    if (customer) return { customer, createdCustomer: false };

    customer = await tx.customer.create({
        data: {
            customerCode: getNextCode(),
            companyName: sourceName,
            businessNumber: null,
            isActive: true,
            memo: '한양유화 도착지 엑셀 미매칭 신규 등록',
        },
    });
    return { customer, createdCustomer: true };
}

async function upsertAddress(tx, row, customer) {
    const sourceName = cleanText(row['원본_도착지']);
    const sourceAddress = cleanText(row['원본_주소']);
    const sourcePhone = cleanText(row['원본_전화번호']);
    const overrideLabel = cleanText(row['수정_도착지명']);
    const matchedAddressId = cleanText(row['도착지ID']);
    const label = overrideLabel || cleanText(row['도착지명']) || sourceName;
    const addressLine1 = sourceAddress || cleanText(row['도착지주소1']) || label;
    const contactPhone = sourcePhone || cleanText(row['도착지전화']) || null;

    let address = null;
    if (matchedAddressId && cleanText(row['분류']) !== '미매칭') {
        const found = await tx.deliveryAddress.findUnique({ where: { id: matchedAddressId } });
        if (found && found.customerId === customer.id) address = found;
    }

    if (!address) {
        const addresses = await tx.deliveryAddress.findMany({ where: { customerId: customer.id, isActive: true } });
        const normalizedLabel = normalizeName(label);
        const normalizedSourceName = normalizeName(sourceName);
        const normalizedAddress = normalizeAddress(addressLine1);
        address = addresses.find((item) => {
            const itemLabel = normalizeName(item.label);
            const itemAddress = normalizeAddress(item.addressLine1);
            return itemLabel === normalizedLabel
                || itemLabel === normalizedSourceName
                || (normalizedAddress && itemAddress === normalizedAddress);
        }) ?? null;
    }

    if (address) {
        const updated = await tx.deliveryAddress.update({
            where: { id: address.id },
            data: {
                label,
                addressLine1,
                contactPhone,
                isActive: true,
                memo: address.memo || '한양유화 도착지 엑셀 반영',
            },
        });
        return { address: updated, createdAddress: false };
    }

    const addressCount = await tx.deliveryAddress.count({ where: { customerId: customer.id, isActive: true } });
    const created = await tx.deliveryAddress.create({
        data: {
            customerId: customer.id,
            label,
            addressLine1,
            contactPhone,
            isDefault: addressCount === 0,
            isActive: true,
            memo: '한양유화 도착지 엑셀 반영 신규 등록',
        },
    });
    return { address: created, createdAddress: true };
}

function addSheet(workbook, name, rows) {
    const worksheet = XLSX.utils.json_to_sheet(rows);
    if (rows.length > 0) {
        worksheet['!cols'] = Object.keys(rows[0]).map((header) => ({ wch: Math.min(Math.max(header.length + 6, 14), 42) }));
    }
    XLSX.utils.book_append_sheet(workbook, worksheet, name);
}

async function main() {
    if (!fs.existsSync(inputPath)) throw new Error(`엑셀 파일을 찾을 수 없습니다: ${inputPath}`);
    const rows = readRows().filter((row) => !shouldSkip(row));

    const reportRows = [];
    const summary = {
        total: rows.length,
        skipped: readRows().length - rows.length,
        createdCustomers: 0,
        createdAddresses: 0,
        updatedAddresses: 0,
        errors: 0,
    };

    await prisma.$transaction(async (tx) => {
        const getNextCode = await createCustomerCodeGenerator(tx);

        for (const row of rows) {
            try {
                const { customer, createdCustomer } = await resolveCustomer(tx, row, getNextCode);
                const { address, createdAddress } = await upsertAddress(tx, row, customer);

                if (createdCustomer) summary.createdCustomers += 1;
                if (createdAddress) summary.createdAddresses += 1;
                else summary.updatedAddresses += 1;

                reportRows.push({
                    상태: createdCustomer ? '신규거래처+도착지반영' : createdAddress ? '기존거래처+신규도착지' : '기존도착지갱신',
                    분류: row['분류'],
                    원본_도착지: row['원본_도착지'],
                    원본_주소: row['원본_주소'],
                    원본_전화번호: row['원본_전화번호'],
                    거래처코드: customer.customerCode,
                    거래처명: customer.companyName,
                    도착지명: address.label,
                    도착지주소: address.addressLine1,
                    도착지전화: address.contactPhone ?? '',
                    거래처ID: customer.id,
                    도착지ID: address.id,
                    오류: '',
                });
            } catch (error) {
                summary.errors += 1;
                reportRows.push({
                    상태: '오류',
                    분류: row['분류'],
                    원본_도착지: row['원본_도착지'],
                    원본_주소: row['원본_주소'],
                    원본_전화번호: row['원본_전화번호'],
                    거래처코드: '',
                    거래처명: '',
                    도착지명: '',
                    도착지주소: '',
                    도착지전화: '',
                    거래처ID: '',
                    도착지ID: '',
                    오류: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }, { timeout: 60_000 });

    const workbook = XLSX.utils.book_new();
    addSheet(workbook, '요약', [
        { 항목: '반영 대상', 값: summary.total },
        { 항목: '검토결과 제외/보류', 값: summary.skipped },
        { 항목: '신규 거래처', 값: summary.createdCustomers },
        { 항목: '신규 도착지', 값: summary.createdAddresses },
        { 항목: '기존 도착지 갱신', 값: summary.updatedAddresses },
        { 항목: '오류', 값: summary.errors },
        { 항목: '원본 파일', 값: inputPath },
        { 항목: '결과 파일', 값: reportPath },
    ]);
    addSheet(workbook, '반영결과', reportRows);
    XLSX.writeFile(workbook, reportPath);

    console.log(`반영 대상 ${summary.total}건`);
    console.log(`신규 거래처 ${summary.createdCustomers}건 / 신규 도착지 ${summary.createdAddresses}건 / 기존 도착지 갱신 ${summary.updatedAddresses}건 / 오류 ${summary.errors}건`);
    console.log(`결과 파일: ${reportPath}`);
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
