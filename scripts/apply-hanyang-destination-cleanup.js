const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const ROOT = path.resolve(__dirname, '..');
const REFERENCE_FILE = path.join(ROOT, 'data', '한양유화도착지.xlsx');
const APPLY = process.argv.includes('--apply');
const NOW = timestamp();
const OUTPUT_FILE = path.join(ROOT, 'data', `한양유화도착지_DB정리_${APPLY ? '적용결과' : '드라이런'}_${NOW}.xlsx`);

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
        const candidate = { ...ref, nameScore, addressScore, score, exactName, exactAddress, nameContains, addressContains };
        if (!best || candidate.score > best.score) best = candidate;
    }
    return best;
}

function classify(best) {
    if (!best) return '완전 상이';
    if (best.exactName) return '도착지 완전 매칭';
    if (best.exactAddress || best.nameContains || best.addressContains || best.nameScore >= 0.58 || best.addressScore >= 0.76) return '일부 매칭';
    return '완전 상이';
}

function isSafePartial(address, best) {
    if (!best) return false;
    const dbName = normalizeName(address.label);
    const refName = normalizeName(best.refDestination);
    const shortNameLen = Math.min(dbName.length, refName.length);
    return Boolean(
        best.exactAddress
        || best.addressScore >= 0.88
        || best.nameScore >= 0.74
        || (best.nameContains && shortNameLen >= 4)
        || (best.addressContains && best.nameScore >= 0.45)
    );
}

function canonicalKey(customerId, ref) {
    return `${customerId}::${normalizeName(ref.refDestination)}::${normalizeAddress(ref.refAddress)}`;
}

function changedFields(address, ref, nextIsDefault) {
    const changes = [];
    if (address.label !== ref.refDestination) changes.push(`도착지명: ${address.label} -> ${ref.refDestination}`);
    if ((address.addressLine1 ?? '') !== (ref.refAddress ?? '')) changes.push(`주소1: ${address.addressLine1 ?? ''} -> ${ref.refAddress ?? ''}`);
    if ((address.addressLine2 ?? '') !== '') changes.push(`주소2 삭제: ${address.addressLine2}`);
    if ((address.contactPhone ?? '') !== (ref.refPhone ?? '')) changes.push(`전화: ${address.contactPhone ?? ''} -> ${ref.refPhone ?? ''}`);
    if (address.isDefault !== nextIsDefault) changes.push(`기본여부: ${address.isDefault ? 'Y' : 'N'} -> ${nextIsDefault ? 'Y' : 'N'}`);
    return changes.join(' / ');
}

function survivorScore(entry) {
    const address = entry.address;
    const best = entry.best;
    return [
        best.exactName && best.exactAddress ? 1000 : 0,
        best.exactName ? 500 : 0,
        best.exactAddress ? 350 : 0,
        entry.category === '도착지 완전 매칭' ? 200 : 0,
        Math.round(best.addressScore * 100),
        Math.round(best.nameScore * 100),
        address.isDefault ? 40 : 0,
        address._count.orders * 3,
        new Date(address.updatedAt).getTime() / 100000000000,
    ].reduce((sum, value) => sum + value, 0);
}

function rowBase(entry) {
    const a = entry.address;
    const b = entry.best;
    return {
        거래처명: a.customer.companyName,
        거래처코드: a.customer.customerCode,
        DB도착지ID: a.id,
        기존도착지명: a.label,
        기존주소1: a.addressLine1,
        기존주소2: a.addressLine2 ?? '',
        기존전화번호: a.contactPhone ?? '',
        기존기본여부: a.isDefault ? 'Y' : '',
        기존주문수: a._count.orders,
        매칭분류: entry.category,
        한화기준도착지: b?.refDestination ?? '',
        한화기준주소: b?.refAddress ?? '',
        한화기준전화번호: b?.refPhone ?? '',
        이름유사도: b ? Number(b.nameScore.toFixed(3)) : 0,
        주소유사도: b ? Number(b.addressScore.toFixed(3)) : 0,
        종합점수: b ? Number(b.score.toFixed(3)) : 0,
    };
}

function makeSheet(rows) {
    const sheet = xlsx.utils.json_to_sheet(rows);
    sheet['!cols'] = Array.from({ length: 22 }, () => ({ wch: 22 }));
    return sheet;
}

function backupDatabase() {
    const envPath = path.join(ROOT, '.env');
    const env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const match = env.match(/^DATABASE_URL\s*=\s*"?file:(.+?)"?\s*$/m);
    const relativeDb = match?.[1] ?? './prisma/dev.db';
    let dbPath = path.resolve(ROOT, relativeDb);
    if (!fs.existsSync(dbPath)) {
        dbPath = path.resolve(ROOT, 'prisma', relativeDb);
    }
    if (!fs.existsSync(dbPath)) {
        dbPath = path.resolve(ROOT, 'prisma', path.basename(relativeDb));
    }
    if (!fs.existsSync(dbPath)) {
        throw new Error(`SQLite DB 파일을 찾을 수 없습니다: ${relativeDb}`);
    }
    const backupDir = path.join(ROOT, 'backups', 'manual');
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `before-hanyang-destination-cleanup-${NOW}.db`);
    fs.copyFileSync(dbPath, backupPath);
    return backupPath;
}

