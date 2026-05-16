/**
 * import-daily-finance.js
 *
 * 재무일보 엑셀 파일을 읽어 수금(입금)과 지급(출금)을
 * CreditTransaction 테이블에 저장합니다.
 *
 * 사용법:
 *   node scripts/import-daily-finance.js --file "재무일보2026 05월.XLSM" --date "05~11"
 *   node scripts/import-daily-finance.js --file "..." --date "05~11" --apply
 *
 * 옵션:
 *   --file  <경로>   재무일보 파일 경로 (절대경로 or 상대경로)
 *   --date  <범위>   날짜 지정 (예: "01~11", "05~16", "16")
 *   --mode  <모드>   1=입금만, 2=출금만, 3=둘다(기본)
 *   --from  <행번>   입금 시작행 (기본 18)
 *   --apply          실제 DB 저장
 */

const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// ─── 인수 파싱 ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name) {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
}
const APPLY = args.includes('--apply');
const MODE = getArg('--mode') || '3';
const START_ROW_DEP = parseInt(getArg('--from') || '18', 10);
const START_ROW_WIT = parseInt(getArg('--from-wit') || '18', 10);

let filePath = getArg('--file');
const dateSpec = getArg('--date');

if (!filePath || !dateSpec) {
    console.error('사용법: node scripts/import-daily-finance.js --file <경로> --date <날짜범위> [--apply]');
    console.error('예시: node scripts/import-daily-finance.js --file "E:/재무일보2026 05월.XLSM" --date "05~11"');
    process.exit(1);
}

// 상대경로 처리
if (!path.isAbsolute(filePath)) {
    filePath = path.join(process.cwd(), filePath);
}

// ─── 유틸 ─────────────────────────────────────────────────────────────────────
const SKIP_KEYWORDS = ['한양유화', '부국'];
const IGNORE_KEYWORDS = ['소계', '합계', '소 계', '합 계', '입금', '출금', '내용', '금액'];

