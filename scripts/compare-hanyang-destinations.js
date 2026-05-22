const path = require('path');
const xlsx = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const ROOT = path.resolve(__dirname, '..');
const REFERENCE_FILE = path.join(ROOT, 'data', '한양유화도착지.xlsx');
const OUTPUT_FILE = path.join(ROOT, 'data', `한양유화도착지_DB비교_검토용_${timestamp()}.xlsx`);

function timestamp() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function normalizeCompanyForm(value) {
    return String(value ?? '')
        .replace(/주식\s*회사/g, '')
        .replace(/\(\s*주\s*\)|㈜|\(\s*유\s*\)|\(\s*사\s*\)|\(\s*합\s*\)|\(\s*재\s*\)/g, '')
        .replace(/유한\s*회사/g, '')
        .replace(/\s+/g, '')
        .trim();
}

function normalizeName(value) {
    return normalizeCompanyForm(value)
        .toLowerCase()
        .replace(/[\[\]{}()（）<>〈〉,._\-\/\\·•'"`~!@#$%^&*+=:;|?？]/g, '')
        .replace(/공장|본사|창고|물류센터|사업장|지점|인도처/g, '')
        .trim();
}

function normalizeAddress(value) {
    return String(value ?? '')
        .toLowerCase()
        .replace(/특별자치도/g, '')
        .replace(/광역시|특별시|특별자치시/g, '')
        .replace(/경기도/g, '경기')
        .replace(/충청남도/g, '충남')
        .replace(/충청북도/g, '충북')
        .replace(/전라남도/g, '전남')
        .replace(/전라북도/g, '전북')
        .replace(/경상남도/g, '경남')
        .replace(/경상북도/g, '경북')
        .replace(/강원도/g, '강원')
        .replace(/제주도/g, '제주')
        .replace(/[\s,._\-\/\\·•()（）]/g, '')
        .trim();
}

function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a) return b.length;
    if (!b) return a.length;
    const prev = Array.from({ length: b.length + 1 }, (_, index) => index);
    const curr = new Array(b.length + 1);
    for (let i = 1; i <= a.length; i += 1) {
        curr[0] = i;
        for (let j = 1; j <= b.length; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        }
        for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
    }
    return prev[b.length];
}

function similarity(a, b) {
    if (!a && !b) return 1;
    if (!a || !b) return 0;
    const max = Math.max(a.length, b.length);
    return max === 0 ? 1 : 1 - (levenshtein(a, b) / max);
}

function includesEither(a, b) {
    return Boolean(a && b && (a.includes(b) || b.includes(a)));
}

function loadReferenceRows() {
    const workbook = xlsx.readFile(REFERENCE_FILE);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
    return rows
        .map((row, index) => ({
            refNo: index + 1,
            refDestination: String(row['도착지'] ?? '').trim(),
            refAddress: String(row['주소'] ?? '').trim(),
            refPhone: String(row['전화번호'] ?? '').trim(),
        }))
        .filter((row) => row.refDestination);
}

function pickBestMatch(address, references) {
    const dbName = normalizeName(address.label);
    const dbAddress = normalizeAddress([address.addressLine1, address.addressLine2].filter(Boolean).join(' '));

    let best = null;
    for (const ref of references) {
        const refName = normalizeName(ref.refDestination);
        const refAddress = normalizeAddress(ref.refAddress);
        const nameScore = similarity(dbName, refName);
        const addressScore = similarity(dbAddress, refAddress);
        const nameContains = includesEither(dbName, refName);
        const addressContains = includesEither(dbAddress, refAddress);
        const exactName = dbName !== '' && dbName === refName;
        const exactAddress = dbAddress !== '' && dbAddress === refAddress;
        const score = Math.max(
            nameScore,
            addressScore * 0.94,
            nameContains ? 0.86 : 0,
            addressContains ? 0.84 : 0,
            exactName ? 1 : 0,
            exactAddress ? 0.97 : 0,
        );

        const candidate = {
            ...ref,
            nameScore,
            addressScore,
            score,
            exactName,
            exactAddress,
            nameContains,
            addressContains,
        };
        if (!best || candidate.score > best.score) best = candidate;
    }
    return best;
}

function classify(address, best) {
    if (!best) return '완전 상이';
    if (best.exactName) return '도착지 완전 매칭';
    if (best.exactAddress || best.nameContains || best.addressContains || best.nameScore >= 0.58 || best.addressScore >= 0.76) return '일부 매칭';
    return '완전 상이';
}

function buildRow(address, best, category) {
    return {
        분류: category,
        거래처명: address.customer.companyName,
        거래처코드: address.customer.customerCode,
        DB도착지ID: address.id,
        DB도착지명: address.label,
        DB주소1: address.addressLine1,
        DB주소2: address.addressLine2 ?? '',
        DB전화번호: address.contactPhone ?? '',
        DB기본여부: address.isDefault ? 'Y' : '',
        한화기준도착지: best?.refDestination ?? '',
        한화기준주소: best?.refAddress ?? '',
        한화기준전화번호: best?.refPhone ?? '',
        이름유사도: best ? Number(best.nameScore.toFixed(3)) : 0,
        주소유사도: best ? Number(best.addressScore.toFixed(3)) : 0,
        종합점수: best ? Number(best.score.toFixed(3)) : 0,
        검토메모: category === '완전 상이'
            ? '기준 파일과 매칭 후보가 약함. 신규 등록/수동 검토 필요'
            : category === '일부 매칭'
                ? '명칭 또는 주소 일부만 유사. 한화기준도착지로 변경 가능 여부 검토'
                : '도착지명 정규화 기준 완전 일치',
    };
}

function asSheet(rows) {
    const sheet = xlsx.utils.json_to_sheet(rows);
    sheet['!cols'] = [
        { wch: 14 }, { wch: 26 }, { wch: 12 }, { wch: 28 }, { wch: 28 },
        { wch: 38 }, { wch: 24 }, { wch: 16 }, { wch: 10 }, { wch: 30 },
        { wch: 38 }, { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 42 },
    ];
    return sheet;
}

async function main() {
    const references = loadReferenceRows();
    const addresses = await prisma.deliveryAddress.findMany({
        where: { isActive: true, customer: { isActive: true } },
        include: { customer: { select: { companyName: true, customerCode: true } } },
        orderBy: [{ customer: { companyName: 'asc' } }, { label: 'asc' }],
    });

    const rows = addresses.map((address) => {
        const best = pickBestMatch(address, references);
        const category = classify(address, best);
        return buildRow(address, best, category);
    });

    const complete = rows.filter((row) => row['분류'] === '도착지 완전 매칭');
    const partial = rows.filter((row) => row['분류'] === '일부 매칭');
    const different = rows.filter((row) => row['분류'] === '완전 상이');
    const matchedRefNames = new Set([...complete, ...partial].map((row) => normalizeName(row['한화기준도착지'])).filter(Boolean));
    const unusedReferences = references
        .filter((ref) => !matchedRefNames.has(normalizeName(ref.refDestination)))
        .map((ref) => ({
            한화기준순번: ref.refNo,
            한화기준도착지: ref.refDestination,
            한화기준주소: ref.refAddress,
            한화기준전화번호: ref.refPhone,
            메모: '현재 활성 DB 도착지와 완전/일부 매칭되지 않음',
        }));

    const summary = [
        { 항목: '기준 파일', 값: REFERENCE_FILE },
        { 항목: '출력 파일', 값: OUTPUT_FILE },
        { 항목: '한화 기준 도착지 수', 값: references.length },
        { 항목: 'DB 활성 도착지 수', 값: addresses.length },
        { 항목: 'ㄱ. 도착지 완전 매칭', 값: complete.length },
        { 항목: 'ㄴ. 일부 매칭', 값: partial.length },
        { 항목: 'ㄷ. 완전 상이', 값: different.length },
        { 항목: '기준파일 중 DB 매칭 없음', 값: unusedReferences.length },
        { 항목: '분류 기준', 값: '완전=도착지명 정규화 일치 / 일부=주소 일치·포함관계·명칭유사도 0.58+·주소유사도 0.76+ / 상이=그 외' },
    ];

    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(summary), '요약');
    xlsx.utils.book_append_sheet(workbook, asSheet(complete), 'ㄱ_완전매칭');
    xlsx.utils.book_append_sheet(workbook, asSheet(partial), 'ㄴ_일부매칭');
    xlsx.utils.book_append_sheet(workbook, asSheet(different), 'ㄷ_완전상이');
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(unusedReferences), '기준파일_DB매칭없음');
    xlsx.writeFile(workbook, OUTPUT_FILE);

    console.log(`기준 도착지: ${references.length}`);
    console.log(`DB 활성 도착지: ${addresses.length}`);
    console.log(`완전 매칭: ${complete.length}`);
    console.log(`일부 매칭: ${partial.length}`);
    console.log(`완전 상이: ${different.length}`);
    console.log(`기준파일 중 DB 매칭 없음: ${unusedReferences.length}`);
    console.log(`출력: ${OUTPUT_FILE}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}).finally(async () => {
    await prisma.$disconnect();
});
