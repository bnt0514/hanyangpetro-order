const path = require('path');
const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const inputPath = path.resolve(process.cwd(), process.argv[2] || 'data/한양유화도착지.xlsx');
const outputPath = path.resolve(process.cwd(), process.argv[3] || 'data/한양유화도착지_DB매칭_검토용.xlsx');

const COMPANY_WORDS = [
    '주식회사', '유한회사', '합자회사', '합명회사', '농업회사법인', '어업회사법인', '사회복지법인',
    '의료법인', '재단법인', '사단법인', '학교법인',
];

function cleanText(value) {
    return String(value ?? '')
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, ' ');
}

function normalizeName(value) {
    let text = cleanText(value).toLowerCase();
    text = text
        .replace(/[㈜]/g, '주')
        .replace(/\((주|유|재|사)\)/g, '')
        .replace(/（(주|유|재|사)）/g, '')
        .replace(/\b(주|유)\b/g, '')
        .replace(/[\[\]{}()（）.,·ㆍ\-_/\\&㈜]/g, '')
        .replace(/\s+/g, '');

    for (const word of COMPANY_WORDS) {
        if (text.length > word.length + 2) text = text.replace(new RegExp(word, 'g'), '');
    }
    return text;
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

function phoneDigits(value) {
    return String(value ?? '').replace(/\D/g, '');
}

function bigrams(text) {
    const chars = Array.from(text || '');
    if (chars.length <= 1) return chars;
    const result = [];
    for (let index = 0; index < chars.length - 1; index += 1) result.push(chars[index] + chars[index + 1]);
    return result;
}

function diceSimilarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const aPairs = bigrams(a);
    const bPairs = bigrams(b);
    const counts = new Map();
    for (const pair of aPairs) counts.set(pair, (counts.get(pair) || 0) + 1);
    let intersection = 0;
    for (const pair of bPairs) {
        const count = counts.get(pair) || 0;
        if (count > 0) {
            intersection += 1;
            counts.set(pair, count - 1);
        }
    }
    return (2 * intersection) / (aPairs.length + bPairs.length);
}

function bestTextScore(source, targets, exactPoints, containsPoints, highPoints, midPoints, lowPoints, label) {
    let best = { score: 0, reason: '', similarity: 0, matchedText: '' };
    if (!source) return best;

    for (const target of targets.filter(Boolean)) {
        if (!target) continue;
        let score = 0;
        let reason = '';
        const similarity = diceSimilarity(source, target);

        if (source === target) {
            score = exactPoints;
            reason = `${label} 정확 일치`;
        } else if (source.length >= 3 && target.length >= 3 && (source.includes(target) || target.includes(source))) {
            score = containsPoints;
            reason = `${label} 부분 일치`;
        } else if (similarity >= 0.86) {
            score = highPoints;
            reason = `${label} 매우 유사`;
        } else if (similarity >= 0.72) {
            score = midPoints;
            reason = `${label} 유사`;
        } else if (similarity >= 0.58) {
            score = lowPoints;
            reason = `${label} 약간 유사`;
        }

        if (score > best.score) best = { score, reason, similarity, matchedText: target };
    }
    return best;
}

function classifyCandidate(row, candidate) {
    const reasons = [];
    const sourceName = normalizeName(row.destinationName);
    const sourceAddress = normalizeAddress(row.address);
    const sourcePhone = phoneDigits(row.phone);

    const customerName = normalizeName(candidate.customerName);
    const addressLabel = normalizeName(candidate.addressLabel);
    const addressLine = normalizeAddress(candidate.addressLine1);
    const contactPhone = phoneDigits(candidate.contactPhone);

    const nameScore = bestTextScore(
        sourceName,
        [customerName, addressLabel],
        62,
        52,
        48,
        36,
        24,
        '명칭',
    );
    if (nameScore.reason) reasons.push(nameScore.reason);

    const addressScore = bestTextScore(
        sourceAddress,
        [addressLine],
        28,
        22,
        18,
        12,
        6,
        '주소',
    );
    if (addressScore.reason) reasons.push(addressScore.reason);

    let phoneScore = 0;
    if (sourcePhone && contactPhone) {
        if (sourcePhone === contactPhone) {
            phoneScore = 18;
            reasons.push('전화번호 정확 일치');
        } else if (sourcePhone.length >= 7 && contactPhone.length >= 7 && (sourcePhone.includes(contactPhone) || contactPhone.includes(sourcePhone))) {
            phoneScore = 10;
            reasons.push('전화번호 부분 일치');
        }
    }

    const score = nameScore.score + addressScore.score + phoneScore;
    return {
        ...candidate,
        score,
        nameSimilarity: Math.round(nameScore.similarity * 1000) / 1000,
        addressSimilarity: Math.round(addressScore.similarity * 1000) / 1000,
        reason: reasons.join(' / ') || '낮은 유사도',
    };
}

function classifyMatch(scoredCandidates) {
    const top = scoredCandidates[0];
    const secondDifferentCustomer = scoredCandidates.find((candidate) => candidate.customerId !== top?.customerId);
    if (!top || top.score < 38) return '미매칭';
    const gap = top.score - (secondDifferentCustomer?.score ?? 0);
    const hasExactName = /명칭 정확 일치/.test(top.reason);
    const hasStrongName = top.score >= 62 && /명칭 (정확|부분|매우 유사)/.test(top.reason);
    const hasSupport = /주소|전화번호/.test(top.reason);

    if (hasExactName && gap >= 10) return '확실한것';
    if (top.score >= 88 && gap >= 12) return '확실한것';
    if (hasStrongName && hasSupport && gap >= 10) return '확실한것';
    if (top.score >= 72 && gap >= 20) return '확실한것';
    return '애매한것';
}

