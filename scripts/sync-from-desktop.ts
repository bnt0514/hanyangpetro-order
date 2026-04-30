/**
 * sync-from-desktop.ts
 *
 * 바탕화면의 두 엑셀 파일을 DB에 직접 동기화합니다.
 *   - 정리된_거래처목록.xlsx  → Customer (upsert by businessNumber)
 *   - 품목명_결과.xlsx        → Product  (upsert by productCode)
 *
 * 실행: npm run sync
 *
 * ※ 파일을 바탕화면에서 수정한 뒤 이 명령만 실행하면 됩니다.
 *   data/ 폴더에 따로 복사할 필요 없습니다.
 */

import path from 'path';
import * as XLSX from 'xlsx';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ── 경로 설정 ───────────────────────────────────────────────
const DESKTOP = path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', 'Desktop');

const CUSTOMERS_FILE = path.join(DESKTOP, '정리된_거래처목록.xlsx');
const PRODUCTS_FILE = path.join(DESKTOP, '품목명_결과.xlsx');

// ── 타입 ────────────────────────────────────────────────────
type SheetRow = (string | number)[];

// ── 유틸 ────────────────────────────────────────────────────
/** 사업자번호: 숫자만 추출, 10자리로 정규화 */
function normalizeBn(raw: string | number): string {
    return String(raw).replace(/\D/g, '').padStart(10, '0');
}

/** 비어있는지 확인 */
function empty(v: string | number): boolean {
    return v === '' || v === null || v === undefined;
}

/** 거래처명 결정: 매칭된 거래처 > 실제 거래처 > 원래 이름 */
function resolveCompanyName(row: SheetRow): string {
    const original = String(row[0] ?? '').trim();
    const matched = String(row[1] ?? '').trim();
    const actual = String(row[2] ?? '').trim();
    return matched || actual || original;
}

// ── 거래처 동기화 ────────────────────────────────────────────
async function syncCustomers() {
    console.log('\n📋 거래처 동기화 중...');

    const wb = XLSX.readFile(CUSTOMERS_FILE);
    const sheetName = wb.SheetNames[0];
    const rows: SheetRow[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
        header: 1,
        defval: '',
    });

    // 헤더 행 건너뜀, 사업자번호 없는 행 제외
    const dataRows = rows.slice(1).filter(r => !empty(r[0]) && !empty(r[3]));

    // 사업자번호 기준으로 그룹핑
    // 같은 사업자번호 = 같은 거래처, 각 행의 원본 거래처명 = 착지(배송 주소 라벨)
    type RowEntry = { label: string; companyName: string; businessNumber: string; customerCode: string };
    const grouped = new Map<string, RowEntry[]>();

    for (const r of dataRows) {
        const bn = normalizeBn(r[3]);
        const entry: RowEntry = {
            label: String(r[0] ?? '').trim(),           // 원본 거래처명 → 착지 라벨
            companyName: resolveCompanyName(r),               // 공식 거래처명
            businessNumber: bn,
            customerCode: String(r[4] || r[5] || r[6] || '').trim(),
        };
        if (!grouped.has(bn)) grouped.set(bn, []);
        grouped.get(bn)!.push(entry);
    }

    let custCreated = 0, custUpdated = 0;
    let addrCreated = 0, addrUpdated = 0;
    let skipped = 0;

    for (const [bn, entries] of grouped) {
        // 첫 번째 항목에서 거래처 대표 정보 추출
        const first = entries[0];
        const code = first.customerCode || `CUS-${bn.slice(-6)}`;

        try {
            // ── 1. 거래처(Customer) upsert ──────────────────────
            let customer = await prisma.customer.findFirst({
                where: { businessNumber: bn },
            });

            if (customer) {
                customer = await prisma.customer.update({
                    where: { id: customer.id },
                    data: {
                        companyName: first.companyName,
                        businessNumber: bn,
                        // 기존 코드가 있으면 유지
                        customerCode: customer.customerCode || code,
                    },
                });
                custUpdated++;
            } else {
                const codeConflict = await prisma.customer.findUnique({ where: { customerCode: code } });
                customer = await prisma.customer.create({
                    data: {
                        customerCode: codeConflict ? `CUS-${bn}` : code,
                        companyName: first.companyName,
                        businessNumber: bn,
                        isActive: true,
                    },
                });
                custCreated++;
            }

            // ── 2. 착지(DeliveryAddress) upsert ─────────────────
            // 행마다 label이 다르면 별도 착지로 등록
            // label 중복 시 업데이트
            const existingAddrs = await prisma.deliveryAddress.findMany({
                where: { customerId: customer.id },
            });
            const addrByLabel = new Map(existingAddrs.map(a => [a.label, a]));

            for (let i = 0; i < entries.length; i++) {
                const { label } = entries[i];
                if (!label) continue;

                const isDefault = i === 0; // 첫 번째 착지를 기본 착지로

                const existingAddr = addrByLabel.get(label);
                if (existingAddr) {
                    // 라벨 동일 → 업데이트 (addressLine1도 라벨로 채움)
                    await prisma.deliveryAddress.update({
                        where: { id: existingAddr.id },
                        data: { addressLine1: label, isDefault },
                    });
                    addrUpdated++;
                } else {
                    await prisma.deliveryAddress.create({
                        data: {
                            customerId: customer.id,
                            label,
                            addressLine1: label,   // 정확한 주소는 추후 입력
                            isDefault,
                            isActive: true,
                        },
                    });
                    addrCreated++;
                }
            }
        } catch (err) {
            console.warn(`  ⚠ 건너뜀 [사업자번호 ${bn}]: ${(err as Error).message}`);
            skipped++;
        }
    }

    console.log(`  ✅ 거래처: 신규 ${custCreated}개, 업데이트 ${custUpdated}개`);
    console.log(`  ✅ 착지:   신규 ${addrCreated}개, 업데이트 ${addrUpdated}개`);
    if (skipped) console.warn(`  ⚠ 건너뜀: ${skipped}개`);
    console.log(`     (총 처리: ${grouped.size}개 거래처 / ${dataRows.length}행)`);
}