function normalizeCompanyName(name) {
    if (!name) return '';
    return name
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

function shouldSkip(name) {
    if (!name) return true;
    const lower = name.replace(/\s/g, '').toLowerCase();
    return SKIP_KEYWORDS.some(k => lower.includes(k.replace(/\s/g, '').toLowerCase()));
}

function isIgnore(name) {
    if (!name) return false;
    const lower = name.replace(/\s/g, '');
    return IGNORE_KEYWORDS.some(k => lower.includes(k.replace(/\s/g, '')));
}

function parseAmount(val) {
    if (val === null || val === undefined || val === '') return null;
    const n = parseInt(String(val).replace(/,/g, '').replace(/\s/g, ''), 10);
    return isNaN(n) || n === 0 ? null : n;
}

function toDateObj(val) {
    if (!val) return null;
    if (val instanceof Date) return val;
    // Excel serial number
    if (typeof val === 'number') {
        return xlsx.SSF.parse_date_code ? null : new Date((val - 25569) * 86400 * 1000);
    }
    let s = String(val).trim().replace(/-/g, '.').replace(/\//g, '.');
    if (/^\d{8}$/.test(s)) s = `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}`;
    const m = s.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
    if (m) return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
    return null;
}

// ─── 시트탭 탐색 ──────────────────────────────────────────────────────────────
function findSheetName(wb, spec) {
    const s = spec.trim().replace(/\s/g, '');
    const sheets = wb.SheetNames;

    // 후보 목록 생성
    const candidates = [];
    if (s.includes('~')) {
        const [left, right] = s.split('~');
        const d1 = left.replace(/.*\./, '').padStart(2, '0');
        const d2 = right.replace(/.*\./, '').padStart(2, '0');
        candidates.push(`${d1}~${d2}`, `${parseInt(d1)}~${parseInt(d2)}`, `${d1} ~ ${d2}`);
    } else if (s.includes(',')) {
        candidates.push(s, s.replace(',', ', '));
    } else {
        const dd = s.replace(/.*\./, '').padStart(2, '0');
        candidates.push(dd, String(parseInt(dd)));
    }

    for (const c of candidates) {
        if (sheets.includes(c)) return c;
    }
    for (const c of candidates) {
        const found = sheets.find(sh => sh.includes(c));
        if (found) return found;
    }
    throw new Error(`시트탭을 찾지 못했습니다. 후보=${JSON.stringify(candidates)}, 탭목록=${JSON.stringify(sheets)}`);
}

// ─── SHA-256 sourceRef ────────────────────────────────────────────────────────
function makeSourceRef(fileName, sheetName, rowIdx, txType) {
    const raw = `${path.basename(fileName)}|${sheetName}|${rowIdx}|${txType}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
}

// ─── 거래처 DB 매칭 ───────────────────────────────────────────────────────────
let _allCustomers = null;
let _allSuppliers = null;

async function getAllCustomers() {
    if (!_allCustomers) {
        _allCustomers = await prisma.customer.findMany({ select: { id: true, companyName: true } });
    }
    return _allCustomers;
}

async function getAllSuppliers() {
    if (!_allSuppliers) {
        _allSuppliers = await prisma.supplier.findMany({ select: { id: true, supplierName: true } });
    }
    return _allSuppliers;
}

function matchByName(list, nameKey, rawName) {
    const norm = normalizeCompanyName(rawName);
    let found = list.find(c => normalizeCompanyName(c[nameKey]) === norm);
    if (!found) {
        found = list.find(c =>
            normalizeCompanyName(c[nameKey]).includes(norm) ||
            norm.includes(normalizeCompanyName(c[nameKey]))
        );
    }
    return found || null;
}

// ─── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
    if (!fs.existsSync(filePath)) {
        console.error(`파일을 찾을 수 없습니다: ${filePath}`);
        process.exit(1);
    }

    console.log(`\n재무일보 임포트`);
    console.log(`파일: ${filePath}`);
    console.log(`날짜: ${dateSpec} | 모드: ${MODE} | APPLY: ${APPLY}`);

    const wb = xlsx.readFile(filePath, { cellDates: false });
    const sheetName = findSheetName(wb, dateSpec);
    const ws = wb.Sheets[sheetName];
    console.log(`시트: "${sheetName}"`);

    const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: null });

    // 컬럼 구조 (파이썬 코드 기준, B~K = index 1~10):
    // 입금: B(1)=거래처명, C(2)=금액, F(5)=날짜
    // 출금: D(3)=거래처명, E(4)=금액, G(6)=날짜

    const deposits = [];   // { rowIdx, name, amount, date }
    const withdrawals = []; // { rowIdx, name, amount, date }

    // ── 입금 파싱 ──
    if (MODE === '1' || MODE === '3') {
        for (let i = START_ROW_DEP - 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row) continue;
            const nameRaw = row[1] ? String(row[1]).trim() : null;
            const amtRaw = row[2];
            const dateRaw = row[5];

            if (!nameRaw || isIgnore(nameRaw) || shouldSkip(nameRaw)) continue;
            const amt = parseAmount(amtRaw);
            if (!amt) continue;
            const dt = toDateObj(dateRaw);
            if (!dt) continue;

            deposits.push({ rowIdx: i + 1, name: nameRaw, amount: amt, date: dt });
        }
    }

    // ── 출금 파싱 ──
    if (MODE === '2' || MODE === '3') {
        for (let i = START_ROW_WIT - 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row) continue;
            const nameRaw = row[3] ? String(row[3]).trim() : null;
            const amtRaw = row[4];
            const dateRaw = row[6];

            if (!nameRaw || isIgnore(nameRaw) || shouldSkip(nameRaw)) continue;
            const amt = parseAmount(amtRaw);
            if (!amt) continue;
            const dt = toDateObj(dateRaw);
            if (!dt) continue;

            withdrawals.push({ rowIdx: i + 1, name: nameRaw, amount: amt, date: dt });
        }
    }

    console.log(`\n입금(수금) 건수: ${deposits.length} | 출금(지급) 건수: ${withdrawals.length}`);

    const allCustomers = await getAllCustomers();
    const allSuppliers = await getAllSuppliers();

    // ── 수금 매칭 ──
    let depMatched = 0, depUnmatched = 0, depDup = 0, depSaved = 0;
    const depUnmatchedList = [];

    console.log('\n[수금(입금) 처리]');
    console.log('─'.repeat(80));

    for (const dep of deposits) {
        const sourceRef = makeSourceRef(filePath, sheetName, dep.rowIdx, 'IN');

        // 중복 체크
        const existing = await prisma.creditTransaction.findUnique({ where: { sourceRef } });
        if (existing) { depDup++; continue; }

        const customer = matchByName(allCustomers, 'companyName', dep.name);

        if (!customer) {
            depUnmatched++;
            depUnmatchedList.push(dep);
            console.log(`  ✗ [행${dep.rowIdx}] ${dep.name} → 매칭 실패`);
            continue;
        }

        depMatched++;
        const dateStr = dep.date.toISOString().slice(0, 10);
        console.log(`  ✓ [행${dep.rowIdx}] ${dep.name} → ${customer.companyName}  ${dep.amount.toLocaleString()}원  ${dateStr}`);

        if (APPLY) {
            await prisma.creditTransaction.create({
                data: {
                    customerId: customer.id,
                    txDate: dep.date,
                    txType: 'IN',
                    amount: dep.amount,
                    source: 'FINANCE_IMPORT',
                    sourceRef,
                    memo: `재무일보 수금 (${path.basename(filePath)} / ${sheetName} / 행${dep.rowIdx})`,
                },
            });
            depSaved++;
        }
    }

    // ── 지급 매칭 ──
    let witMatched = 0, witUnmatched = 0, witDup = 0, witSaved = 0;
    const witUnmatchedList = [];

    console.log('\n[지급(출금) 처리]');
    console.log('─'.repeat(80));

    for (const wit of withdrawals) {
        const sourceRef = makeSourceRef(filePath, sheetName, wit.rowIdx, 'PAYMENT');

        const existing = await prisma.creditTransaction.findUnique({ where: { sourceRef } });
        if (existing) { witDup++; continue; }

        const supplier = matchByName(allSuppliers, 'supplierName', wit.name);

        if (!supplier) {
            witUnmatched++;
            witUnmatchedList.push(wit);
            console.log(`  ✗ [행${wit.rowIdx}] ${wit.name} → 매칭 실패`);
            continue;
        }

        witMatched++;
        const dateStr = wit.date.toISOString().slice(0, 10);
        console.log(`  ✓ [행${wit.rowIdx}] ${wit.name} → ${supplier.supplierName}  ${wit.amount.toLocaleString()}원  ${dateStr}`);

        if (APPLY) {
            await prisma.creditTransaction.create({
                data: {
                    supplierId: supplier.id,
                    txDate: wit.date,
                    txType: 'PAYMENT',
                    amount: wit.amount,
                    source: 'FINANCE_IMPORT',
                    sourceRef,
                    memo: `재무일보 지급 (${path.basename(filePath)} / ${sheetName} / 행${wit.rowIdx})`,
                },
            });
            witSaved++;
        }
    }

    // ── 요약 ──
    console.log('\n' + '═'.repeat(80));
    console.log('요약');
    console.log('─'.repeat(80));
    console.log(`수금: 매칭 ${depMatched} | 미매칭 ${depUnmatched} | 중복스킵 ${depDup}${APPLY ? ` | 저장 ${depSaved}` : ''}`);
    console.log(`지급: 매칭 ${witMatched} | 미매칭 ${witUnmatched} | 중복스킵 ${witDup}${APPLY ? ` | 저장 ${witSaved}` : ''}`);

    if (depUnmatchedList.length > 0) {
        console.log('\n[미매칭 수금 거래처 목록]');
        depUnmatchedList.forEach(d =>
            console.log(`  행${d.rowIdx}: ${d.name}  ${d.amount.toLocaleString()}원  ${d.date.toISOString().slice(0, 10)}`)
        );
    }
    if (witUnmatchedList.length > 0) {
        console.log('\n[미매칭 지급 거래처 목록]');
        witUnmatchedList.forEach(w =>
            console.log(`  행${w.rowIdx}: ${w.name}  ${w.amount.toLocaleString()}원  ${w.date.toISOString().slice(0, 10)}`)
        );
    }

    if (!APPLY) {
        console.log('\n💡 실제 저장하려면 --apply 플래그 추가');
    }
}

main()
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