function readSourceRows() {
    const workbook = XLSX.readFile(inputPath);
    const sheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
    return rows
        .map((row, index) => ({
            rowNo: index + 2,
            destinationName: cleanText(row['도착지']),
            address: cleanText(row['주소']),
            phone: cleanText(row['전화번호']),
        }))
        .filter((row) => row.destinationName || row.address || row.phone);
}

async function readCandidates() {
    const customers = await prisma.customer.findMany({
        where: { isActive: true },
        select: {
            id: true,
            customerCode: true,
            companyName: true,
            businessNumber: true,
            addresses: {
                where: { isActive: true },
                select: {
                    id: true,
                    label: true,
                    addressLine1: true,
                    addressLine2: true,
                    contactPhone: true,
                    contactName: true,
                    isDefault: true,
                },
            },
        },
        orderBy: { companyName: 'asc' },
    });

    return customers.flatMap((customer) => {
        if (customer.addresses.length === 0) {
            return [{
                customerId: customer.id,
                customerCode: customer.customerCode,
                customerName: customer.companyName,
                businessNumber: customer.businessNumber ?? '',
                addressId: '',
                addressLabel: '',
                addressLine1: '',
                addressLine2: '',
                contactPhone: '',
                contactName: '',
                isDefault: '',
            }];
        }

        return customer.addresses.map((address) => ({
            customerId: customer.id,
            customerCode: customer.customerCode,
            customerName: customer.companyName,
            businessNumber: customer.businessNumber ?? '',
            addressId: address.id,
            addressLabel: address.label,
            addressLine1: address.addressLine1,
            addressLine2: address.addressLine2 ?? '',
            contactPhone: address.contactPhone ?? '',
            contactName: address.contactName ?? '',
            isDefault: address.isDefault ? 'Y' : '',
        }));
    });
}

function toOutputRow(row, classification, top, candidates) {
    const matched = classification === '미매칭' ? null : top;
    const closeCandidates = candidates
        .slice(0, 5)
        .map((candidate) => `${candidate.score}점 ${candidate.customerCode} ${candidate.customerName}${candidate.addressLabel ? ` / ${candidate.addressLabel}` : ''}`)
        .join('\n');

    return {
        분류: classification,
        엑셀행: row.rowNo,
        원본_도착지: row.destinationName,
        원본_주소: row.address,
        원본_전화번호: row.phone,
        매칭점수: matched?.score ?? top?.score ?? 0,
        매칭근거: matched?.reason ?? '',
        거래처코드: matched?.customerCode ?? '',
        거래처명: matched?.customerName ?? '',
        사업자번호: matched?.businessNumber ?? '',
        도착지명: matched?.addressLabel ?? '',
        도착지주소1: matched?.addressLine1 ?? '',
        도착지주소2: matched?.addressLine2 ?? '',
        도착지전화: matched?.contactPhone ?? '',
        담당자: matched?.contactName ?? '',
        기본도착지: matched?.isDefault ?? '',
        거래처ID: matched?.customerId ?? '',
        도착지ID: matched?.addressId ?? '',
        후보_TOP5: closeCandidates,
        검토결과: '',
        수정_거래처코드: '',
        수정_도착지명: '',
        비고: '',
    };
}

function addSheet(workbook, name, rows) {
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    worksheet['!cols'] = headers.map((header) => ({ wch: Math.min(Math.max(header.length + 4, 12), header === '후보_TOP5' ? 60 : 32) }));
    XLSX.utils.book_append_sheet(workbook, worksheet, name);
}

async function main() {
    const sourceRows = readSourceRows();
    const candidates = await readCandidates();

    const results = sourceRows.map((row) => {
        const scoredCandidates = candidates
            .map((candidate) => classifyCandidate(row, candidate))
            .sort((a, b) => b.score - a.score);
        const [top] = scoredCandidates;
        const classification = classifyMatch(scoredCandidates);
        return toOutputRow(row, classification, top, scoredCandidates);
    });

    const summary = [
        { 항목: '원본 파일', 값: inputPath },
        { 항목: '결과 파일', 값: outputPath },
        { 항목: '원본 행 수', 값: sourceRows.length },
        { 항목: 'DB 매칭 후보 수(거래처×도착지)', 값: candidates.length },
        { 항목: '확실한것', 값: results.filter((row) => row.분류 === '확실한것').length },
        { 항목: '애매한것', 값: results.filter((row) => row.분류 === '애매한것').length },
        { 항목: '미매칭', 값: results.filter((row) => row.분류 === '미매칭').length },
        { 항목: '확실 기준', 값: '고점수 + 2순위와 차이, 또는 명칭 강일치 + 주소/전화 보강' },
        { 항목: '검토 방법', 값: '애매한것/미매칭 시트를 우선 검토하고 검토결과, 수정_* 컬럼에 메모' },
    ];

    const workbook = XLSX.utils.book_new();
    addSheet(workbook, '요약', summary);
    addSheet(workbook, '확실한것', results.filter((row) => row.분류 === '확실한것'));
    addSheet(workbook, '애매한것', results.filter((row) => row.분류 === '애매한것'));
    addSheet(workbook, '미매칭', results.filter((row) => row.분류 === '미매칭'));
    addSheet(workbook, '전체결과', results);

    XLSX.writeFile(workbook, outputPath);

    console.log(`원본 ${sourceRows.length}건, 후보 ${candidates.length}건`);
    console.log(`확실한것 ${summary[4].값}건 / 애매한것 ${summary[5].값}건 / 미매칭 ${summary[6].값}건`);
    console.log(`결과 파일: ${outputPath}`);
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });