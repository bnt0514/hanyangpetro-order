// @ts-check
const XLSX = require('xlsx');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const DATA_DIR = path.join(process.cwd(), 'data');
const FILES = ['매출24-26.xlsx', '매입24-26.xlsx'];

function isTotalLabel(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text === '계' || text.includes('합계') || /\s계$/.test(text);
}

async function main() {
    let total = 0;
    for (const fileName of FILES) {
        const filePath = path.join(DATA_DIR, fileName);
        const wb = XLSX.readFile(filePath);
        for (const sheetName of wb.SheetNames) {
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null });
            const rowNumbers = rows
                .map((row, index) => ({ row, rowNumber: index + 1 }))
                .filter(({ row }) => isTotalLabel(row[0]) || isTotalLabel(row[1]) || isTotalLabel(row[2]))
                .map(({ rowNumber }) => rowNumber);

            if (rowNumbers.length === 0) continue;
            const where = { sourceFile: fileName, sourceSheet: sheetName, sourceRowNumber: { in: rowNumbers } };
            const count = await prisma.ledgerEntry.count({ where });
            total += count;
            console.log(`${fileName} / ${sheetName}: 삭제 대상 ${count.toLocaleString('ko-KR')}건`);
            if (APPLY && count > 0) {
                await prisma.ledgerEntry.deleteMany({ where });
            }
        }
    }
    console.log(APPLY ? `✅ 합계행 원장 삭제 완료: ${total.toLocaleString('ko-KR')}건` : `DRY RUN: 삭제 대상 ${total.toLocaleString('ko-KR')}건`);
}

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());