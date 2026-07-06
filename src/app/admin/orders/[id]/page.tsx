import { auth, signOut } from '@/lib/auth';
import { redirect, notFound } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import HanwhaDispatchDetails, { type HanwhaDispatchDetailRow } from '@/components/HanwhaDispatchDetails';
import { hanwhaDriverInfo, joinHanwhaDriverInfo, parseHanwhaMaterialFromMemo } from '@/lib/hanwha-dispatch';
import { statusLabel, statusColor, fmtDate, fmtDateTime, fmtNumber } from '@/lib/orders';
import { ArrowLeft, Building2, MapPin, Calendar, FileText, Clock, BookOpen } from 'lucide-react';
import StatusActions from './StatusActions';
import DeleteOrderButton from './DeleteOrderButton';
import StaffStatusOverride from './StaffStatusOverride';
import ItemQuantityEditor from './ItemQuantityEditor';
import DeliveryDateEditor from './DeliveryDateEditor';
import CreditSimulationPanel from '@/app/admin/credit/CreditSimulationPanel';
import ManualDispatchForm from './ManualDispatchForm';
import OrderMemoEditor from './OrderMemoEditor';
import MissingDispatchBackorderForm from './MissingDispatchBackorderForm';
import DeliveryDateRequestReview from './DeliveryDateRequestReview';
import HomepageArchiveLink from '@/components/HomepageArchiveLink';
import OrderCustomerAddressEditor from './OrderCustomerAddressEditor';
import PurchaseLedgerDateEditor from './PurchaseLedgerDateEditor';
import SalesLedgerDateModeToggle from './SalesLedgerDateModeToggle';
import { purchaseRequestDateFromOrderNo } from '@/lib/ledger-policy';

export const dynamic = 'force-dynamic';

function normalizeCompanyName(value: string | null | undefined) {
    return (value ?? '')
        .replace(/주식\s*회사/g, '')
        .replace(/\(주\)|㈜|\s|[()]/g, '')
        .trim();
}

function ledgerMonthQuery(date: Date | null | undefined) {
    if (!date) return '';
    const from = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
    const to = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;
    return `?from=${from}&to=${to}`;
}

