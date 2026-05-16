/**
 * import-opening-balances.js
 *
 * 매출처/매입처 기초잔액 엑셀 파일을 읽어
 * - Customer.openingReceivable / openingReceivableDate
 * - Customer.defaultSalesRepId (매출처잔액 파일의 담당자 기준)
 * - Supplier.openingPayable / openingPayableDate
 * 를 갱신합니다.
 *
 * 사용법:
 *   node scripts/import-opening-balances.js
 *   node scripts/import-opening-balances.js --apply
 */

const path = require('path');
const xlsx = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

function normalizeCompanyName(name) {
  if (!name) return '';
  return String(name)
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

function normalizePersonName(name) {
  return String(name || '').replace(/\s+/g, '').trim();
}

function normalizeAmount(val) {
  if (val === null || val === undefined || val === '') return 0;
  const n = parseInt(String(val).replace(/,/g, '').replace(/\s/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function findByCompanyName(list, key, rawName) {
  const normName = normalizeCompanyName(rawName);
  let item = list.find((x) => normalizeCompanyName(x[key]) === normName);
  if (!item) {
    item = list.find((x) => {
      const candidate = normalizeCompanyName(x[key]);
      return candidate.includes(normName) || normName.includes(candidate);
    });
  }
  return item || null;
}

function findExistingFile(dataDir, preferredName, fallbackIncludes) {
  const preferred = path.join(dataDir, preferredName);
  if (require('fs').existsSync(preferred)) return preferred;

  const files = require('fs').readdirSync(dataDir);
  const found = files.find((file) => fallbackIncludes.every((token) => file.includes(token)) && file.endsWith('.xlsx'));
  if (!found) throw new Error(`파일을 찾지 못했습니다: ${preferredName}`);
  return path.join(dataDir, found);
}

async function importReceivables(filePath, baseDate) {
  console.log('\n=== 매출처 미수금/담당자 기초자료 임포트 ===');
  console.log(`파일: ${filePath}`);
  console.log(`기준일: ${baseDate}`);

  const wb = xlsx.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: null });

  let headerRow = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row?.[0] === '담당자' && row?.[1] === '거래처') {
      headerRow = i;
      break;
    }
  }
  if (headerRow === -1) throw new Error('매출처잔액 파일에서 담당자/거래처 헤더를 찾지 못했습니다.');

  const dataRows = rows.slice(headerRow + 1).filter((row) => row?.[1]);
  const [customers, users] = await Promise.all([
    prisma.customer.findMany({ select: { id: true, companyName: true, businessNumber: true } }),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
  ]);

  let matched = 0;
  let unmatched = 0;
  let repMatched = 0;
  let repUnmatched = 0;
  const unmatchedCustomers = [];
  const unmatchedReps = new Map();
  const updates = [];

  for (const row of dataRows) {
    const repName = String(row[0] || '').trim();
    const rawName = String(row[1] || '').trim();
    const amount = normalizeAmount(row[5]);
    if (!rawName) continue;

    const customer = findByCompanyName(customers, 'companyName', rawName);
    if (!customer) {
      unmatched++;
      unmatchedCustomers.push({ name: rawName, amount, repName });
      continue;
    }

    const rep = users.find((u) => normalizePersonName(u.name) === normalizePersonName(repName));
    if (rep) repMatched++;
    else if (repName) {
      repUnmatched++;
      unmatchedReps.set(repName, (unmatchedReps.get(repName) || 0) + 1);
    }

    matched++;
    updates.push({
      id: customer.id,
      rawName,
      matchedName: customer.companyName,
      amount,
      repName,
      repId: rep?.id || null,
    });
  }

  console.log(`데이터: ${dataRows.length}행`);
  console.log(`거래처 매칭: ${matched}개 | 미매칭: ${unmatched}개`);
  console.log(`담당자 매칭: ${repMatched}개 | 담당자 미매칭: ${repUnmatched}개`);

  console.log('\n[적용 미리보기 상위 20개]');
  updates.slice(0, 20).forEach((u) => {
    console.log(`  ${u.matchedName} ← ${u.rawName} | 담당자: ${u.repName || '-'} | 잔액: ${u.amount.toLocaleString()}`);
  });

  if (unmatchedCustomers.length) {
    console.log('\n[미매칭 매출처]');
    unmatchedCustomers.forEach((u) => console.log(`  ✗ ${u.name} | 담당자: ${u.repName || '-'} | 잔액: ${u.amount.toLocaleString()}`));
  }

  if (unmatchedReps.size) {
    console.log('\n[미매칭 담당자]');
    for (const [name, count] of unmatchedReps.entries()) console.log(`  ✗ ${name}: ${count}건`);
  }

  if (!APPLY) {
    console.log('\n[DRY RUN] --apply 없이 실행 중. 실제 저장 안 됨.');
    return;
  }

  const baseDateObj = new Date(`${baseDate}T00:00:00`);
  let saved = 0;
  for (const u of updates) {
    await prisma.customer.update({
      where: { id: u.id },
      data: {
        openingReceivable: u.amount,
        openingReceivableDate: baseDateObj,
        ...(u.repId ? { defaultSalesRepId: u.repId } : {}),
      },
    });
    saved++;
  }
  console.log(`✅ 매출처 기초잔액/담당자 ${saved}개 저장 완료`);
}

