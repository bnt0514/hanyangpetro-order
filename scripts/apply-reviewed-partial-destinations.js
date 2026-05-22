const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const ROOT = path.resolve(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const NOW = timestamp();
const OUTPUT_FILE = path.join(ROOT, 'data', `한양유화도착지_검토일부매칭_${APPLY ? '적용결과' : '드라이런'}_${NOW}.xlsx`);

function timestamp() {
    const now = new Date();
    const pad = (v) => String(v).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function normalize(value) {
    return String(value ?? '')
        .replace(/주식\s*회사/g, '')
        .replace(/유한\s*회사/g, '')
        .replace(/\(\s*주\s*\)|㈜|\(\s*유\s*\)|\(\s*사\s*\)|\(\s*합\s*\)|\(\s*재\s*\)/g, '')
        .replace(/[\s()[\]{}<>〈〉,._\-\/\\·•'"`~!@#$%^&*+=:;|?？]/g, '')
        .toLowerCase()
        .trim();
}

function normalizeAddress(value) {
    return String(value ?? '')
        .replace(/특별자치도/g, '')
        .replace(/광역시|특별시|특별자치시/g, '')
        .replace(/경기도/g, '경기')
        .replace(/충청남도/g, '충남')
        .replace(/충청북도/g, '충북')
        .replace(/전라남도/g, '전남')
        .replace(/전라북도/g, '전북')
        .replace(/경상남도/g, '경남')
        .replace(/경상북도/g, '경북')
        .replace(/[\s()[\]{}<>〈〉,._\-\/\\·•'"`~!@#$%^&*+=:;|?？]/g, '')
        .toLowerCase()
        .trim();
}

function key(customerId, label, address) {
    return `${customerId}::${normalize(label)}::${normalizeAddress(address)}`;
}

function latestReviewedFile() {
    const dir = path.join(ROOT, 'data');
    const files = fs.readdirSync(dir)
        .filter((file) => file.includes('DB정리_드라이런') && file.endsWith('.xlsx'))
        .map((file) => ({ file, mtime: fs.statSync(path.join(dir, file)).mtime.getTime() }))
        .sort((a, b) => b.mtime - a.mtime);
    if (files.length === 0) throw new Error('DB정리_드라이런 엑셀 파일을 찾을 수 없습니다.');
    return path.join(dir, files[0].file);
}

function loadReviewedRows(file) {
    const workbook = xlsx.readFile(file);
    const sheet = workbook.Sheets['미수정_일부매칭'] ?? workbook.Sheets['ㄴ_일부매칭'];
    if (!sheet) throw new Error('미수정_일부매칭 시트를 찾을 수 없습니다.');
    return xlsx.utils.sheet_to_json(sheet, { defval: '' })
        .filter((row) => String(row['DB도착지ID'] ?? '').trim() && String(row['한화기준도착지'] ?? '').trim())
        .map((row) => ({
            id: String(row['DB도착지ID']).trim(),
            refDestination: String(row['한화기준도착지']).trim(),
            refAddress: String(row['한화기준주소'] ?? '').trim(),
            refPhone: String(row['한화기준전화번호'] ?? '').trim(),
            sourceRow: row,
        }));
}

function backupDatabase() {
    const env = fs.existsSync(path.join(ROOT, '.env')) ? fs.readFileSync(path.join(ROOT, '.env'), 'utf8') : '';
    const match = env.match(/^DATABASE_URL\s*=\s*"?file:(.+?)"?\s*$/m);
    const relativeDb = match?.[1] ?? './dev.db';
    const candidates = [
        path.resolve(ROOT, relativeDb),
        path.resolve(ROOT, 'prisma', relativeDb),
        path.resolve(ROOT, 'prisma', path.basename(relativeDb)),
    ];
    const dbPath = candidates.find((candidate) => fs.existsSync(candidate));
    if (!dbPath) throw new Error(`SQLite DB 파일을 찾을 수 없습니다: ${relativeDb}`);
    const backupDir = path.join(ROOT, 'backups', 'manual');
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `before-reviewed-partial-destinations-${NOW}.db`);
    fs.copyFileSync(dbPath, backupPath);
    return backupPath;
}

function chooseSurvivor(candidates) {
    return [...candidates].sort((a, b) => {
        const aScore = (a.isTarget ? 1000 : 0) + (a.isDefault ? 100 : 0) + (a.orderCount * 5) + (a.exactCanonical ? 50 : 0);
        const bScore = (b.isTarget ? 1000 : 0) + (b.isDefault ? 100 : 0) + (b.orderCount * 5) + (b.exactCanonical ? 50 : 0);
        return bScore - aScore;
    })[0];
}

function sheet(rows) {
    const ws = xlsx.utils.json_to_sheet(rows);
    ws['!cols'] = Array.from({ length: 18 }, () => ({ wch: 24 }));
    return ws;
}

async function main() {
    const reviewedFile = latestReviewedFile();
    const reviewedRows = loadReviewedRows(reviewedFile);
    const uniqueById = new Map(reviewedRows.map((row) => [row.id, row]));
    const targetIds = [...uniqueById.keys()];

    const targets = await prisma.deliveryAddress.findMany({
        where: { id: { in: targetIds } },
        include: {
            customer: { select: { companyName: true, customerCode: true } },
            _count: { select: { orders: true } },
        },
    });
    const targetMap = new Map(targets.map((address) => [address.id, address]));

    const missingRows = targetIds
        .filter((id) => !targetMap.has(id))
        .map((id) => ({ 작업: '스킵_DB도착지없음', DB도착지ID: id, 한화기준도착지: uniqueById.get(id)?.refDestination ?? '' }));

    const allAddresses = await prisma.deliveryAddress.findMany({
        where: { isActive: true },
        include: {
            customer: { select: { companyName: true, customerCode: true } },
            _count: { select: { orders: true } },
        },
    });

    const allByCanonical = new Map();
    for (const address of allAddresses) {
        const canonical = key(address.customerId, address.label, address.addressLine1);
        if (!allByCanonical.has(canonical)) allByCanonical.set(canonical, []);
        allByCanonical.get(canonical).push(address);
    }

    const groups = new Map();
    for (const row of uniqueById.values()) {
        const target = targetMap.get(row.id);
        if (!target) continue;
        const canonical = key(target.customerId, row.refDestination, row.refAddress);
        if (!groups.has(canonical)) groups.set(canonical, { row, targetCustomerId: target.customerId, entries: [] });
        groups.get(canonical).entries.push({ address: target, row, isTarget: true, exactCanonical: key(target.customerId, target.label, target.addressLine1) === canonical });
    }

    for (const [canonical, group] of groups) {
        const existing = allByCanonical.get(canonical) ?? [];
        for (const address of existing) {
            if (!group.entries.some((entry) => entry.address.id === address.id)) {
                group.entries.push({ address, row: group.row, isTarget: false, exactCanonical: true });
            }
        }
    }

    const updates = [];
    const merges = [];
    const plans = [];

    for (const [canonical, group] of groups) {
        const candidates = group.entries.map((entry) => ({
            ...entry,
            id: entry.address.id,
            isDefault: entry.address.isDefault,
            orderCount: entry.address._count.orders,
        }));
        const survivor = chooseSurvivor(candidates);
        const duplicates = candidates.filter((candidate) => candidate.address.id !== survivor.address.id);
        const shouldBeDefault = survivor.address.isDefault || duplicates.some((dup) => dup.address.isDefault);
        plans.push({ row: group.row, survivor, duplicates, shouldBeDefault });

        updates.push({
            작업: APPLY ? '업데이트 완료' : '업데이트 예정',
            거래처명: survivor.address.customer.companyName,
            거래처코드: survivor.address.customer.customerCode,
            DB도착지ID: survivor.address.id,
            기존도착지명: survivor.address.label,
            기존주소1: survivor.address.addressLine1,
            한화기준도착지: group.row.refDestination,
            한화기준주소: group.row.refAddress,
            한화기준전화번호: group.row.refPhone,
            기존주문수: survivor.address._count.orders,
            기본여부변경: survivor.address.isDefault !== shouldBeDefault ? `${survivor.address.isDefault ? 'Y' : 'N'} -> ${shouldBeDefault ? 'Y' : 'N'}` : '',
            중복병합수: duplicates.length,
        });

        for (const dup of duplicates) {
            merges.push({
                작업: APPLY ? '병합삭제 완료' : '병합삭제 예정',
                거래처명: dup.address.customer.companyName,
                거래처코드: dup.address.customer.customerCode,
                삭제도착지ID: dup.address.id,
                삭제도착지명: dup.address.label,
                삭제주소1: dup.address.addressLine1,
                이관주문수: dup.address._count.orders,
                병합대상ID: survivor.address.id,
                병합대상도착지명: group.row.refDestination,
                병합대상주소: group.row.refAddress,
            });
        }
    }

    let backupPath = '';
    if (APPLY) {
        backupPath = backupDatabase();
        await prisma.$transaction(async (tx) => {
            for (const plan of plans) {
                await tx.deliveryAddress.update({
                    where: { id: plan.survivor.address.id },
                    data: {
                        label: plan.row.refDestination,
                        addressLine1: plan.row.refAddress,
                        addressLine2: null,
                        contactPhone: plan.row.refPhone || null,
                        isDefault: plan.shouldBeDefault,
                    },
                });
                for (const dup of plan.duplicates) {
                    if (dup.address._count.orders > 0) {
                        await tx.order.updateMany({ where: { deliveryAddressId: dup.address.id }, data: { deliveryAddressId: plan.survivor.address.id } });
                    }
                    await tx.deliveryAddress.delete({ where: { id: dup.address.id } });
                }
            }
            const customerIds = [...new Set(plans.map((plan) => plan.survivor.address.customerId))];
            for (const customerId of customerIds) {
                const addresses = await tx.deliveryAddress.findMany({ where: { customerId, isActive: true }, select: { id: true, isDefault: true, updatedAt: true }, orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }] });
                if (addresses.length > 0 && !addresses.some((address) => address.isDefault)) {
                    await tx.deliveryAddress.update({ where: { id: addresses[0].id }, data: { isDefault: true } });
                }
            }
        }, { timeout: 60000 });
    }

    const wb = xlsx.utils.book_new();
    const summary = [
        { 항목: '실행모드', 값: APPLY ? 'APPLY' : 'DRY-RUN' },
        { 항목: '검토파일', 값: reviewedFile },
        { 항목: '검토 행 수', 값: reviewedRows.length },
        { 항목: 'DB 존재 대상', 값: targets.length },
        { 항목: 'DB 미존재 스킵', 값: missingRows.length },
        { 항목: '업데이트 그룹', 값: updates.length },
        { 항목: '중복 병합삭제', 값: merges.length },
        { 항목: '백업파일', 값: backupPath },
    ];
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(summary), '요약');
    xlsx.utils.book_append_sheet(wb, sheet(updates), '업데이트');
    xlsx.utils.book_append_sheet(wb, sheet(merges), '중복병합삭제');
    xlsx.utils.book_append_sheet(wb, sheet(missingRows), '스킵');
    xlsx.writeFile(wb, OUTPUT_FILE);

    console.log(`모드: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
    console.log(`검토파일: ${reviewedFile}`);
    console.log(`검토 행 수: ${reviewedRows.length}`);
    console.log(`DB 존재 대상: ${targets.length}`);
    console.log(`DB 미존재 스킵: ${missingRows.length}`);
    console.log(`업데이트 그룹: ${updates.length}`);
    console.log(`중복 병합삭제: ${merges.length}`);
    if (backupPath) console.log(`백업: ${backupPath}`);
    console.log(`결과: ${OUTPUT_FILE}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}).finally(async () => {
    await prisma.$disconnect();
});