// ── 품목 동기화 ──────────────────────────────────────────────
async function syncProducts() {
    console.log('\n📦 품목 동기화 중...');

    const wb = XLSX.readFile(PRODUCTS_FILE);
    const sheetName = wb.SheetNames[0];
    const rows: SheetRow[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
        header: 1,
        defval: '',
    });

    // 헤더 행 건너뜀 (변환전 / 변환후)
    const dataRows = rows.slice(1).filter(r => !empty(r[0]) && !empty(r[1]));

    let created = 0, updated = 0, skipped = 0;

    for (const row of dataRows) {
        const rawCode = String(row[0]).trim();   // 변환전 (원래 품목코드)
        const productName = String(row[1]).trim();  // 변환후 (표시 품목명)

        // 품목 코드: 숫자만인 경우 앞에 ITEM- 붙여서 구분
        const productCode = /^\d+$/.test(rawCode) ? `ITEM-${rawCode}` : rawCode;

        // 카테고리 추출: 변환후 형식 "EVA<1540>" → "EVA"
        const categoryMatch = productName.match(/^([A-Za-z]+)/);
        const category = categoryMatch ? categoryMatch[1].toUpperCase() : null;

        try {
            const existing = await prisma.product.findUnique({ where: { productCode } });

            if (existing) {
                await prisma.product.update({
                    where: { productCode },
                    data: { productName, category: category ?? existing.category },
                });
                updated++;
            } else {
                await prisma.product.create({
                    data: {
                        productCode,
                        productName,
                        category,
                        isActive: true,
                    },
                });
                created++;
            }
        } catch (err) {
            console.warn(`  ⚠ 건너뜀 [${productCode}]: ${(err as Error).message}`);
            skipped++;
        }
    }

    console.log(`  ✅ 품목: 신규 ${created}개, 업데이트 ${updated}개, 건너뜀 ${skipped}개`);
    console.log(`     (총 처리 시도: ${dataRows.length}개)`);
}

// ── 메인 ────────────────────────────────────────────────────
async function main() {
    console.log('🔄 바탕화면 → DB 동기화 시작');
    console.log(`   파일 위치: ${DESKTOP}`);

    await syncCustomers();
    await syncProducts();

    console.log('\n🎉 동기화 완료!\n');
}

main()
    .catch(e => {
        console.error('❌ 오류:', e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