async function importPayables(filePath, baseDate) {
  console.log('\n=== 매입처 미지급금 기초잔액 임포트 ===');
  console.log(`파일: ${filePath}`);
  console.log(`기준일: ${baseDate}`);

  const wb = xlsx.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: null });

  let headerRow = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row?.[1] === '거래처명') {
      headerRow = i;
      break;
    }
  }
  if (headerRow === -1) throw new Error('매입처잔액 파일에서 거래처명 헤더를 찾지 못했습니다.');

  const dataRows = rows.slice(headerRow + 1).filter((row) => row?.[1] && String(row[1]).trim());
  const suppliers = await prisma.supplier.findMany({ select: { id: true, supplierName: true, businessNumber: true } });

  let matched = 0;
  let unmatched = 0;
  const updates = [];
  const unmatchedList = [];

  for (const row of dataRows) {
    const bizNo = String(row[0] || '').replace(/-/g, '').trim();
    const rawName = String(row[1] || '').trim();
    const amount = normalizeAmount(row[3]);
    if (!rawName) continue;

    let supplier = bizNo
      ? suppliers.find((s) => s.businessNumber && s.businessNumber.replace(/-/g, '') === bizNo)
      : null;
    if (!supplier) supplier = findByCompanyName(suppliers, 'supplierName', rawName);

    if (!supplier) {
      unmatched++;
      unmatchedList.push({ bizNo, name: rawName, amount });
      continue;
    }

    matched++;
    updates.push({ id: supplier.id, bizNo, name: rawName, matchedName: supplier.supplierName, amount });
  }

  console.log(`데이터: ${dataRows.length}행`);
  console.log(`매칭: ${matched}개 | 미매칭: ${unmatched}개`);

  console.log('\n[적용 미리보기]');
  updates.forEach((u) => console.log(`  ${u.matchedName} ← ${u.name} | 잔액: ${u.amount.toLocaleString()}`));

  if (unmatchedList.length) {
    console.log('\n[미매칭 매입처]');
    unmatchedList.forEach((u) => console.log(`  ✗ [${u.bizNo}] ${u.name} | 잔액: ${u.amount.toLocaleString()}`));
  }

  if (!APPLY) {
    console.log('\n[DRY RUN] --apply 없이 실행 중. 실제 저장 안 됨.');
    return;
  }

  const baseDateObj = new Date(`${baseDate}T00:00:00`);
  let saved = 0;
  for (const u of updates) {
    await prisma.supplier.update({
      where: { id: u.id },
      data: {
        openingPayable: u.amount,
        openingPayableDate: baseDateObj,
        ...(u.bizNo ? { businessNumber: u.bizNo } : {}),
      },
    });
    saved++;
  }
  console.log(`✅ 매입처 기초잔액 ${saved}개 저장 완료`);
}

async function main() {
  const dataDir = path.join(__dirname, '..', 'data');
  const receivableFile = findExistingFile(dataDir, '5.16기준매출처잔액.xlsx', ['매출처', '잔액']);
  const payableFile = findExistingFile(dataDir, '5.11기준매입처잔액.xlsx', ['매입처', '잔액']);

  await importReceivables(receivableFile, '2026-05-16');
  await importPayables(payableFile, '2026-05-11');

  if (!APPLY) console.log('\n💡 실제 저장하려면: node scripts/import-opening-balances.js --apply');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
