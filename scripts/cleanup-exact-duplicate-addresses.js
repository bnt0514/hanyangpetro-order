const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const ROOT = path.resolve(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const NOW = timestamp();
const OUTPUT_FILE = path.join(ROOT, 'data', `도착지_완전중복정리_${APPLY ? '적용결과' : '드라이런'}_${NOW}.xlsx`);

function timestamp() {
    const now = new Date();
    const pad = (v) => String(v).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function normalize(value) {
    return String(value ?? '')
        .replace(/주식\s*회사/g, '')
        .replace(/유한\s*회사/g, '')
        .replace(/\(\s*주\s*\)|㈜|\(\s*유\s*\)/g, '')
        .replace(/[\s()[\]{}<>,._\-\/\\·•]/g, '')
        .toLowerCase()
        .trim();
}

function key(row) {
    return `${row.customerId}::${normalize(row.label)}::${normalize(row.addressLine1)}::${normalize(row.addressLine2)}::${normalize(row.contactPhone)}`;
}

function backupDatabase() {
    const env = fs.existsSync(path.join(ROOT, '.env')) ? fs.readFileSync(path.join(ROOT, '.env'), 'utf8') : '';
    const match = env.match(/^DATABASE_URL\s*=\s*"?file:(.+?)"?\s*$/m);
    const relativeDb = match?.[1] ?? './dev.db';
    const candidates = [path.resolve(ROOT, relativeDb), path.resolve(ROOT, 'prisma', relativeDb), path.resolve(ROOT, 'prisma', path.basename(relativeDb))];
    const dbPath = candidates.find((candidate) => fs.existsSync(candidate));
    if (!dbPath) throw new Error(`SQLite DB 파일을 찾을 수 없습니다: ${relativeDb}`);
    const backupDir = path.join(ROOT, 'backups', 'manual');
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `before-exact-duplicate-address-cleanup-${NOW}.db`);
    fs.copyFileSync(dbPath, backupPath);
    return backupPath;
}

function chooseSurvivor(group) {
    return [...group].sort((a, b) => {
        const aScore = (a.isDefault ? 1000 : 0) + a._count.orders * 10 + new Date(a.updatedAt).getTime() / 100000000000;
        const bScore = (b.isDefault ? 1000 : 0) + b._count.orders * 10 + new Date(b.updatedAt).getTime() / 100000000000;
        return bScore - aScore;
    })[0];
}

async function main() {
    const addresses = await prisma.deliveryAddress.findMany({
        where: { isActive: true },
        include: { customer: { select: { companyName: true, customerCode: true } }, _count: { select: { orders: true } } },
    });

    const groups = new Map();
    for (const address of addresses) {
        const groupKey = key(address);
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey).push(address);
    }

    const duplicateGroups = [...groups.values()].filter((group) => group.length > 1);
    const rows = [];
    const plans = [];

    for (const group of duplicateGroups) {
        const survivor = chooseSurvivor(group);
        const duplicates = group.filter((address) => address.id !== survivor.id);
        plans.push({ survivor, duplicates });
        for (const dup of duplicates) {
            rows.push({
                작업: APPLY ? '삭제완료' : '삭제예정',
                거래처명: dup.customer.companyName,
                거래처코드: dup.customer.customerCode,
                삭제도착지ID: dup.id,
                삭제도착지명: dup.label,
                삭제주소1: dup.addressLine1,
                삭제전화번호: dup.contactPhone ?? '',
                이관주문수: dup._count.orders,
                병합대상ID: survivor.id,
                병합대상도착지명: survivor.label,
                병합대상주소: survivor.addressLine1,
            });
        }
    }

    let backupPath = '';
    if (APPLY && rows.length > 0) {
        backupPath = backupDatabase();
        await prisma.$transaction(async (tx) => {
            for (const plan of plans) {
                const shouldDefault = plan.survivor.isDefault || plan.duplicates.some((dup) => dup.isDefault);
                if (plan.survivor.isDefault !== shouldDefault) {
                    await tx.deliveryAddress.update({ where: { id: plan.survivor.id }, data: { isDefault: shouldDefault } });
                }
                for (const dup of plan.duplicates) {
                    if (dup._count.orders > 0) {
                        await tx.order.updateMany({ where: { deliveryAddressId: dup.id }, data: { deliveryAddressId: plan.survivor.id } });
                    }
                    await tx.deliveryAddress.delete({ where: { id: dup.id } });
                }
            }
        }, { timeout: 60000 });
    }

    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet([
        { 항목: '실행모드', 값: APPLY ? 'APPLY' : 'DRY-RUN' },
        { 항목: '완전중복 그룹', 값: duplicateGroups.length },
        { 항목: '삭제 대상', 값: rows.length },
        { 항목: '백업파일', 값: backupPath },
    ]), '요약');
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(rows), '중복삭제');
    xlsx.writeFile(wb, OUTPUT_FILE);

    console.log(`모드: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
    console.log(`완전중복 그룹: ${duplicateGroups.length}`);
    console.log(`삭제 대상: ${rows.length}`);
    if (backupPath) console.log(`백업: ${backupPath}`);
    console.log(`결과: ${OUTPUT_FILE}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}).finally(async () => {
    await prisma.$disconnect();
});
