/**
 * Hanyang Petrochemical e-Business OS — Seed Data (SQLite, MVP)
 *
 * Run:  npm run db:seed
 *
 * Default login credentials after seed:
 *   Staff:
 *     ceo@hanyangpetro.com    / hanyang1234
 *     admin@hanyangpetro.com  / hanyang1234
 *     sales1@hanyangpetro.com / hanyang1234
 *     sales2@hanyangpetro.com / hanyang1234
 *   Customer (회사명 / 사업자번호 숫자만):
 *     대성플라스틱(주)  / 1010101010
 *     한솔컴파운드      / 2020202020
 *     동양케미칼        / 3030303030
 *     신성폴리머        / 4040404040
 *     코리아렉신        / 5050505050
 */

import { PrismaClient } from '@prisma/client';
import { hashPassword, normalizeBusinessNumber } from '../src/lib/password';

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Seeding (SQLite)...');

    // ---- Clean (dev only) ----
    await prisma.notificationLog.deleteMany();
    await prisma.erpInputItem.deleteMany();
    await prisma.erpInputBatch.deleteMany();
    await prisma.deliveryReceipt.deleteMany();
    await prisma.shipment.deleteMany();
    await prisma.dispatch.deleteMany();
    await prisma.holdReminder.deleteMany();
    await prisma.orderStatusHistory.deleteMany();
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.customerProductPrice.deleteMany();
    await prisma.customerProductWhitelist.deleteMany();
    await prisma.customerUser.deleteMany();
    await prisma.deliveryAddress.deleteMany();
    await prisma.priceAdjustment.deleteMany();
    await prisma.productPrice.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.product.deleteMany();
    await prisma.supplier.deleteMany();
    await prisma.companyEntity.deleteMany();
    await prisma.user.deleteMany();

    // ---- Staff users (loginId = 한글 이름, password = 한글 이름을 영문 키보드 그대로) ----
    const staffSeeds: Array<{ name: string; loginId: string; password: string; role: string }> = [
        { name: '양희철', loginId: '양희철', password: 'didgmlcjf', role: 'EXECUTIVE' },
        { name: '차성식', loginId: '차성식', password: 'cktjdtlr', role: 'ADMIN' },
        { name: '김승철', loginId: '김승철', password: 'rlatmdcjf', role: 'SALES' },
        { name: '김종철', loginId: '김종철', password: 'rlawhdcjf', role: 'SALES' },
        { name: '이권영', loginId: '이권영', password: 'dlrnjsdud', role: 'SALES' },
        { name: '양희성', loginId: '양희성', password: 'didgmltjd', role: 'SALES' },
    ];
    const staffUsers: Record<string, { id: string; name: string; loginId: string; role: string }> = {};
    for (const s of staffSeeds) {
        const u = await prisma.user.create({
            data: {
                name: s.name,
                loginId: s.loginId,
                passwordHash: await hashPassword(s.password),
                role: s.role,
            },
        });
        staffUsers[s.loginId] = { id: u.id, name: u.name, loginId: u.loginId!, role: u.role };
    }
    // Backwards-compat references used later in the seed for sample orders
    const sales1 = staffUsers['김승철'];
    const sales2 = staffUsers['김종철'];

    // ---- Managed company entities ----
    const hanyangEntity = await prisma.companyEntity.create({
        data: {
            code: 'HANYANG_PETRO',
            displayName: '한양유화',
            legalName: '주식회사 한양유화',
            isDefaultSales: true,
            isDefaultPurchase: true,
            memo: '한화 품목 기본 매입/매출 주체',
        },
    });
    const bntEntity = await prisma.companyEntity.create({
        data: {
            code: 'BNT',
            displayName: '비엔티',
            legalName: '비엔티',
            memo: '타사 품목 기본 매입/매출 주체',
        },
    });

    // ---- Suppliers ----
    const hanwha = await prisma.supplier.create({ data: { supplierName: '한화솔루션', supplierType: 'HANWHA' } });
    await prisma.supplier.create({ data: { supplierName: 'GS폴리머', supplierType: 'DOMESTIC_OTHER' } });
    const sgcg = await prisma.supplier.create({ data: { supplierName: 'SGCG (시노펙)', supplierType: 'IMPORT_DEALER' } });
    const qapco = await prisma.supplier.create({ data: { supplierName: 'QAPCO (카타르)', supplierType: 'IMPORT_DEALER' } });
    const reliance = await prisma.supplier.create({ data: { supplierName: 'Reliance (인도)', supplierType: 'IMPORT_DEALER' } });
    const formosa = await prisma.supplier.create({ data: { supplierName: 'Formosa (대만)', supplierType: 'IMPORT_DEALER' } });

    // ---- Products ----
    const productSeeds = [
        { code: 'EVA-1317', name: 'EVA 1317', category: 'EVA', mfr: '한화', supplierId: hanwha.id, ec: 'EC-EVA1317', cl: 'CL-EVA1317' },
        { code: 'EVA-1540', name: 'EVA 1540', category: 'EVA', mfr: '한화', supplierId: hanwha.id, ec: 'EC-EVA1540', cl: 'CL-EVA1540' },
        { code: 'HDPE-7000F', name: 'HDPE 7000F', category: 'HDPE', mfr: '한화', supplierId: hanwha.id, ec: 'EC-HD7000F', cl: 'CL-HD7000F' },
        { code: 'HDPE-2200J', name: 'HDPE 2200J', category: 'HDPE', mfr: '한화', supplierId: hanwha.id, ec: 'EC-HD2200J', cl: 'CL-HD2200J' },
        { code: 'HDPE-5000S', name: 'HDPE 5000S', category: 'HDPE', mfr: 'QAPCO', supplierId: qapco.id, ec: 'EC-HD5000S', cl: undefined as string | undefined },
        { code: 'HDPE-9450F', name: 'HDPE 9450F', category: 'HDPE', mfr: 'SGCG', supplierId: sgcg.id, ec: 'EC-HD9450F', cl: undefined as string | undefined },
        { code: 'HDPE-F00952', name: 'HDPE F00952', category: 'HDPE', mfr: 'Reliance', supplierId: reliance.id, ec: undefined as string | undefined, cl: undefined as string | undefined },
        { code: 'LDPE-953', name: 'LDPE 953', category: 'LDPE', mfr: '한화', supplierId: hanwha.id, ec: 'EC-LD953', cl: 'CL-LD953' },
        { code: 'LDPE-722', name: 'LDPE 722', category: 'LDPE', mfr: 'Formosa', supplierId: formosa.id, ec: undefined as string | undefined, cl: undefined as string | undefined },
        { code: 'LDPE-2426H', name: 'LDPE 2426H', category: 'LDPE', mfr: 'SGCG', supplierId: sgcg.id, ec: undefined as string | undefined, cl: undefined as string | undefined },
        { code: 'LLDPE-7410', name: 'LLDPE 7410', category: 'LLDPE', mfr: '한화', supplierId: hanwha.id, ec: 'EC-LL7410', cl: 'CL-LL7410' },
        { code: 'LLDPE-218W', name: 'LLDPE 218W', category: 'LLDPE', mfr: 'QAPCO', supplierId: qapco.id, ec: undefined as string | undefined, cl: undefined as string | undefined },
        { code: 'mLLDPE-1018', name: 'mLLDPE 1018', category: 'mLLDPE', mfr: '한화', supplierId: hanwha.id, ec: 'EC-MLL1018', cl: undefined as string | undefined },
        { code: 'mLLDPE-2120', name: 'mLLDPE 2120', category: 'mLLDPE', mfr: 'Formosa', supplierId: formosa.id, ec: undefined as string | undefined, cl: undefined as string | undefined },
    ];

    const products = await Promise.all(
        productSeeds.map((p) =>
            prisma.product.create({
                data: {
                    productCode: p.code,
                    productName: p.name,
                    category: p.category,
                    productGroup: p.category,
                    manufacturer: p.mfr,
                    brand: p.mfr,
                    packagingType: '25kg PP bag',
                    ecountItemCode: p.ec,
                    click2002ItemCode: p.cl,
                    defaultSupplierId: p.supplierId,
                    defaultSalesEntityId: p.mfr.includes('한화') ? hanyangEntity.id : bntEntity.id,
                    defaultPurchaseEntityId: p.mfr.includes('한화') ? hanyangEntity.id : bntEntity.id,
                },
            }),
        ),
    );
    const productByCode = new Map(products.map((p) => [p.productCode, p] as const));

    // ---- Customers + Delivery Addresses ----
    type CustomerSeed = {
        code: string;
        name: string;
        bn: string;
        rep: string;
        creditLimit: number;
        addresses: { label: string; address: string; isDefault?: boolean; contact?: string }[];
        products: string[];
    };

    const customerSeeds: CustomerSeed[] = [
        {
            code: 'C001',
            name: '대성플라스틱(주)',
            bn: '101-01-01010',
            rep: sales1.id,
            creditLimit: 50_000_000,
            addresses: [
                { label: '본사 창고', address: '경기 시흥시 정왕대로 100', isDefault: true, contact: '김창고' },
                { label: '안산 분공장', address: '경기 안산시 단원구 별망로 200', contact: '이공장' },
            ],
            products: ['EVA-1317', 'HDPE-7000F', 'HDPE-2200J'],
        },
        {
            code: 'C002',
            name: '한솔컴파운드',
            bn: '202-02-02020',
            rep: sales1.id,
            creditLimit: 30_000_000,
            addresses: [{ label: '본사', address: '인천 남동구 남동대로 333', isDefault: true }],
            products: ['HDPE-7000F', 'LDPE-953'],
        },
        {
            code: 'C003',
            name: '동양케미칼',
            bn: '303-03-03030',
            rep: sales2.id,
            creditLimit: 80_000_000,
            addresses: [
                { label: '평택 1공장', address: '경기 평택시 포승읍 평택항로 555', isDefault: true },
                { label: '평택 2공장', address: '경기 평택시 포승읍 평택항로 600' },
                { label: '천안 직납지', address: '충남 천안시 서북구 산업단지로 77' },
            ],
            products: ['HDPE-7000F', 'HDPE-2200J', 'LLDPE-7410', 'mLLDPE-1018', 'EVA-1540'],
        },
        {
            code: 'C004',
            name: '신성폴리머',
            bn: '404-04-04040',
            rep: sales2.id,
            creditLimit: 20_000_000,
            addresses: [{ label: '본사', address: '경기 화성시 향남읍 발안공단로 12', isDefault: true }],
            products: ['LDPE-953', 'LLDPE-7410'],
        },
        {
            code: 'C005',
            name: '코리아렉신',
            bn: '505-05-05050',
            rep: sales1.id,
            creditLimit: 60_000_000,
            addresses: [
                { label: '울산 본공장', address: '울산 남구 여천동 산업로 800', isDefault: true },
                { label: '온산 출고지', address: '울산 울주군 온산읍 산암로 100' },
            ],
            products: ['HDPE-5000S', 'HDPE-9450F', 'LDPE-722', 'LLDPE-218W'],
        },
    ];

    const customerRefs: { id: string; name: string; bn: string; addressIds: string[] }[] = [];

    for (const cs of customerSeeds) {
        const customer = await prisma.customer.create({
            data: {
                customerCode: cs.code,
                companyName: cs.name,
                businessNumber: cs.bn,
                defaultSalesRepId: cs.rep,
                creditLimit: cs.creditLimit,
                paymentTerms: '월말 마감 익월 30일',
            },
        });

        const addressIds: string[] = [];
        for (const a of cs.addresses) {
            const addr = await prisma.deliveryAddress.create({
                data: {
                    customerId: customer.id,
                    label: a.label,
                    addressLine1: a.address,
                    isDefault: a.isDefault ?? false,
                    contactName: a.contact,
                },
            });
            addressIds.push(addr.id);
        }

        for (const code of cs.products) {
            const p = productByCode.get(code);
            if (!p) continue;
            await prisma.customerProductWhitelist.create({
                data: {
                    customerId: customer.id,
                    productId: p.id,
                    firstOrderedAt: new Date(Date.now() - 90 * 86400_000),
                    lastOrderedAt: new Date(Date.now() - 7 * 86400_000),
                    totalOrderCount: 3 + Math.floor(Math.random() * 8),
                },
            });
        }

        const defaultPw = await hashPassword(normalizeBusinessNumber(cs.bn));
        await prisma.customerUser.create({
            data: {
                customerId: customer.id,
                email: `default+${customer.id}@portal.local`,
                name: `${cs.name} 발주담당`,
                passwordHash: defaultPw,
            },
        });

        customerRefs.push({ id: customer.id, name: cs.name, bn: cs.bn, addressIds });
    }

    // ---- Sample Orders (DISABLED) ----
    // 데모용 주문 시드는 비활성화. 실제 주문은 UI에서 직접 등록.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    type OrderSeed = {
        cIdx: number;
        aIdx: number;
        productCodes: string[];
        quantities: number[];
        salesRep: string;
        source: string;
        status: string;
        daysAgo: number;
        supplierType?: string;
    };

    const orderSeeds: OrderSeed[] = [
        // 데모 주문 비활성화: 실제 주문은 UI에서 등록
    ];

    const yearMonth = new Date().toISOString().slice(0, 7).replace('-', '');
    let seq = 1;

    for (const o of orderSeeds) {
        const customer = customerRefs[o.cIdx];
        const addressId = customer.addressIds[o.aIdx] ?? customer.addressIds[0];
        const orderNo = `HY${yearMonth}-${String(seq++).padStart(4, '0')}`;
        const createdAt = new Date(Date.now() - o.daysAgo * 86400_000);
        const isShipped = ['SHIPPED', 'ERP_INPUT_WAITING', 'COMPLETED'].includes(o.status);
        const isApproved = !['REQUESTED', 'PENDING_SALES_REVIEW'].includes(o.status);

        const order = await prisma.order.create({
            data: {
                orderNo,
                customerId: customer.id,
                deliveryAddressId: addressId,
                salesRepId: o.salesRep,
                requestedByUserId: o.salesRep,
                orderSource: o.source,
                status: o.status,
                priceStatus: 'EXPECTED_PRICE',
                supplierType: o.supplierType,
                requestedDeliveryDate: new Date(Date.now() + 2 * 86400_000),
                rawOrderText:
                    o.source === 'KAKAO'
                        ? `[카톡 원문]\n${customer.name}\n${o.productCodes.join(', ')} ${o.quantities.join('/')}KG`
                        : null,
                createdAt,
                updatedAt: createdAt,
                items: {
                    create: o.productCodes.map((code, i) => {
                        const p = productByCode.get(code);
                        if (!p) throw new Error(`product ${code} missing`);
                        return {
                            productId: p.id,
                            requestedQuantity: o.quantities[i],
                            approvedQuantity: isApproved ? o.quantities[i] : null,
                            shippedQuantity: isShipped ? o.quantities[i] : null,
                            unit: 'KG',
                            expectedPrice: 1500,
                            priceStatus: 'EXPECTED_PRICE',
                        };
                    }),
                },
                statusHistory: {
                    create:
                        o.status === 'REQUESTED'
                            ? [{ newStatus: 'REQUESTED', changedByUserId: o.salesRep, changeReason: 'Initial' }]
                            : [
                                { newStatus: 'REQUESTED', changedByUserId: o.salesRep, changeReason: 'Initial', createdAt },
                                { previousStatus: 'REQUESTED', newStatus: o.status, changedByUserId: o.salesRep, changeReason: 'Seed transition' },
                            ],
                },
            },
        });

        if (o.status === 'ON_HOLD') {
            await prisma.holdReminder.create({
                data: {
                    orderId: order.id,
                    holdReason: '단가 협의 필요',
                    remindAt: new Date(Date.now() + 2 * 3600_000),
                    reminderTargetUserId: o.salesRep,
                    createdByUserId: o.salesRep,
                },
            });
        }
        if (['DISPATCH_WAITING', 'SHIPPED', 'ERP_INPUT_WAITING', 'COMPLETED'].includes(o.status)) {
            await prisma.dispatch.create({
                data: {
                    orderId: order.id,
                    dispatchStatus: o.status === 'DISPATCH_WAITING' ? 'WAITING' : 'DISPATCH_COMPLETED',
                    dispatchAttemptCount: 1,
                    carrierName: o.status !== 'DISPATCH_WAITING' ? '대한운수' : null,
                    vehicleNumber: o.status !== 'DISPATCH_WAITING' ? '경기87가1234' : null,
                    driverName: o.status !== 'DISPATCH_WAITING' ? '김기사' : null,
                },
            });
        }
        if (isShipped) {
            const total = o.quantities.reduce((a, b) => a + b, 0);
            await prisma.shipment.create({
                data: {
                    orderId: order.id,
                    shipmentStatus: 'SHIPPED',
                    plannedQuantity: total,
                    shippedQuantity: total,
                    actualShipDate: new Date(Date.now() - Math.max(0, o.daysAgo - 1) * 86400_000),
                },
            });
        }
        if (o.status === 'COMPLETED') {
            await prisma.deliveryReceipt.create({
                data: {
                    orderId: order.id,
                    receiptStatus: 'SALES_CONFIRMED',
                    confirmedByUserId: o.salesRep,
                    confirmedAt: new Date(Date.now() - Math.max(0, o.daysAgo - 2) * 86400_000),
                },
            });
        }
        if (['SHIPPED', 'COMPLETED'].includes(o.status)) {
            await prisma.notificationLog.create({
                data: {
                    orderId: order.id,
                    recipientType: 'CUSTOMER_USER',
                    recipientLabel: customer.name,
                    channel: 'EMAIL',
                    notificationType: o.status === 'SHIPPED' ? 'SHIPPED' : 'ORDER_APPROVED',
                    title: `[한양유화] 주문 ${orderNo}`,
                    message: `${customer.name} 귀중\n주문번호: ${orderNo}\n상태: ${o.status}`,
                    sendStatus: 'SENT',
                    sentAt: createdAt,
                },
            });
        }
    }

    console.log('✅ Seed complete.');
    console.log('');
    console.log('--- Login credentials ---');
    console.log('  [Staff]  아이디 = 한글 이름,  비밀번호 = 이름의 영문 키보드 표기');
    for (const s of staffSeeds) {
        console.log(`    ${s.loginId.padEnd(6)}  /  ${s.password}   (${s.role})`);
    }
    console.log('  [Customer]  비밀번호 = 사업자번호 숫자만');
    for (const c of customerRefs) console.log(`    ${c.name}  /  ${normalizeBusinessNumber(c.bn)}  (raw: ${c.bn})`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