async function main() {
    const references = loadReferenceRows();
    const addresses = await prisma.deliveryAddress.findMany({
        where: { isActive: true, customer: { isActive: true } },
        include: {
            customer: { select: { companyName: true, customerCode: true } },
            _count: { select: { orders: true } },
        },
        orderBy: [{ customer: { companyName: 'asc' } }, { label: 'asc' }],
    });

    const allEntries = addresses.map((address) => {
        const best = pickBestMatch(address, references);
        const category = classify(best);
        const autoApply = category === '도착지 완전 매칭' || (category === '일부 매칭' && isSafePartial(address, best));
        return { address, best, category, autoApply };
    });

    const applyEntries = allEntries.filter((entry) => entry.autoApply && entry.best);
    const skippedPartial = allEntries.filter((entry) => entry.category === '일부 매칭' && !entry.autoApply);
    const untouchedDifferent = allEntries.filter((entry) => entry.category === '완전 상이');

    const groups = new Map();
    for (const entry of applyEntries) {
        const key = canonicalKey(entry.address.customerId, entry.best);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(entry);
    }

    const updateRows = [];
    const mergeRows = [];
    const groupPlans = [];

    for (const [key, entries] of groups) {
        const sorted = [...entries].sort((a, b) => survivorScore(b) - survivorScore(a));
        const survivor = sorted[0];
        const duplicates = sorted.slice(1);
        const nextIsDefault = survivor.address.isDefault || duplicates.some((entry) => entry.address.isDefault) || false;
        groupPlans.push({ key, survivor, duplicates, nextIsDefault });

        const changes = changedFields(survivor.address, survivor.best, nextIsDefault);
        if (changes) {
            updateRows.push({
                작업: APPLY ? '업데이트 완료' : '업데이트 예정',
                ...rowBase(survivor),
                변경내용: changes,
            });
        }

        for (const dup of duplicates) {
            mergeRows.push({
                작업: APPLY ? '병합삭제 완료' : '병합삭제 예정',
                ...rowBase(dup),
                병합대상ID: survivor.address.id,
                병합대상도착지명: survivor.best.refDestination,
                병합대상주소: survivor.best.refAddress,
                이관주문수: dup.address._count.orders,
            });
        }
    }

    let backupPath = '';
    if (APPLY) {
        backupPath = backupDatabase();
        await prisma.$transaction(async (tx) => {
            for (const plan of groupPlans) {
                const { survivor, duplicates, nextIsDefault } = plan;
                await tx.deliveryAddress.update({
                    where: { id: survivor.address.id },
                    data: {
                        label: survivor.best.refDestination,
                        addressLine1: survivor.best.refAddress,
                        addressLine2: null,
                        contactPhone: survivor.best.refPhone || null,
                        isDefault: nextIsDefault,
                    },
                });

                for (const dup of duplicates) {
                    if (dup.address._count.orders > 0) {
                        await tx.order.updateMany({
                            where: { deliveryAddressId: dup.address.id },
                            data: { deliveryAddressId: survivor.address.id },
                        });
                    }
                    await tx.deliveryAddress.delete({ where: { id: dup.address.id } });
                }
            }

            const affectedCustomerIds = Array.from(new Set(groupPlans.map((plan) => plan.survivor.address.customerId)));
            for (const customerId of affectedCustomerIds) {
                const activeAddresses = await tx.deliveryAddress.findMany({
                    where: { customerId, isActive: true },
                    select: { id: true, isDefault: true, updatedAt: true },
                    orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
                });
                if (activeAddresses.length === 1 && !activeAddresses[0].isDefault) {
                    await tx.deliveryAddress.update({ where: { id: activeAddresses[0].id }, data: { isDefault: true } });
                }
                if (activeAddresses.length > 1 && !activeAddresses.some((address) => address.isDefault)) {
                    await tx.deliveryAddress.update({ where: { id: activeAddresses[0].id }, data: { isDefault: true } });
                }
            }
        }, { timeout: 60000 });
    }

    const workbook = xlsx.utils.book_new();
    const summary = [
        { 항목: '실행모드', 값: APPLY ? 'APPLY' : 'DRY-RUN' },
        { 항목: '기준파일', 값: REFERENCE_FILE },
        { 항목: '백업파일', 값: backupPath },
        { 항목: '활성 DB 도착지 수', 값: addresses.length },
        { 항목: '자동 적용 대상', 값: applyEntries.length },
        { 항목: '업데이트 대상 survivor', 값: updateRows.length },
        { 항목: '병합 삭제 대상', 값: mergeRows.length },
        { 항목: '스킵한 일부매칭(애매함)', 값: skippedPartial.length },
        { 항목: '완전상이 미수정', 값: untouchedDifferent.length },
        { 항목: '일부매칭 자동반영 기준', 값: '주소 정확/강매칭 또는 이름유사도 0.74+ 또는 포함관계 최소 4글자 이상' },
    ];
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(summary), '요약');
    xlsx.utils.book_append_sheet(workbook, makeSheet(updateRows), '업데이트');
    xlsx.utils.book_append_sheet(workbook, makeSheet(mergeRows), '중복병합삭제');
    xlsx.utils.book_append_sheet(workbook, makeSheet(skippedPartial.map((entry) => ({ 작업: '미수정_일부매칭검토필요', ...rowBase(entry) }))), '미수정_일부매칭');
    xlsx.utils.book_append_sheet(workbook, makeSheet(untouchedDifferent.map((entry) => ({ 작업: '미수정_완전상이', ...rowBase(entry) }))), '미수정_완전상이');
    xlsx.writeFile(workbook, OUTPUT_FILE);

    console.log(`모드: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
    console.log(`활성 도착지: ${addresses.length}`);
    console.log(`자동 적용 대상: ${applyEntries.length}`);
    console.log(`업데이트 대상 survivor: ${updateRows.length}`);
    console.log(`병합 삭제 대상: ${mergeRows.length}`);
    console.log(`스킵 일부매칭: ${skippedPartial.length}`);
    console.log(`완전상이 미수정: ${untouchedDifferent.length}`);
    if (backupPath) console.log(`백업: ${backupPath}`);
    console.log(`결과: ${OUTPUT_FILE}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}).finally(async () => {
    await prisma.$disconnect();
});