function nextMonthFirst(date: Date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

export default async function AdminOrderDetail({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal');

    const order = await prisma.order.findUnique({
        where: { id },
        include: {
            customer: true,
            deliveryAddress: true,
            items: { include: { product: true, salesEntity: true, purchaseEntity: true, purchaseSupplier: true } },
            requestedByUser: { select: { name: true, role: true } },
            requestedByCustomerUser: { select: { name: true } },
            statusHistory: {
                orderBy: { createdAt: 'asc' },
                include: { changedByUser: { select: { name: true } } },
            },
            deliveryDateChangeRequests: { orderBy: { createdAt: 'desc' }, take: 5 },
        },
    });

    if (!order) notFound();

    const products = await prisma.product.findMany({
        where: { isActive: true },
        select: {
            id: true,
            productName: true,
            productCode: true,
            defaultSalesEntityId: true,
            defaultPurchaseEntityId: true,
            defaultSupplierId: true,
        },
        orderBy: { productName: 'asc' },
    });

    const companyEntities = await prisma.companyEntity.findMany({
        where: { isActive: true },
        select: { id: true, code: true, displayName: true },
        orderBy: { displayName: 'asc' },
    });

    const suppliers = await prisma.supplier.findMany({
        where: { isActive: true },
        select: { id: true, supplierName: true, contactPerson: true, phone: true },
        orderBy: { supplierName: 'asc' },
    });

    const customers = await prisma.customer.findMany({
        where: { isActive: true },
        select: { id: true, companyName: true, customerCode: true },
        orderBy: { companyName: 'asc' },
    });

    const deliveryAddresses = await prisma.deliveryAddress.findMany({
        where: { isActive: true, customer: { isActive: true } },
        select: {
            id: true,
            customerId: true,
            label: true,
            addressLine1: true,
            addressLine2: true,
            contactPhone: true,
        },
        orderBy: [{ customer: { companyName: 'asc' } }, { isDefault: 'desc' }, { label: 'asc' }],
    });

    const hanwhaRows = await prisma.hanwhaDispatchRow.findMany({
        where: { matchedOrderId: order.id },
        orderBy: [{ createdAt: 'asc' }],
    });
    const hanwhaDispatches = hanwhaRows.length === 0
        ? await prisma.dispatch.findMany({
            where: { orderId: order.id, carrierName: '한화 H-CRM' },
            orderBy: [{ createdAt: 'asc' }],
        })
        : [];
    const manualDispatches = await prisma.dispatch.findMany({
        where: { orderId: order.id, carrierName: { not: '한화 H-CRM' } },
        orderBy: [{ createdAt: 'asc' }],
    });
    const dispatchDetails: HanwhaDispatchDetailRow[] = hanwhaRows.length > 0
        ? hanwhaRows.map((row) => ({
            id: row.id,
            indoChiName: row.indoChiName,
            materialNameRaw: row.materialNameRaw,
            materialName: row.materialName,
            quantityTon: row.quantityKg,
            driverInfo: hanwhaDriverInfo(row.rawCells),
        }))
        : hanwhaDispatches.map((dispatch) => ({
            id: dispatch.id,
            indoChiName: order.deliveryAddress.label,
            materialNameRaw: dispatch.hanwhaMaterialNameRaw ?? parseHanwhaMaterialFromMemo(dispatch.memo),
            materialName: dispatch.hanwhaMaterialName ?? parseHanwhaMaterialFromMemo(dispatch.memo),
            quantityTon: dispatch.hanwhaQuantityTon,
            driverInfo: joinHanwhaDriverInfo(dispatch.vehicleNumber, dispatch.driverName, dispatch.driverPhone),
        }));
    const manualDispatchDetails: HanwhaDispatchDetailRow[] = manualDispatches.map((dispatch) => ({
        id: dispatch.id,
        indoChiName: order.deliveryAddress.label,
        materialNameRaw: dispatch.hanwhaMaterialNameRaw ?? parseHanwhaMaterialFromMemo(dispatch.memo),
        materialName: dispatch.hanwhaMaterialName ?? parseHanwhaMaterialFromMemo(dispatch.memo),
        quantityTon: dispatch.hanwhaQuantityTon,
        driverInfo: joinHanwhaDriverInfo(dispatch.vehicleNumber, dispatch.driverName, dispatch.driverPhone),
    }));
    const orderQuantityTon = order.items.reduce((sum, item) => sum + item.requestedQuantity, 0);
    const canStartHanwhaOrder = session.user.userKind === 'staff';
    const isInternalPurchaseOnly = normalizeCompanyName(order.customer.companyName) === '한양유화';
    const hasNonHanwhaSupplier = order.items.some((item) => {
        const name = item.purchaseSupplier?.supplierName ?? '';
        return name !== '' && !name.includes('한화');
    });
    const isDispatchWaiting = order.status === 'DISPATCH_WAITING';
    // 거래처 포털 주문처럼 단가가 비어 있을 때 자동 채움용: 이 거래처+품목의 최근 단가 조회
    const productIds = order.items.map((i) => i.productId);
    const productNameById = new Map(order.items.map((item) => [item.productId, item.product.productName]));
    const productIdByNormalizedName = new Map(order.items.map((item) => [item.product.productName.replace(/\s/g, '').toLowerCase(), item.productId]));
    // 아이템별 (productId, purchaseSupplierId) 쌍 수집
    const supplierIdsByProductId = new Map<string, string[]>();
    for (const item of order.items) {
        if (item.purchaseSupplierId) {
            const arr = supplierIdsByProductId.get(item.productId) ?? [];
            if (!arr.includes(item.purchaseSupplierId)) arr.push(item.purchaseSupplierId);
            supplierIdsByProductId.set(item.productId, arr);
        }
    }
    const allSupplierIds = Array.from(new Set(order.items.map((i) => i.purchaseSupplierId).filter(Boolean))) as string[];

    const [savedPrices, recentOrderItems, recentSalesLedger, recentPurchaseLedger] = await Promise.all([
        prisma.customerProductPrice.findMany({
            where: { customerId: order.customerId, productId: { in: productIds } },
            orderBy: { lastUsedAt: 'desc' },
        }),
        prisma.orderItem.findMany({
            where: {
                productId: { in: productIds },
                order: { customerId: order.customerId, deletedAt: null, id: { not: order.id } },
                OR: [{ salesUnitPrice: { not: null } }, { purchaseUnitPrice: { not: null } }],
            },
            select: {
                productId: true,
                purchaseSupplierId: true,
                salesUnitPrice: true,
                purchaseUnitPrice: true,
                order: { select: { requestedDeliveryDate: true, createdAt: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 200,
        }),
        prisma.ledgerEntry.findMany({
            where: {
                customerId: order.customerId,
                ledgerType: 'SALES',
                productId: { in: productIds },
                unitPrice: { not: null },
            },
            select: { productId: true, unitPrice: true, transactionDate: true },
            orderBy: [{ transactionDate: 'desc' }],
            take: 500,
        }),
        // 매입원장: 해당 품목+매입처의 최근 매입단가
        prisma.ledgerEntry.findMany({
            where: {
                ledgerType: 'PURCHASE',
                OR: [
                    { productId: { in: productIds } },
                    { productName: { in: Array.from(productNameById.values()) } },
                ],
                unitPrice: { not: null },
                ...(allSupplierIds.length > 0 ? { supplierId: { in: allSupplierIds } } : {}),
            },
            select: { productId: true, productName: true, supplierId: true, unitPrice: true, transactionDate: true },
            orderBy: [{ transactionDate: 'desc' }],
            take: 1000,
        }),
    ]);

    // productId → 마지막 매출단가 / 매입단가
    const autoSalesPrice = new Map<string, number>();
    // 매입단가: (productId + ':' + supplierId) → price, 그리고 productId만도 저장
    const autoPurchasePrice = new Map<string, number>();           // key: productId
    const autoPurchasePriceBySupplier = new Map<string, number>(); // key: productId:supplierId

    // 1순위: CustomerProductPrice
    for (const p of savedPrices) {
        if (p.priceType === 'SALES' && !autoSalesPrice.has(p.productId)) autoSalesPrice.set(p.productId, p.unitPrice);
        if (p.priceType === 'PURCHASE' && !autoPurchasePrice.has(p.productId)) autoPurchasePrice.set(p.productId, p.unitPrice);
    }
    // 2순위: 최근 OrderItem
    const sortedRecent = [...recentOrderItems].sort((a, b) => {
        const at = a.order.requestedDeliveryDate?.getTime() ?? a.order.createdAt.getTime();
        const bt = b.order.requestedDeliveryDate?.getTime() ?? b.order.createdAt.getTime();
        return bt - at;
    });
    for (const item of sortedRecent) {
        if (item.salesUnitPrice != null && !autoSalesPrice.has(item.productId)) autoSalesPrice.set(item.productId, item.salesUnitPrice);
        if (item.purchaseUnitPrice != null) {
            if (!autoPurchasePrice.has(item.productId)) autoPurchasePrice.set(item.productId, item.purchaseUnitPrice);
            if (item.purchaseSupplierId) {
                const sk = `${item.productId}:${item.purchaseSupplierId}`;
                if (!autoPurchasePriceBySupplier.has(sk)) autoPurchasePriceBySupplier.set(sk, item.purchaseUnitPrice);
            }
        }
    }
    // 3순위: 매출원장 (매출단가)
    for (const entry of recentSalesLedger) {
        if (entry.productId && entry.unitPrice != null && !autoSalesPrice.has(entry.productId)) autoSalesPrice.set(entry.productId, entry.unitPrice);
    }
    // 4순위: 매입원장 (매입단가) — 품목+매입처 우선, 없으면 품목만
    for (const entry of recentPurchaseLedger) {
        const productId = entry.productId ?? productIdByNormalizedName.get(entry.productName.replace(/\s/g, '').toLowerCase());
        if (!productId || entry.unitPrice == null) continue;
        if (entry.supplierId) {
            const sk = `${productId}:${entry.supplierId}`;
            if (!autoPurchasePriceBySupplier.has(sk)) autoPurchasePriceBySupplier.set(sk, entry.unitPrice);
        }
        if (!autoPurchasePrice.has(productId)) autoPurchasePrice.set(productId, entry.unitPrice);
    }
    // 매입처 없는 경우 매입원장 전체에서도 한번 더 시도 (supplierId 필터 없이)
    // (allSupplierIds가 비어있을 때 위 쿼리가 이미 전체를 가져오므로 추가 처리 불필요)
    const toLocalDateStr = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const requestedDeliveryDateValue = order.requestedDeliveryDate
        ? toLocalDateStr(order.requestedDeliveryDate)
        : toLocalDateStr(new Date());
    const basePurchaseDate = purchaseRequestDateFromOrderNo(order.orderNo) ?? order.createdAt;
    const purchaseCarryoverDate = nextMonthFirst(basePurchaseDate);
    const shipAheadDate = order.requestedDeliveryDate ? nextMonthFirst(order.requestedDeliveryDate) : nextMonthFirst(new Date());
    const salesLedgerDates = Array.from(new Set(order.items.map((item) => toLocalDateStr(item.salesLedgerDate ?? order.requestedDeliveryDate ?? new Date()))));
    const purchaseLedgerDates = Array.from(new Set(order.items.map((item) => toLocalDateStr(item.purchaseLedgerDate ?? basePurchaseDate))));
    const currentSalesDateLabel = salesLedgerDates.length === 1 ? salesLedgerDates[0] : salesLedgerDates.join(', ');
    const currentPurchaseDateLabel = purchaseLedgerDates.length === 1 ? purchaseLedgerDates[0] : purchaseLedgerDates.join(', ');
    const currentPurchaseDateValue = purchaseLedgerDates[0] ?? toLocalDateStr(basePurchaseDate);
    const isShipAhead = order.items.length > 0 && order.items.every((item) => item.salesLedgerDate && toLocalDateStr(item.salesLedgerDate) === toLocalDateStr(shipAheadDate));
    const isPurchaseCarryover = order.items.length > 0 && order.items.every((item) => toLocalDateStr(item.purchaseLedgerDate ?? basePurchaseDate) === toLocalDateStr(purchaseCarryoverDate));
    const nextDeliveryDateValue = (() => {
        const baseDate = order.requestedDeliveryDate ? new Date(order.requestedDeliveryDate) : new Date();
        baseDate.setDate(baseDate.getDate() + 1);
        return toLocalDateStr(baseDate);
    })();
    const dispatchNoticeContext = {
        orderNo: order.orderNo,
        customerName: order.customer.companyName,
        deliveryDate: fmtDate(order.requestedDeliveryDate),
        deliveryAddress: [order.deliveryAddress.label, order.deliveryAddress.addressLine1, order.deliveryAddress.addressLine2]
            .filter(Boolean)
            .join(' '),
    };

    return (
        <div className="min-h-screen">
            <header className="bg-white border-b border-slate-200">
                <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Link href="/admin" className="flex items-center gap-2">
                            <Image src="/hanyanglogo.png" alt="logo" width={32} height={32} className="h-8 w-auto" />
                            <span className="font-bold text-slate-800">한양유화 e-Business OS</span>
                        </Link>
                        <HomepageArchiveLink />
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                        <span className="text-slate-600">
                            {session.user.name}{' '}
                            <span className="text-xs text-slate-400">({session.user.role})</span>
                        </span>
                        <form
                            action={async () => {
                                'use server';
                                await signOut({ redirectTo: '/login' });
                            }}
                        >
                            <button className="text-slate-500 hover:text-red-600 transition">로그아웃</button>
                        </form>
                    </div>
                </div>
            </header>

            <main className="max-w-5xl mx-auto p-6 space-y-6">
                <Link
                    href="/admin"
                    className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
                >
                    <ArrowLeft size={14} /> 대시보드로
                </Link>

                {/* 헤더 카드 */}
                <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div>
                            <p className="text-xs text-slate-400 font-mono">{order.orderNo}</p>
                            <h1 className="mt-1 text-2xl font-bold text-slate-800">
                                {order.customer.companyName}
                            </h1>
                            <p className="mt-1 text-sm text-slate-500">
                                등록 {fmtDateTime(order.createdAt)} ·{' '}
                                {order.requestedByUser?.name ??
                                    order.requestedByCustomerUser?.name ??
                                    '-'}{' '}
                                접수
                            </p>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <span
                                className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${statusColor(order.status)}`}
                            >
                                {statusLabel(order.status)}
                            </span>
                            {(() => {
                                const href = `/admin/customers/${order.customer.id}/ledger${ledgerMonthQuery(order.requestedDeliveryDate)}`;
                                return (
                                    <Link href={href} className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-sm font-medium text-teal-700 hover:bg-teal-100 transition-colors">
                                        <BookOpen size={13} /> 거래처원장
                                    </Link>
                                );
                            })()}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6 text-sm">
                        <Info icon={<Building2 size={14} />} label="거래처">
                            <span className="font-medium">{order.customer.companyName}</span>
                            <span className="block text-xs text-slate-400 font-mono">
                                {order.customer.customerCode}
                            </span>
                        </Info>
                        <Info icon={<MapPin size={14} />} label="도착지">
                            <span className="font-medium">{order.deliveryAddress.label}</span>
                            <span className="block text-xs text-slate-500">
                                {order.deliveryAddress.addressLine1}
                                {order.deliveryAddress.addressLine2 ? ` ${order.deliveryAddress.addressLine2}` : ''}
                            </span>
                            {order.deliveryAddress.contactPhone && (
                                <span className="block text-xs text-slate-500">
                                    전화번호 {order.deliveryAddress.contactPhone}
                                </span>
                            )}
                        </Info>
                        <div className="md:col-span-2">
                            <OrderCustomerAddressEditor
                                orderId={order.id}
                                currentCustomerId={order.customerId}
                                currentDeliveryAddressId={order.deliveryAddressId}
                                customers={customers}
                                addresses={deliveryAddresses.map((address) => ({
                                    id: address.id,
                                    customerId: address.customerId,
                                    label: address.label,
                                    addressLine1: address.addressLine1 ?? '',
                                    addressLine2: address.addressLine2,
                                    contactPhone: address.contactPhone,
                                }))}
                            />
                        </div>
                        <Info icon={<Calendar size={14} />} label="요청 도착일">
                            <div className="space-y-1">
                                <span className="block text-xs text-slate-500">현재 {fmtDate(order.requestedDeliveryDate)}</span>
                                <DeliveryDateEditor orderId={order.id} currentDate={requestedDeliveryDateValue} />
                            </div>
                        </Info>
                        <Info icon={<Calendar size={14} />} label="요청 매입일">
                            <div className="space-y-1">
                                <span className="block text-xs text-slate-500">현재 {currentPurchaseDateLabel}</span>
                                <PurchaseLedgerDateEditor orderId={order.id} currentDate={currentPurchaseDateValue} />
                            </div>
                        </Info>
                        <Info icon={<FileText size={14} />} label="메모">
                            <span className="whitespace-pre-wrap">{order.memo || '미입력'}</span>
                        </Info>
                    </div>
                    <div className="mt-4">
                        <SalesLedgerDateModeToggle
                            orderId={order.id}
                            shipAhead={isShipAhead}
                            shipAheadDate={toLocalDateStr(shipAheadDate)}
                            currentSalesDateLabel={currentSalesDateLabel}
                            purchaseCarryover={isPurchaseCarryover}
                            purchaseCarryoverDate={toLocalDateStr(purchaseCarryoverDate)}
                            currentPurchaseDateLabel={currentPurchaseDateLabel}
                        />
                    </div>
                </section>

                <OrderMemoEditor
                    orderId={order.id}
                    initialDriverCustomerNotice={order.driverCustomerNotice ?? ''}
                    initialOrderExtraRequest={order.orderExtraRequest ?? order.memo ?? ''}
                />

                <DeliveryDateRequestReview
                    requests={order.deliveryDateChangeRequests.map((request) => ({
                        id: request.id,
                        requestedDate: toLocalDateStr(request.requestedDate),
                        requestedWeekdayText: request.requestedWeekdayText,
                        reason: request.reason,
                        status: request.status,
                        createdAt: request.createdAt.toISOString(),
                    }))}
                />

                <HanwhaDispatchDetails title="한화 배차내역" rows={dispatchDetails} orderQuantityTon={orderQuantityTon} showDeleteAction noticeContext={dispatchNoticeContext} />
                <HanwhaDispatchDetails title="수기 배차내역" rows={manualDispatchDetails} orderQuantityTon={orderQuantityTon} showDeleteAction noticeContext={dispatchNoticeContext} />
                {hasNonHanwhaSupplier && (
                    <ManualDispatchForm
                        orderId={order.id}
                        items={order.items.map((item) => ({
                            productName: item.product.productName,
                            quantity: item.requestedQuantity,
                            unit: item.unit,
                        }))}
                    />
                )}
                {isDispatchWaiting && <MissingDispatchBackorderForm
                    orderId={order.id}
                    defaultDeliveryDate={nextDeliveryDateValue}
                    items={order.items.map((item) => ({
                        id: item.id,
                        productName: item.product.productName,
                        quantity: item.requestedQuantity,
                        unit: item.unit,
                    }))}
                />}

                {/* 주문 품목 */}
                <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
                        <div>
                            <h2 className="font-semibold text-slate-800">주문 품목</h2>
                            <p className="mt-0.5 text-xs text-slate-400">제품코드·승인수량·출고수량은 숨기고 핵심 주문 정보만 표시합니다.</p>
                        </div>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                            {order.items.length}개 품목
                        </span>
                    </div>
                    <div className="divide-y divide-slate-100">
                        {order.items.map((it) => (
                            <article key={it.id} className="p-5">
                                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                                    <div className="min-w-0 flex-1 space-y-3">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h3 className="text-base font-bold text-slate-900">{it.product.productName}</h3>
                                            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${it.fulfillmentType === 'WAREHOUSE' ? 'bg-indigo-50 text-indigo-700' : it.fulfillmentType === 'DIRECT' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                                {it.fulfillmentType === 'WAREHOUSE' ? '창고' : it.fulfillmentType === 'DIRECT' ? '직송' : '미지정'}
                                            </span>
                                            <span className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
                                                {fmtNumber(it.requestedQuantity)} {it.unit}
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
                                            <InfoBlock
                                                label="매입처"
                                                value={it.purchaseSupplierId && it.purchaseSupplier ? (
                                                    <Link
                                                        href={`/admin/suppliers/${it.purchaseSupplierId}/ledger${ledgerMonthQuery(order.requestedDeliveryDate)}`}
                                                        className="inline-flex items-center gap-1 text-blue-700 hover:text-blue-900"
                                                    >
                                                        {it.purchaseSupplier.supplierName}
                                                        <BookOpen size={12} />
                                                    </Link>
                                                ) : '-'}
                                            />
                                            <InfoBlock label="매출단가" value={!isInternalPurchaseOnly && it.salesUnitPrice != null ? `${it.salesUnitPrice.toLocaleString('ko-KR')}원` : '-'} align="right" />
                                            <InfoBlock label="매입단가" value={it.purchaseUnitPrice != null ? `${it.purchaseUnitPrice.toLocaleString('ko-KR')}원` : '-'} align="right" />
                                            <div>
                                                <p className="text-xs font-medium text-slate-400">매입처 확인</p>
                                                <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${it.purchaseSupplierId && it.purchaseSupplierConfirmedAt ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                                                    {it.purchaseSupplierId && it.purchaseSupplierConfirmedAt ? '저장됨' : '확인 필요'}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="text-xs text-slate-400">
                                            {!isInternalPurchaseOnly && <span>매출 {it.salesEntity?.displayName ?? '-'}</span>}
                                            {!isInternalPurchaseOnly && <span className="mx-2">·</span>}
                                            <span>매입 {it.purchaseEntity?.displayName ?? '-'}</span>
                                        </div>
                                    </div>

                                    <div className="w-full shrink-0 xl:w-[360px]">
                                        <ItemQuantityEditor
                                            itemId={it.id}
                                            currentProductId={it.productId}
                                            currentQuantity={it.requestedQuantity}
                                            currentSalesEntityId={it.salesEntityId ?? ''}
                                            currentPurchaseEntityId={it.purchaseEntityId ?? ''}
                                            currentPurchaseSupplierId={it.purchaseSupplierId ?? ''}
                                            currentFulfillmentType={it.fulfillmentType ?? ''}
                                            currentHanwhaBagType={it.hanwhaBagType ?? ''}
                                            isInternalPurchaseOnly={isInternalPurchaseOnly}
                                            currentSalesUnitPrice={it.salesUnitPrice}
                                            currentPurchaseUnitPrice={it.purchaseUnitPrice}
                                            autoSalesUnitPrice={autoSalesPrice.get(it.productId) ?? null}
                                            autoPurchaseUnitPrice={
                                                (it.purchaseSupplierId
                                                    ? autoPurchasePriceBySupplier.get(`${it.productId}:${it.purchaseSupplierId}`)
                                                    : undefined)
                                                ?? autoPurchasePrice.get(it.productId)
                                                ?? null
                                            }
                                            unit={it.unit}
                                            orderStatus={order.status}
                                            products={products}
                                            companyEntities={companyEntities}
                                            suppliers={suppliers}
                                        />
                                    </div>
                                </div>
                            </article>
                        ))}
                    </div>
                </section>

                {/* 여신 시뮬레이션 (수락 전 필수 확인) */}
                {['REQUESTED', 'PENDING_SALES_REVIEW', 'ON_HOLD'].includes(order.status) && (
                    <CreditSimulationPanel orderId={order.id} />
                )}

                {/* 액션 */}
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex-1">
                        <StatusActions
                            orderId={order.id}
                            currentStatus={order.status}
                            canStartHanwhaOrder={canStartHanwhaOrder}
                            hanwhaOrderedAt={order.hanwhaOrderedAt ?? null}
                        />
                    </div>
                    <DeleteOrderButton orderId={order.id} />
                </div>

                {/* 이력 */}
                <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2">
                            <Clock size={16} className="text-slate-500" />
                            <h2 className="font-semibold text-slate-800">상태 이력</h2>
                        </div>
                        <StaffStatusOverride orderId={order.id} currentStatus={order.status} />
                    </div>
                    <ul className="divide-y divide-slate-100">
                        {order.statusHistory.map((h) => (
                            <li key={h.id} className="px-6 py-3 flex items-center gap-3 text-sm">
                                <span className="text-xs text-slate-400 w-32 shrink-0 font-mono">
                                    {fmtDateTime(h.createdAt)}
                                </span>
                                <span
                                    className={`inline-flex rounded-full px-2 py-0.5 text-xs ${statusColor(h.newStatus)}`}
                                >
                                    {statusLabel(h.newStatus)}
                                </span>
                                <span className="text-xs text-slate-400 ml-auto">
                                    {h.changedByUser?.name ?? '-'}
                                    {h.changeReason && (
                                        <span className="ml-2 text-slate-500">
                                            · {h.changeReason}
                                        </span>
                                    )}
                                </span>
                            </li>
                        ))}
                    </ul>
                </section>
            </main>

        </div>
    );
}

function InfoBlock({
    label,
    value,
    align = 'left',
}: {
    label: string;
    value: React.ReactNode;
    align?: 'left' | 'right';
}) {
    return (
        <div className={align === 'right' ? 'text-left md:text-right' : ''}>
            <p className="text-xs font-medium text-slate-400">{label}</p>
            <div className="mt-1 font-semibold text-slate-700">{value}</div>
        </div>
    );
}

function Info({
    icon,
    label,
    children,
}: {
    icon: React.ReactNode;
    label: string;
    children: React.ReactNode;
}) {
    return (
        <div>
            <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">
                {icon} {label}
            </p>
            <div className="text-slate-700">{children}</div>
        </div>
    );
}
