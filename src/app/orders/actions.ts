'use server';

import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { OrderStatus } from '@/shared/enums';
import { openHanwhaNewOrder } from '@/lib/hanwha-new-order';
import { getHanwhaPassword, getHanwhaUsername } from '@/lib/hanwha-credentials';
import { syncOrderWarehouseStockMovements } from '@/lib/warehouse-stock-sync';
import { productIdentityKey } from '@/lib/product-identity';

export type OrderItemInput = {
    productId: string;
    quantity: number;
    fulfillmentType?: string;
    salesEntityId?: string;
    purchaseEntityId?: string;
    purchaseSupplierId?: string;
    hanwhaBagType?: string;
    salesUnitPrice?: number | null;
    purchaseUnitPrice?: number | null;
};
export type CreateOrderInput = {
    customerId: string;          // 거래처 (customer 로그인 시 자동, staff는 폼에서)
    deliveryAddressId: string;
    /** deliveryAddressId가 비어있을 때 자동 생성할 도착지명 */
    deliveryAddressName?: string;
    orderDate: string;           // YYYY-MM-DD
    deliveryDate: string;        // YYYY-MM-DD
    items: OrderItemInput[];
    memo?: string;
    allowDuplicate?: boolean;
};

export type CreateOrderResult =
    | { ok: true; orderId: string; orderNo: string }
    | { ok: false; error: string; duplicate: true; duplicateOrderNos: string[] }
    | { ok: false; error: string };

function buildOrderNoPrefix(orderDate: string) {
    const date = new Date(orderDate + 'T00:00:00');
    const yymmdd =
        String(date.getFullYear()).slice(2) +
        String(date.getMonth() + 1).padStart(2, '0') +
        String(date.getDate()).padStart(2, '0');
    return `HY-${yymmdd}-`;
}

async function getNextOrderNo(tx: Prisma.TransactionClient, orderDate: string) {
    const prefix = buildOrderNoPrefix(orderDate);
    const date = new Date(orderDate + 'T00:00:00');
    const existingSequence = await tx.orderSequence.findUnique({
        where: { orderDate: date },
        select: { lastSeq: true },
    });

    let nextSeq: number;
    if (existingSequence) {
        const updated = await tx.orderSequence.update({
            where: { orderDate: date },
            data: { lastSeq: { increment: 1 } },
            select: { lastSeq: true },
        });
        nextSeq = updated.lastSeq;
    } else {
        const lastOrder = await tx.order.findFirst({
            where: { orderNo: { startsWith: prefix } },
            select: { orderNo: true },
            orderBy: { orderNo: 'desc' },
        });
        const lastSeq = lastOrder?.orderNo.match(/-(\d{4})$/)?.[1];
        nextSeq = lastSeq ? Number(lastSeq) + 1 : 1;
        await tx.orderSequence.create({
            data: { orderDate: date, lastSeq: nextSeq },
        });
    }
    return `${prefix}${String(nextSeq).padStart(4, '0')}`;
}

function toOptionalPrice(value: number | null | undefined) {
    if (value == null) return null;
    return Number.isFinite(value) ? value : Number.NaN;
}

function compactJoin(values: Array<string | null | undefined>, separator = ' · ') {
    return values.filter((value): value is string => Boolean(value)).join(separator);
}

function normalizeCompanyName(value: string | null | undefined) {
    return (value ?? '')
        .replace(/주식\s*회사/g, '')
        .replace(/\(주\)|㈜|\s|[()]/g, '')
        .trim();
}

function isHanyangCustomerName(value: string | null | undefined) {
    return normalizeCompanyName(value) === '한양유화';
}

function normalizeHanwhaBagType(value: string | null | undefined) {
    const bagType = value?.trim().toUpperCase();
    return bagType && ['FFS', 'FB500', 'FB700', 'FB750'].includes(bagType) ? bagType : null;
}

function isHanwhaSupplierName(value: string | null | undefined) {
    const normalized = normalizeCompanyName(value);
    return normalized === '한화솔루션' || normalized.includes('한화솔루션');
}

function isWarehouseOutbound(fulfillmentType: string | null | undefined, isInternalPurchaseOnly: boolean) {
    return fulfillmentType === 'WAREHOUSE' && !isInternalPurchaseOnly;
}

export async function setDefaultDeliveryAddress(addressId: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (!addressId) return { ok: false, error: '도착지를 선택해 주세요.' };

    const address = await prisma.deliveryAddress.findUnique({
        where: { id: addressId },
        select: { id: true, customerId: true, isActive: true },
    });
    if (!address || !address.isActive) return { ok: false, error: '도착지를 찾을 수 없습니다.' };
    if (session.user.userKind === 'customer' && session.user.customerId !== address.customerId) {
        return { ok: false, error: '본인 거래처의 도착지만 변경할 수 있습니다.' };
    }

    await prisma.$transaction([
        prisma.deliveryAddress.updateMany({
            where: { customerId: address.customerId, isDefault: true, id: { not: address.id } },
            data: { isDefault: false },
        }),
        prisma.deliveryAddress.update({
            where: { id: address.id },
            data: { isDefault: true },
        }),
    ]);

    revalidatePath('/admin/orders/new');
    revalidatePath('/portal/orders/new');
    return { ok: true };
}

const SPLIT_REMAINING_ORDER_STATUSES = new Set([
    'DISPATCH_WAITING',
    'DISPATCHING',
    'DISPATCH_COMPLETED',
    'DISPATCH_FAILED',
    'DISPATCH_RETRY_SCHEDULED',
    'SHIPPED',
    'DELIVERY_CONFIRM_PENDING',
    'DELIVERY_CONFIRMED',
    'ERP_INPUT_WAITING',
    'ERP_INPUT_COMPLETED',
    'INVOICE_WAITING',
    'INVOICE_COMPLETED',
    'COMPLETED',
]);

function addDays(date: Date, days: number) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

async function rememberCustomerProductPrice(
    tx: Prisma.TransactionClient,
    input: {
        customerId: string;
        productId: string;
        companyEntityId: string;
        priceType: 'SALES' | 'PURCHASE';
        unitPrice: number | null;
        sourceOrderItemId: string;
        userId?: string;
    },
) {
    if (input.unitPrice == null) return;
    await tx.customerProductPrice.upsert({
        where: {
            customerId_productId_companyEntityId_priceType: {
                customerId: input.customerId,
                productId: input.productId,
                companyEntityId: input.companyEntityId,
                priceType: input.priceType,
            },
        },
        update: {
            unitPrice: input.unitPrice,
            sourceOrderItemId: input.sourceOrderItemId,
            lastUsedAt: new Date(),
            createdById: input.userId,
        },
        create: {
            customerId: input.customerId,
            productId: input.productId,
            companyEntityId: input.companyEntityId,
            priceType: input.priceType,
            unitPrice: input.unitPrice,
            sourceOrderItemId: input.sourceOrderItemId,
            createdById: input.userId,
        },
    });
}

/**
 * 주문 생성 (거래처/직원 공통)
 * - 거래처 로그인: customerId가 본인과 일치해야 함
 * - 직원 로그인: 어떤 거래처든 가능
 * - 모든 필수값 검증
 */
export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };

    // ── 입력 검증 ───────────────────────────────────────────────
    if (!input.customerId) return { ok: false, error: '거래처를 선택해주세요.' };
    if (!input.deliveryAddressId && !input.deliveryAddressName?.trim())
        return { ok: false, error: '도착지를 선택해주세요.' };
    if (!input.orderDate) return { ok: false, error: '주문일자를 입력해주세요.' };
    if (!input.deliveryDate) return { ok: false, error: '도착일자를 입력해주세요.' };
    if (!input.items || input.items.length === 0)
        return { ok: false, error: '제품을 1개 이상 선택해주세요.' };

    for (const it of input.items) {
        if (!it.productId) return { ok: false, error: '모든 제품을 선택해주세요.' };
        if (!Number.isFinite(it.quantity) || it.quantity <= 0)
            return { ok: false, error: '모든 제품의 수량을 입력해주세요.' };
        if (!['WAREHOUSE', 'DIRECT'].includes(it.fulfillmentType ?? '')) {
            return { ok: false, error: '모든 제품의 창고/직송을 선택해주세요.' };
        }
        const salesUnitPrice = toOptionalPrice(it.salesUnitPrice);
        const purchaseUnitPrice = toOptionalPrice(it.purchaseUnitPrice);
        if (Number.isNaN(salesUnitPrice) || Number.isNaN(purchaseUnitPrice)) {
            return { ok: false, error: '단가는 숫자로 입력해주세요.' };
        }
        if ((salesUnitPrice != null && salesUnitPrice < 0) || (purchaseUnitPrice != null && purchaseUnitPrice < 0)) {
            return { ok: false, error: '단가는 0 이상으로 입력해주세요.' };
        }
    }

    // ── 권한 검증 ───────────────────────────────────────────────
    if (session.user.userKind === 'customer') {
        if (session.user.customerId !== input.customerId) {
            return { ok: false, error: '본인 거래처의 주문만 생성할 수 있습니다.' };
        }
    }

    const isStaff = session.user.userKind === 'staff';
    const productIdsForDefaults = Array.from(new Set(input.items.map((it) => it.productId)));
    const [inputCustomer, productsForDefaults, activeCompanies] = await Promise.all([
        prisma.customer.findUnique({ where: { id: input.customerId }, select: { companyName: true } }),
        prisma.product.findMany({
            where: { id: { in: productIdsForDefaults }, isActive: true },
            select: {
                id: true,
                productCode: true,
                productName: true,
                defaultSalesEntityId: true,
                defaultPurchaseEntityId: true,
                defaultSupplierId: true,
            },
        }),
        prisma.companyEntity.findMany({
            where: { isActive: true },
            select: { id: true, code: true, displayName: true, legalName: true, isDefaultSales: true, isDefaultPurchase: true },
        }),
    ]);
    if (!inputCustomer) return { ok: false, error: '거래처를 찾을 수 없습니다.' };
    const isInternalPurchaseOnly = isHanyangCustomerName(inputCustomer.companyName);
    const productMap = new Map(productsForDefaults.map((product) => [product.id, product]));
    const companyIds = new Set(activeCompanies.map((company) => company.id));
    const hanyangEntityId = activeCompanies.find((company) =>
        company.code === 'HANYANG_PETRO'
        || normalizeCompanyName(company.displayName) === '한양유화'
        || normalizeCompanyName(company.legalName) === '한양유화'
    )?.id;
    const defaultSalesEntityId = hanyangEntityId ?? activeCompanies.find((company) => company.isDefaultSales)?.id ?? activeCompanies[0]?.id;
    const defaultPurchaseEntityId = hanyangEntityId ?? activeCompanies.find((company) => company.isDefaultPurchase)?.id ?? defaultSalesEntityId;

    const requestedSupplierIds = input.items.map((it) => it.purchaseSupplierId).filter((id): id is string => Boolean(id));
    const activeSuppliers = requestedSupplierIds.length > 0
        ? await prisma.supplier.findMany({
            where: { id: { in: Array.from(new Set(requestedSupplierIds)) }, isActive: true },
            select: { id: true },
        })
        : [];
    const supplierIds = new Set(activeSuppliers.map((supplier) => supplier.id));

    let resolvedItems: Array<{
        productId: string;
        quantity: number;
        fulfillmentType: string;
        salesEntityId: string;
        purchaseEntityId: string;
        purchaseSupplierId: string | null;
        hanwhaBagType: string | null;
        salesUnitPrice: number | null;
        purchaseUnitPrice: number | null;
    }>;
    try {
        resolvedItems = input.items.map((it, index) => {
            const product = productMap.get(it.productId);
            if (!product) throw new Error(`${index + 1}번째 제품을 찾을 수 없습니다.`);
            const salesEntityId = isStaff
                ? (it.salesEntityId || defaultSalesEntityId || product.defaultSalesEntityId)
                : (defaultSalesEntityId || product.defaultSalesEntityId);
            const purchaseEntityId = isStaff
                ? (it.purchaseEntityId || defaultPurchaseEntityId || product.defaultPurchaseEntityId || salesEntityId)
                : (defaultPurchaseEntityId || product.defaultPurchaseEntityId || salesEntityId);
            const warehouseOutbound = isWarehouseOutbound(it.fulfillmentType, isInternalPurchaseOnly);
            const purchaseSupplierId = warehouseOutbound
                ? null
                : isStaff
                    ? (it.purchaseSupplierId || product.defaultSupplierId || null)
                    : (product.defaultSupplierId || null);
            if (!isInternalPurchaseOnly && (!salesEntityId || !companyIds.has(salesEntityId))) throw new Error(`${index + 1}번째 품목의 매출주체가 올바르지 않습니다.`);
            if (!purchaseEntityId || !companyIds.has(purchaseEntityId)) throw new Error(`${index + 1}번째 품목의 매입주체가 올바르지 않습니다.`);
            if (!warehouseOutbound && it.purchaseSupplierId && !supplierIds.has(it.purchaseSupplierId)) throw new Error(`${index + 1}번째 품목의 매입처가 올바르지 않습니다.`);
            return {
                productId: it.productId,
                quantity: it.quantity,
                fulfillmentType: it.fulfillmentType!,
                salesEntityId: isInternalPurchaseOnly ? purchaseEntityId : salesEntityId!,
                purchaseEntityId,
                purchaseSupplierId,
                hanwhaBagType: normalizeHanwhaBagType(it.hanwhaBagType),
                salesUnitPrice: isStaff && !isInternalPurchaseOnly ? toOptionalPrice(it.salesUnitPrice) : null,
                purchaseUnitPrice: isStaff ? toOptionalPrice(it.purchaseUnitPrice) : null,
            };
        });
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : '품목 기본값 확인 중 오류가 발생했습니다.' };
    }

    // ── 도착지 검증: ID가 있으면 기존 도착지 검증, 없으면 주문 생성 시 자동 생성 ──
    let resolvedAddressId = input.deliveryAddressId;
    const deliveryAddressName = input.deliveryAddressName?.trim();
    if (resolvedAddressId) {
        // ── 도착지 검증 ─────────────────────────────────────────────
        const addr = await prisma.deliveryAddress.findUnique({
            where: { id: resolvedAddressId },
            select: { id: true, customerId: true, isActive: true },
        });
        if (!addr || addr.customerId !== input.customerId || !addr.isActive) {
            return { ok: false, error: '도착지가 거래처와 일치하지 않습니다.' };
        }
    }

    if (!input.allowDuplicate) {
        const deliveryDate = new Date(input.deliveryDate + 'T00:00:00');
        const nextDeliveryDate = new Date(deliveryDate);
        nextDeliveryDate.setDate(nextDeliveryDate.getDate() + 1);
        const productIds = Array.from(new Set(resolvedItems.map((it) => it.productId)));
        const duplicateProductKeys = new Set(resolvedItems.map((it) => {
            const product = productMap.get(it.productId);
            return product ? productIdentityKey(product.productName, product.productCode) : it.productId;
        }));
        const aliasProducts = await prisma.product.findMany({
            where: { isActive: true },
            select: { id: true, productName: true, productCode: true },
        });
        const aliasProductIds = aliasProducts
            .filter((product) => duplicateProductKeys.has(productIdentityKey(product.productName, product.productCode)))
            .map((product) => product.id);
        const existingOrders = await prisma.order.findMany({
            where: {
                customerId: input.customerId,
                requestedDeliveryDate: { gte: deliveryDate, lt: nextDeliveryDate },
                deletedAt: null,
                status: { notIn: ['CANCELLED', 'REJECTED'] },
                items: { some: { productId: { in: aliasProductIds.length > 0 ? aliasProductIds : productIds } } },
            },
            select: {
                orderNo: true,
                items: {
                    select: {
                        productId: true,
                        requestedQuantity: true,
                        product: { select: { productName: true, productCode: true } },
                    },
                },
            },
        });

        const duplicateOrderNos = existingOrders
            .filter((order) => order.items.some((existingItem) => resolvedItems.some(
                (newItem) => {
                    const newProduct = productMap.get(newItem.productId);
                    const newKey = newProduct ? productIdentityKey(newProduct.productName, newProduct.productCode) : newItem.productId;
                    const existingKey = productIdentityKey(existingItem.product.productName, existingItem.product.productCode);
                    return existingKey === newKey && Math.abs(existingItem.requestedQuantity - newItem.quantity) < 0.0001;
                },
            )))
            .map((order) => order.orderNo);

        if (duplicateOrderNos.length > 0) {
            return {
                ok: false,
                duplicate: true,
                duplicateOrderNos,
                error: `동일 도착일로 동품목, 동수량 기오더가 존재합니다. (${duplicateOrderNos.join(', ')}) 그래도 추가 오더로 저장하시겠습니까?`,
            };
        }
    }

    // ── 트랜잭션으로 주문 생성 ──────────────────────────────────
    try {
        const order = await prisma.$transaction(async (tx) => {
            if (!resolvedAddressId) {
                const newAddr = await tx.deliveryAddress.create({
                    data: {
                        customerId: input.customerId,
                        label: deliveryAddressName!,
                        addressLine1: deliveryAddressName!,
                        isDefault: false,
                        isActive: true,
                        memo: '주문 등록 시 자동 생성',
                    },
                });
                resolvedAddressId = newAddr.id;
            }

            const orderNo = await getNextOrderNo(tx, input.orderDate);
            const created = await tx.order.create({
                data: {
                    orderNo,
                    customerId: input.customerId,
                    deliveryAddressId: resolvedAddressId,
                    requestedByUserId:
                        session.user.userKind === 'staff' ? session.user.id : undefined,
                    requestedByCustomerUserId:
                        session.user.userKind === 'customer' ? session.user.id : undefined,
                    orderSource:
                        session.user.userKind === 'customer' ? 'CUSTOMER_PORTAL' : 'SALES_MANUAL',
                    status: 'REQUESTED',
                    requestedDeliveryDate: new Date(input.deliveryDate + 'T00:00:00'),
                    memo: input.memo,
                    items: {
                        create: resolvedItems.map((it) => ({
                            productId: it.productId,
                            requestedQuantity: it.quantity,
                            salesEntityId: it.salesEntityId,
                            purchaseEntityId: it.purchaseEntityId,
                            purchaseSupplierId: it.purchaseSupplierId,
                            hanwhaBagType: it.hanwhaBagType,
                            purchaseSupplierConfirmedAt: isStaff && it.purchaseSupplierId ? new Date() : null,
                            fulfillmentType: it.fulfillmentType,
                            salesUnitPrice: it.salesUnitPrice,
                            purchaseUnitPrice: it.purchaseUnitPrice,
                            unit: 'TON',
                        })),
                    },
                    statusHistory: {
                        create: {
                            previousStatus: null,
                            newStatus: 'REQUESTED',
                            changedByUserId:
                                session.user.userKind === 'staff' ? session.user.id : undefined,
                            changeReason: '주문 등록',
                        },
                    },
                },
                include: { items: true },
            });
            for (const item of created.items) {
                if (!isInternalPurchaseOnly) {
                    await rememberCustomerProductPrice(tx, {
                        customerId: input.customerId,
                        productId: item.productId,
                        companyEntityId: item.salesEntityId!,
                        priceType: 'SALES',
                        unitPrice: item.salesUnitPrice,
                        sourceOrderItemId: item.id,
                        userId: isStaff ? session.user.id : undefined,
                    });
                }
                await rememberCustomerProductPrice(tx, {
                    customerId: input.customerId,
                    productId: item.productId,
                    companyEntityId: item.purchaseEntityId!,
                    priceType: 'PURCHASE',
                    unitPrice: item.purchaseUnitPrice,
                    sourceOrderItemId: item.id,
                    userId: isStaff ? session.user.id : undefined,
                });
            }
            return created;
        });

        // 화이트리스트 자동 추가 (거래처별 자주 주문하는 제품 학습)
        for (const it of resolvedItems) {
            await prisma.customerProductWhitelist.upsert({
                where: {
                    customerId_productId: {
                        customerId: input.customerId,
                        productId: it.productId,
                    },
                },
                update: {
                    lastOrderedAt: new Date(),
                    totalOrderCount: { increment: 1 },
                },
                create: {
                    customerId: input.customerId,
                    productId: it.productId,
                    firstOrderedAt: new Date(),
                    lastOrderedAt: new Date(),
                    totalOrderCount: 1,
                    isVisibleInPortal: true,
                },
            });
        }

        revalidatePath('/admin');
        revalidatePath('/portal');

        return { ok: true, orderId: order.id, orderNo: order.orderNo };
    } catch (e) {
        console.error('createOrder failed:', e);
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            return { ok: false, error: '주문번호가 중복되었습니다. 다시 한 번 저장해 주세요.' };
        }
        return { ok: false, error: '주문 저장 중 오류가 발생했습니다.' };
    }
}

// ─────────────────────────────────────────────────────────────
// 주문 상태 변경 (직원 전용): 승인 / 보류 / 반려 / 취소
// ─────────────────────────────────────────────────────────────
export type ChangeStatusResult = { ok: true } | { ok: false; error: string };

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
    REQUESTED: ['APPROVED', 'ON_HOLD', 'REJECTED', 'PENDING_SALES_REVIEW'],
    PENDING_SALES_REVIEW: ['APPROVED', 'ON_HOLD', 'REJECTED'],
    ON_HOLD: ['APPROVED', 'REJECTED', 'REQUESTED'],
    APPROVED: ['DISPATCH_WAITING', 'CANCELLED'],
    DISPATCH_WAITING: ['DISPATCH_COMPLETED'],
    DISPATCHING: ['DISPATCH_COMPLETED'],
};

function friendlyHanwhaNewOrderError(error: string, errorCode?: string) {
    if (errorCode === 'NO_CREDENTIALS') return '한화 계정 정보가 등록되지 않았습니다. 설정에서 한화 계정을 확인해주세요.';
    if (errorCode === 'AUTH_FAILED') return '한화 H-CRM 로그인 오류입니다. 아이디/비밀번호를 확인해주세요.';

    const message = error || '';
    const lower = message.toLowerCase();
    if (message.includes('[판매형태 지점]') || lower.includes('sales type') || message.includes('김경출')) {
        return '판매형태 지점 선택 단계에서 오류가 났습니다. 한화 화면의 판매형태/지점 검색 결과를 확인해주세요.';
    }
    if (message.includes('[인도처명]') || lower.includes('ship-to') || message.includes('인도처')) {
        return '인도처명 오류입니다. 홈페이지 도착지명이 한화 H-CRM 인도처명과 일치하는지 확인해주세요.';
    }
    if (message.includes('[제품]') || lower.includes('product') || message.includes('자재') || message.includes('검색 결과가 없습니다')) {
        return '제품/자재명 선택 단계에서 오류가 났습니다. 품목의 한화 자재명 또는 포장백 정보를 확인해주세요.';
    }
    if (message.includes('[수량/도착일]') || lower.includes('quantity') || lower.includes('date')) {
        return '수량 또는 도착일 입력 단계에서 오류가 났습니다. 수량과 도착일을 확인해주세요.';
    }
    if (message.includes('[주문요청]') || lower.includes('submit order')) {
        return '한화 주문요청 버튼 처리 단계에서 오류가 났습니다. 한화 화면에서 필수값 누락 여부를 확인해주세요.';
    }
    if (message.includes('[새 주문 화면]')) {
        return '한화 H-CRM 새 주문 화면을 열지 못했습니다. 한화 사이트 메뉴/팝업 상태를 확인해주세요.';
    }
    return `한화오더 자동 입력 중 오류가 발생했습니다. ${message ? `(${message.slice(0, 120)})` : ''}`;
}

export async function changeOrderStatus(
    orderId: string,
    nextStatus: string,
    reason?: string,
): Promise<ChangeStatusResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff') {
        return { ok: false, error: '직원만 상태를 변경할 수 있습니다.' };
    }

    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { customer: { select: { companyName: true } } },
    });
    if (!order) return { ok: false, error: '주문을 찾을 수 없습니다.' };

    const allowed = ALLOWED_TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(nextStatus)) {
        return {
            ok: false,
            error: `'${order.status}' 상태에서 '${nextStatus}' 로 변경할 수 없습니다.`,
        };
    }

    if (nextStatus === 'APPROVED') {
        const isInternalPurchaseOnly = isHanyangCustomerName(order.customer.companyName);
        const missingSupplierItems = await prisma.orderItem.findMany({
            where: {
                orderId,
                ...(isInternalPurchaseOnly ? {} : { fulfillmentType: { not: 'WAREHOUSE' } }),
                OR: [
                    { purchaseSupplierId: null },
                    { purchaseSupplierConfirmedAt: null },
                ],
            },
            select: {
                product: { select: { productName: true } },
            },
            take: 5,
        });
        if (missingSupplierItems.length > 0) {
            return {
                ok: false,
                error: `오더 수락 전 모든 품목의 매입처를 저장해야 합니다. 미확인: ${missingSupplierItems.map((item) => item.product.productName).join(', ')}`,
            };
        }
    }

    try {
        await prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id: orderId },
                data: { status: nextStatus },
            });
            await tx.orderStatusHistory.create({
                data: {
                    orderId,
                    previousStatus: order.status,
                    newStatus: nextStatus,
                    changedByUserId: session.user.id,
                    changeReason: reason ?? null,
                },
            });
            await syncOrderWarehouseStockMovements(tx, orderId);
        });
        revalidatePath('/admin');
        revalidatePath(`/admin/orders/${orderId}`);
        revalidatePath('/portal');
        return { ok: true };
    } catch (e) {
        console.error('changeOrderStatus failed:', e);
        return { ok: false, error: '상태 변경 중 오류가 발생했습니다.' };
    }
}

export async function manualChangeOrderStatus(
    orderId: string,
    nextStatus: string,
    reason: string,
): Promise<ChangeStatusResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff') {
        return { ok: false, error: '직원만 상태를 변경할 수 있습니다.' };
    }
    if (!reason?.trim()) return { ok: false, error: '상태 변경 사유를 입력해주세요.' };

    const allowedStatuses = Object.values(OrderStatus) as string[];
    if (!allowedStatuses.includes(nextStatus)) {
        return { ok: false, error: '존재하지 않는 주문 상태입니다.' };
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.deletedAt) return { ok: false, error: '주문을 찾을 수 없습니다.' };
    if (order.status === nextStatus) return { ok: false, error: '이미 같은 상태입니다.' };

    try {
        await prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id: orderId },
                data: { status: nextStatus },
            });
            await tx.orderStatusHistory.create({
                data: {
                    orderId,
                    previousStatus: order.status,
                    newStatus: nextStatus,
                    changedByUserId: session.user.id,
                    changeReason: `[직원 수동변경] ${reason.trim()}`,
                },
            });
            await syncOrderWarehouseStockMovements(tx, orderId);
        });
        revalidatePath('/admin');
        revalidatePath(`/admin/orders/${orderId}`);
        revalidatePath('/portal');
        return { ok: true };
    } catch (e) {
        console.error('manualChangeOrderStatus failed:', e);
        return { ok: false, error: '상태 변경 중 오류가 발생했습니다.' };
    }
}

export async function updateOrderDeliveryDate(
    orderId: string,
    nextDeliveryDate: string,
    reason: string,
): Promise<ChangeStatusResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff') {
        return { ok: false, error: '직원만 도착일을 수정할 수 있습니다.' };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDeliveryDate)) {
        return { ok: false, error: '도착일 형식이 잘못되었습니다.' };
    }
    if (!reason?.trim()) return { ok: false, error: '도착일 수정 사유를 입력해주세요.' };

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.deletedAt) return { ok: false, error: '주문을 찾을 수 없습니다.' };

    const nextDate = new Date(nextDeliveryDate + 'T00:00:00');
    if (Number.isNaN(nextDate.getTime())) return { ok: false, error: '도착일이 올바르지 않습니다.' };

    const toLocalDateStr = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const currentDateValue = order.requestedDeliveryDate ? toLocalDateStr(order.requestedDeliveryDate) : '미지정';
    if (currentDateValue === nextDeliveryDate) return { ok: false, error: '이미 같은 도착일입니다.' };

    try {
        await prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id: orderId },
                data: { requestedDeliveryDate: nextDate },
            });
            await tx.orderStatusHistory.create({
                data: {
                    orderId,
                    previousStatus: order.status,
                    newStatus: order.status,
                    changedByUserId: session.user.id,
                    changeReason: `[도착일 수정] ${currentDateValue} → ${nextDeliveryDate} / ${reason.trim()}`,
                },
            });
            await syncOrderWarehouseStockMovements(tx, orderId);
        });
        revalidatePath('/admin');
        revalidatePath(`/admin/orders/${orderId}`);
        revalidatePath('/portal');
        revalidatePath(`/portal/orders/${orderId}`);
        return { ok: true };
    } catch (e) {
        console.error('updateOrderDeliveryDate failed:', e);
        return { ok: false, error: '도착일 수정 중 오류가 발생했습니다.' };
    }
}

export async function requestOrderDeliveryDateChange(input: {
    orderId: string;
    requestedDate: string;
    requestedWeekdayText?: string;
    reason?: string;
}): Promise<ChangeStatusResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'customer' || !session.user.customerId) {
        return { ok: false, error: '거래처만 도착일 변경을 요청할 수 있습니다.' };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.requestedDate)) {
        return { ok: false, error: '변경 원하는 도착일을 확인해 주세요.' };
    }

    const order = await prisma.order.findUnique({
        where: { id: input.orderId },
        select: { id: true, customerId: true, requestedDeliveryDate: true, status: true, deletedAt: true },
    });
    if (!order || order.deletedAt || order.customerId !== session.user.customerId) {
        return { ok: false, error: '주문을 찾을 수 없습니다.' };
    }

    const requestedDate = new Date(`${input.requestedDate}T00:00:00`);
    if (Number.isNaN(requestedDate.getTime())) return { ok: false, error: '변경 원하는 도착일을 확인해 주세요.' };

    const now = new Date();
    const currentDelivery = order.requestedDeliveryDate ? new Date(order.requestedDeliveryDate) : null;
    if (currentDelivery) {
        currentDelivery.setHours(11, 0, 0, 0);
        if (now >= currentDelivery) {
            return { ok: false, error: '도착일 당일 오전 11시 이후에는 변경 요청이 불가합니다. 담당자에게 연락해주세요.' };
        }
    }

    await prisma.$transaction(async (tx) => {
        await tx.deliveryDateChangeRequest.updateMany({
            where: { orderId: input.orderId, status: 'PENDING' },
            data: { status: 'REJECTED', reviewMemo: '새 변경 요청으로 자동 종료', reviewedAt: new Date() },
        });
        await tx.deliveryDateChangeRequest.create({
            data: {
                orderId: input.orderId,
                requestedDate,
                requestedWeekdayText: input.requestedWeekdayText?.trim() || null,
                reason: input.reason?.trim() || null,
                requestedByCustomerUserId: session.user.id,
            },
        });
        await tx.orderStatusHistory.create({
            data: {
                orderId: input.orderId,
                previousStatus: order.status,
                newStatus: order.status,
                customerMessage: `도착일 변경 요청: ${input.requestedDate}`,
                changeReason: `[도착일 변경 요청] ${input.requestedDate}${input.reason?.trim() ? ` / ${input.reason.trim()}` : ''}`,
            },
        });
    });

    revalidatePath('/portal');
    revalidatePath('/portal/orders');
    revalidatePath(`/portal/orders/${input.orderId}`);
    revalidatePath('/admin');
    revalidatePath(`/admin/orders/${input.orderId}`);
    return { ok: true };
}

export async function reviewOrderDeliveryDateChangeRequest(
    requestId: string,
    decision: 'APPROVED' | 'REJECTED',
    reviewMemo?: string,
): Promise<ChangeStatusResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff') return { ok: false, error: '직원만 요청을 처리할 수 있습니다.' };

    const request = await prisma.deliveryDateChangeRequest.findUnique({
        where: { id: requestId },
        include: { order: true },
    });
    if (!request || request.order.deletedAt) return { ok: false, error: '요청을 찾을 수 없습니다.' };
    if (request.status !== 'PENDING') return { ok: false, error: '이미 처리된 요청입니다.' };

    const toLocalDateStr = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const nextDateText = toLocalDateStr(request.requestedDate);
    const currentDateText = request.order.requestedDeliveryDate ? toLocalDateStr(request.order.requestedDeliveryDate) : '미지정';

    await prisma.$transaction(async (tx) => {
        await tx.deliveryDateChangeRequest.update({
            where: { id: requestId },
            data: {
                status: decision,
                reviewedByUserId: session.user.id,
                reviewedAt: new Date(),
                reviewMemo: reviewMemo?.trim() || null,
            },
        });
        if (decision === 'APPROVED') {
            await tx.order.update({ where: { id: request.orderId }, data: { requestedDeliveryDate: request.requestedDate } });
            await syncOrderWarehouseStockMovements(tx, request.orderId);
        }
        await tx.orderStatusHistory.create({
            data: {
                orderId: request.orderId,
                previousStatus: request.order.status,
                newStatus: request.order.status,
                changedByUserId: session.user.id,
                customerMessage: decision === 'APPROVED' ? `도착일 변경 요청이 승인되었습니다. (${nextDateText})` : '도착일 변경 요청이 반려되었습니다.',
                changeReason: decision === 'APPROVED'
                    ? `[도착일 변경 요청 승인] ${currentDateText} → ${nextDateText}${reviewMemo?.trim() ? ` / ${reviewMemo.trim()}` : ''}`
                    : `[도착일 변경 요청 반려] 요청일 ${nextDateText}${reviewMemo?.trim() ? ` / ${reviewMemo.trim()}` : ''}`,
            },
        });
    });

    revalidatePath('/portal');
    revalidatePath('/portal/orders');
    revalidatePath(`/portal/orders/${request.orderId}`);
    revalidatePath('/admin');
    revalidatePath(`/admin/orders/${request.orderId}`);
    return { ok: true };
}

export async function updateOrderItemQuantity(
    itemId: string,
    nextQuantity: number,
    reason: string,
): Promise<ChangeStatusResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff') {
        return { ok: false, error: '직원만 수량을 수정할 수 있습니다.' };
    }
    if (!Number.isFinite(nextQuantity) || nextQuantity <= 0) {
        return { ok: false, error: '수량은 0보다 커야 합니다.' };
    }
    if (!reason?.trim()) return { ok: false, error: '수량 수정 사유를 입력해주세요.' };

    const item = await prisma.orderItem.findUnique({
        where: { id: itemId },
        include: { order: true, product: { select: { productName: true } } },
    });
    if (!item || item.order.deletedAt) return { ok: false, error: '주문 품목을 찾을 수 없습니다.' };
    if (item.requestedQuantity === nextQuantity) return { ok: false, error: '이미 같은 수량입니다.' };

    const previousQuantity = item.requestedQuantity;
    const approvedQuantity = item.approvedQuantity === previousQuantity ? nextQuantity : item.approvedQuantity;

    try {
        await prisma.$transaction(async (tx) => {
            await tx.orderItem.update({
                where: { id: itemId },
                data: {
                    requestedQuantity: nextQuantity,
                    approvedQuantity,
                },
            });
            await tx.orderStatusHistory.create({
                data: {
                    orderId: item.orderId,
                    previousStatus: item.order.status,
                    newStatus: item.order.status,
                    changedByUserId: session.user.id,
                    changeReason: `[수량 수정] ${item.product.productName}: ${previousQuantity}${item.unit} → ${nextQuantity}${item.unit} / ${reason.trim()}`,
                },
            });
            await syncOrderWarehouseStockMovements(tx, item.orderId);
        });
        revalidatePath('/admin');
        revalidatePath(`/admin/orders/${item.orderId}`);
        revalidatePath('/portal');
        revalidatePath(`/portal/orders/${item.orderId}`);
        return { ok: true };
    } catch (e) {
        console.error('updateOrderItemQuantity failed:', e);
        return { ok: false, error: '수량 수정 중 오류가 발생했습니다.' };
    }
}

// 거래처 본인 주문 취소 (REQUESTED 상태일 때만)
export async function cancelOwnOrder(orderId: string): Promise<ChangeStatusResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'customer') {
        return { ok: false, error: '거래처 계정만 가능합니다.' };
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return { ok: false, error: '주문을 찾을 수 없습니다.' };
    if (order.customerId !== session.user.customerId) {
        return { ok: false, error: '본인 주문만 취소할 수 있습니다.' };
    }
    if (order.status !== 'REQUESTED') {
        return {
            ok: false,
            error: '이미 영업팀에서 처리 중이라 취소할 수 없습니다. 담당자에게 연락해주세요.',
        };
    }

    try {
        await prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id: orderId },
                data: { status: 'CANCELLED' },
            });
            await tx.orderStatusHistory.create({
                data: {
                    orderId,
                    previousStatus: order.status,
                    newStatus: 'CANCELLED',
                    changeReason: `거래처 자가 취소 (${session.user.name ?? session.user.id})`,
                },
            });
        });
        revalidatePath('/portal');
        revalidatePath(`/portal/orders/${orderId}`);
        revalidatePath('/admin');
        return { ok: true };
    } catch (e) {
        console.error('cancelOwnOrder failed:', e);
        return { ok: false, error: '취소 중 오류가 발생했습니다.' };
    }
}

// ─────────────────────────────────────────────────────────────
// 주문 소프트 삭제 (직원 전용)
// 삭제 후에도 /admin/orders/deleted 에서 조회 가능
// ─────────────────────────────────────────────────────────────
export async function softDeleteOrder(
    orderId: string,
    reason: string,
): Promise<ChangeStatusResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff') {
        return { ok: false, error: '직원만 주문을 삭제할 수 있습니다.' };
    }
    if (!reason?.trim()) return { ok: false, error: '삭제 사유를 입력해주세요.' };

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return { ok: false, error: '주문을 찾을 수 없습니다.' };
    if (order.deletedAt) return { ok: false, error: '이미 삭제된 주문입니다.' };

    try {
        await prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id: orderId },
                data: {
                    deletedAt: new Date(),
                    deletedById: session.user.id,
                    deleteReason: reason.trim(),
                },
            });
            await tx.orderStatusHistory.create({
                data: {
                    orderId,
                    previousStatus: order.status,
                    newStatus: 'DELETED',
                    changedByUserId: session.user.id,
                    changeReason: `[삭제] ${reason.trim()}`,
                },
            });
            await syncOrderWarehouseStockMovements(tx, orderId);
        });
        revalidatePath('/admin');
        revalidatePath(`/admin/orders/${orderId}`);
        revalidatePath('/admin/orders/deleted');
        return { ok: true };
    } catch (e) {
        console.error('softDeleteOrder failed:', e);
        return { ok: false, error: '삭제 중 오류가 발생했습니다.' };
    }
}

// ===============================================================
// 주문 품목 수정 (직원 전용): 품목 및 수량 동시 변경
// ===============================================================
export async function updateOrderItem(
    itemId: string,
    nextProductId: string,
    nextQuantity: number,
    reason: string,
    options?: {
        fulfillmentType?: string;
        salesEntityId?: string;
        purchaseEntityId?: string;
        purchaseSupplierId?: string | null;
        salesUnitPrice?: number | null;
        purchaseUnitPrice?: number | null;
        hanwhaBagType?: string | null;
        createBackorderForReducedQuantity?: boolean;
    },
): Promise<ChangeStatusResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff') {
        return { ok: false, error: '직원만 품목을 수정할 수 있습니다.' };
    }
    if (!nextProductId) return { ok: false, error: '품목을 선택해 주세요.' };
    if (!Number.isFinite(nextQuantity) || nextQuantity <= 0) {
        return { ok: false, error: '수량은 0보다 커야 합니다.' };
    }
    const nextSalesUnitPrice = toOptionalPrice(options?.salesUnitPrice);
    const nextPurchaseUnitPrice = toOptionalPrice(options?.purchaseUnitPrice);
    if (Number.isNaN(nextSalesUnitPrice) || Number.isNaN(nextPurchaseUnitPrice)) {
        return { ok: false, error: '단가는 숫자로 입력해 주세요.' };
    }
    if ((nextSalesUnitPrice != null && nextSalesUnitPrice < 0) || (nextPurchaseUnitPrice != null && nextPurchaseUnitPrice < 0)) {
        return { ok: false, error: '단가는 0 이상으로 입력해 주세요.' };
    }
    if (!reason?.trim()) return { ok: false, error: '수정 사유를 입력해 주세요.' };
    if (!['WAREHOUSE', 'DIRECT'].includes(options?.fulfillmentType ?? '')) {
        return { ok: false, error: '창고/직송을 선택해 주세요.' };
    }

    const item = await prisma.orderItem.findUnique({
        where: { id: itemId },
        include: {
            product: { select: { productName: true } },
            order: {
                include: {
                    customer: { select: { companyName: true } },
                },
            },
            salesEntity: { select: { displayName: true } },
            purchaseEntity: { select: { displayName: true } },
            purchaseSupplier: { select: { supplierName: true } },
        },
    });
    if (!item || item.order.deletedAt) return { ok: false, error: '주문 항목을 찾을 수 없습니다.' };
    const isInternalPurchaseOnly = isHanyangCustomerName(item.order.customer.companyName);
    const currentFulfillmentType = (item as typeof item & { fulfillmentType?: string | null }).fulfillmentType ?? null;

    const nextProduct = await prisma.product.findUnique({
        where: { id: nextProductId },
        select: {
            productName: true,
            defaultSalesEntityId: true,
            defaultPurchaseEntityId: true,
            defaultSupplierId: true,
        },
    });
    if (!nextProduct) return { ok: false, error: '선택한 품목을 찾을 수 없습니다.' };

    const activeCompanies = await prisma.companyEntity.findMany({
        where: { isActive: true },
        select: { id: true, displayName: true, isDefaultSales: true, isDefaultPurchase: true },
    });
    const companyMap = new Map(activeCompanies.map((company) => [company.id, company]));
    const fallbackSalesEntityId = activeCompanies.find((company) => company.isDefaultSales)?.id ?? activeCompanies[0]?.id;
    const fallbackPurchaseEntityId = activeCompanies.find((company) => company.isDefaultPurchase)?.id ?? fallbackSalesEntityId;
    const nextSalesEntityId = isInternalPurchaseOnly ? (options?.purchaseEntityId || nextProduct.defaultPurchaseEntityId || fallbackPurchaseEntityId || fallbackSalesEntityId) : (options?.salesEntityId || nextProduct.defaultSalesEntityId || fallbackSalesEntityId);
    const nextPurchaseEntityId = options?.purchaseEntityId || nextProduct.defaultPurchaseEntityId || fallbackPurchaseEntityId || nextSalesEntityId;
    if (!isInternalPurchaseOnly && (!nextSalesEntityId || !companyMap.has(nextSalesEntityId))) return { ok: false, error: '매출주체를 선택해 주세요.' };
    if (!nextPurchaseEntityId || !companyMap.has(nextPurchaseEntityId)) return { ok: false, error: '매입주체를 선택해 주세요.' };

    const nextPurchaseSupplierId = options && 'purchaseSupplierId' in options
        ? (options.purchaseSupplierId || null)
        : (item.purchaseSupplierId || nextProduct.defaultSupplierId || null);
    let nextPurchaseSupplierName: string | null = null;
    if (nextPurchaseSupplierId) {
        const supplier = await prisma.supplier.findFirst({
            where: { id: nextPurchaseSupplierId, isActive: true },
            select: { supplierName: true },
        });
        if (!supplier) return { ok: false, error: '매입처를 선택해 주세요.' };
        nextPurchaseSupplierName = supplier.supplierName;
    }
    const supplierConfirmationMissing = Boolean(nextPurchaseSupplierId) && item.purchaseSupplierConfirmedAt == null;

    const unchanged = item.productId === nextProductId
        && item.requestedQuantity === nextQuantity
        && item.salesEntityId === nextSalesEntityId
        && item.purchaseEntityId === nextPurchaseEntityId
        && (item.purchaseSupplierId ?? null) === nextPurchaseSupplierId
        && currentFulfillmentType === options!.fulfillmentType
        && (item.salesUnitPrice ?? null) === (isInternalPurchaseOnly ? null : nextSalesUnitPrice)
        && (item.purchaseUnitPrice ?? null) === nextPurchaseUnitPrice
        && !supplierConfirmationMissing;
    if (unchanged) return { ok: false, error: '변경된 내용이 없습니다.' };

    const previousQuantity = item.requestedQuantity;
    const approvedQuantity = item.productId === nextProductId && item.approvedQuantity === previousQuantity
        ? nextQuantity
        : null;

    try {
        await prisma.$transaction(async (tx) => {
            const updatedItem = await tx.orderItem.update({
                where: { id: itemId },
                data: {
                    productId: nextProductId,
                    requestedQuantity: nextQuantity,
                    approvedQuantity,
                    salesEntityId: nextSalesEntityId,
                    purchaseEntityId: nextPurchaseEntityId,
                    purchaseSupplierId: nextPurchaseSupplierId,
                    hanwhaBagType: normalizeHanwhaBagType(options?.hanwhaBagType),
                    purchaseSupplierConfirmedAt: nextPurchaseSupplierId ? new Date() : null,
                    fulfillmentType: options!.fulfillmentType,
                    salesUnitPrice: isInternalPurchaseOnly ? null : nextSalesUnitPrice,
                    purchaseUnitPrice: nextPurchaseUnitPrice,
                } as Prisma.OrderItemUncheckedUpdateInput,
            });
            if (!isInternalPurchaseOnly) {
                await rememberCustomerProductPrice(tx, {
                    customerId: item.order.customerId,
                    productId: updatedItem.productId,
                    companyEntityId: nextSalesEntityId,
                    priceType: 'SALES',
                    unitPrice: nextSalesUnitPrice,
                    sourceOrderItemId: updatedItem.id,
                    userId: session.user.id,
                });
            }
            await rememberCustomerProductPrice(tx, {
                customerId: item.order.customerId,
                productId: updatedItem.productId,
                companyEntityId: nextPurchaseEntityId,
                priceType: 'PURCHASE',
                unitPrice: nextPurchaseUnitPrice,
                sourceOrderItemId: updatedItem.id,
                userId: session.user.id,
            });
            if (options?.createBackorderForReducedQuantity && previousQuantity > nextQuantity && SPLIT_REMAINING_ORDER_STATUSES.has(item.order.status)) {
                const remainingQuantity = previousQuantity - nextQuantity;
                const baseDeliveryDate = item.order.requestedDeliveryDate ?? new Date();
                const nextDeliveryDate = addDays(baseDeliveryDate, 1);
                const orderNo = await getNextOrderNo(tx, nextDeliveryDate.toISOString().slice(0, 10));
                await tx.order.create({
                    data: {
                        orderNo,
                        customerId: item.order.customerId,
                        deliveryAddressId: item.order.deliveryAddressId,
                        requestedByUserId: session.user.id,
                        salesRepId: item.order.salesRepId,
                        orderSource: 'SALES_MANUAL',
                        status: 'REQUESTED',
                        requestedDeliveryDate: nextDeliveryDate,
                        memo: `[미배차분 자동생성] 원오더 ${item.order.orderNo} / ${item.product.productName} ${remainingQuantity}${item.unit}`,
                        items: {
                            create: {
                                productId: item.productId,
                                requestedQuantity: remainingQuantity,
                                approvedQuantity: null,
                                shippedQuantity: null,
                                salesEntityId: item.salesEntityId,
                                purchaseEntityId: item.purchaseEntityId,
                                purchaseSupplierId: item.purchaseSupplierId,
                                hanwhaBagType: item.hanwhaBagType,
                                purchaseSupplierConfirmedAt: item.purchaseSupplierId ? new Date() : null,
                                fulfillmentType: currentFulfillmentType,
                                salesUnitPrice: item.salesUnitPrice,
                                purchaseUnitPrice: item.purchaseUnitPrice,
                                unit: item.unit,
                            },
                        },
                        statusHistory: {
                            create: {
                                previousStatus: null,
                                newStatus: 'REQUESTED',
                                changedByUserId: session.user.id,
                                changeReason: `[미배차분 자동생성] ${item.order.orderNo} 수량 축소분 ${remainingQuantity}${item.unit}`,
                            },
                        },
                    },
                });
            }
            // 연결된 LedgerEntry 동기화 (orderItemId로 연결된 원장 데이터)
            const nextSalesSupplyAmount = !isInternalPurchaseOnly && nextSalesUnitPrice != null ? nextSalesUnitPrice * nextQuantity : null;
            const nextPurchaseSupplyAmount = nextPurchaseUnitPrice != null ? nextPurchaseUnitPrice * nextQuantity : null;
            await tx.ledgerEntry.updateMany({
                where: { orderItemId: itemId, ledgerType: 'SALES' },
                data: {
                    productId: nextProductId,
                    productName: nextProduct.productName,
                    companyEntityId: nextSalesEntityId,
                    customerId: item.order.customerId,
                    counterpartyName: item.order.customer.companyName,
                    quantity: nextQuantity,
                    unitPrice: isInternalPurchaseOnly ? null : nextSalesUnitPrice,
                    supplyAmount: nextSalesSupplyAmount,
                    vatAmount: nextSalesSupplyAmount == null ? null : Math.round(nextSalesSupplyAmount * 0.1),
                    totalAmount: nextSalesSupplyAmount == null ? null : Math.round(nextSalesSupplyAmount * 1.1),
                },
            });
            await tx.ledgerEntry.updateMany({
                where: { orderItemId: itemId, ledgerType: 'PURCHASE' },
                data: {
                    productId: nextProductId,
                    productName: nextProduct.productName,
                    companyEntityId: nextPurchaseEntityId,
                    supplierId: nextPurchaseSupplierId,
                    ...(nextPurchaseSupplierName ? { counterpartyName: nextPurchaseSupplierName } : {}),
                    quantity: nextQuantity,
                    unitPrice: nextPurchaseUnitPrice,
                    supplyAmount: nextPurchaseSupplyAmount,
                    vatAmount: nextPurchaseSupplyAmount == null ? null : Math.round(nextPurchaseSupplyAmount * 0.1),
                    totalAmount: nextPurchaseSupplyAmount == null ? null : Math.round(nextPurchaseSupplyAmount * 1.1),
                },
            });

            await syncOrderWarehouseStockMovements(tx, item.orderId);
            const changeDesc: string[] = [];
            if (item.productId !== nextProductId)
                changeDesc.push(`품목: ${item.product.productName} → ${nextProduct.productName}`);
            if (previousQuantity !== nextQuantity) {
                const splitText = options?.createBackorderForReducedQuantity && previousQuantity > nextQuantity && SPLIT_REMAINING_ORDER_STATUSES.has(item.order.status)
                    ? ` (미배차분 ${previousQuantity - nextQuantity}${item.unit} 익일 신규오더 생성)`
                    : '';
                changeDesc.push(`수량: ${previousQuantity}${item.unit} → ${nextQuantity}${item.unit}${splitText}`);
            }
            if (item.salesEntityId !== nextSalesEntityId)
                changeDesc.push(`매출주체: ${item.salesEntity?.displayName ?? '-'} → ${companyMap.get(nextSalesEntityId)?.displayName ?? '-'}`);
            if (currentFulfillmentType !== options!.fulfillmentType)
                changeDesc.push(`창고/직송: ${currentFulfillmentType === 'WAREHOUSE' ? '창고' : currentFulfillmentType === 'DIRECT' ? '직송' : '-'} → ${options!.fulfillmentType === 'WAREHOUSE' ? '창고' : '직송'}`);
            if ((item.purchaseSupplierId ?? null) !== nextPurchaseSupplierId || supplierConfirmationMissing)
                changeDesc.push(`매입처: ${item.purchaseSupplier?.supplierName ?? '-'} → ${nextPurchaseSupplierName ?? '-'}`);
            if (!isInternalPurchaseOnly && (item.salesUnitPrice ?? null) !== nextSalesUnitPrice)
                changeDesc.push(`매출단가: ${item.salesUnitPrice?.toLocaleString('ko-KR') ?? '-'} → ${nextSalesUnitPrice?.toLocaleString('ko-KR') ?? '-'}`);
            if ((item.purchaseUnitPrice ?? null) !== nextPurchaseUnitPrice)
                changeDesc.push(`매입단가: ${item.purchaseUnitPrice?.toLocaleString('ko-KR') ?? '-'} → ${nextPurchaseUnitPrice?.toLocaleString('ko-KR') ?? '-'}`);
            await tx.orderStatusHistory.create({
                data: {
                    orderId: item.orderId,
                    previousStatus: item.order.status,
                    newStatus: item.order.status,
                    changedByUserId: session.user.id,
                    changeReason: `[품목 수정] ${changeDesc.join(', ')} / ${reason.trim()}`,
                },
            });
        });
        revalidatePath('/admin');
        revalidatePath(`/admin/orders/${item.orderId}`);
        revalidatePath('/portal');
        revalidatePath(`/portal/orders/${item.orderId}`);
        return { ok: true };
    } catch (e) {
        console.error('updateOrderItem failed:', e);
        return { ok: false, error: '품목 수정 중 오류가 발생했습니다.' };
    }
}

export async function bulkConfirmOrderPurchaseSupplier(
    orderId: string,
    supplierId: string,
): Promise<ChangeStatusResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff') return { ok: false, error: '직원만 매입처를 저장할 수 있습니다.' };
    if (!supplierId) return { ok: false, error: '매입처를 선택해 주세요.' };

    const [order, supplier] = await Promise.all([
        prisma.order.findUnique({ where: { id: orderId }, select: { id: true, status: true, deletedAt: true, items: { select: { id: true } } } }),
        prisma.supplier.findFirst({ where: { id: supplierId, isActive: true }, select: { supplierName: true } }),
    ]);
    if (!order || order.deletedAt) return { ok: false, error: '주문을 찾을 수 없습니다.' };
    if (!supplier) return { ok: false, error: '매입처를 찾을 수 없습니다.' };
    if (order.items.length === 0) return { ok: false, error: '저장할 품목이 없습니다.' };

    try {
        await prisma.$transaction(async (tx) => {
            await tx.orderItem.updateMany({
                where: { orderId },
                data: {
                    purchaseSupplierId: supplierId,
                    purchaseSupplierConfirmedAt: new Date(),
                },
            });
            await tx.orderStatusHistory.create({
                data: {
                    orderId,
                    previousStatus: order.status,
                    newStatus: order.status,
                    changedByUserId: session.user.id,
                    changeReason: `[매입처 일괄 저장] 전체 품목 → ${supplier.supplierName}`,
                },
            });
        });
        revalidatePath('/admin');
        revalidatePath(`/admin/orders/${orderId}`);
        return { ok: true };
    } catch (e) {
        console.error('bulkConfirmOrderPurchaseSupplier failed:', e);
        return { ok: false, error: '매입처 일괄 저장 중 오류가 발생했습니다.' };
    }
}

export async function prepareSupplierKakaoNotice(
    orderId: string,
    supplierId: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff') return { ok: false, error: '직원만 알림톡을 준비할 수 있습니다.' };

    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
            customer: { select: { companyName: true } },
            deliveryAddress: { select: { label: true, addressLine1: true, addressLine2: true, contactName: true, contactPhone: true } },
            items: {
                where: { purchaseSupplierId: supplierId },
                include: { product: { select: { productName: true, productCode: true } } },
                orderBy: { createdAt: 'asc' },
            },
        },
    });
    if (!order || order.deletedAt) return { ok: false, error: '주문을 찾을 수 없습니다.' };
    if (order.status !== 'APPROVED') return { ok: false, error: '알림톡 준비는 오더 수락 후 가능합니다.' };
    if (order.items.length === 0) return { ok: false, error: '해당 매입처 품목이 없습니다.' };

    const supplier = await prisma.supplier.findUnique({
        where: { id: supplierId },
        select: { supplierName: true, contactPerson: true, phone: true },
    });
    if (!supplier) return { ok: false, error: '매입처를 찾을 수 없습니다.' };
    if (!supplier.phone) return { ok: false, error: `${supplier.supplierName} 담당자 전화번호가 없습니다.` };

    const deliveryAddress = compactJoin([
        order.deliveryAddress.label,
        order.deliveryAddress.addressLine1,
        order.deliveryAddress.addressLine2,
    ]);
    const itemLines = order.items.map((item) => (
        `- ${item.product.productName} (${item.product.productCode}): ${item.requestedQuantity}${item.unit}`
    ));
    const message = [
        `[한양유화 매입오더] ${order.orderNo}`,
        `거래처: ${order.customer.companyName}`,
        `도착일: ${order.requestedDeliveryDate?.toISOString().slice(0, 10) ?? '-'}`,
        `도착지: ${deliveryAddress || '-'}`,
        order.deliveryAddress.contactPhone ? `도착지 연락처: ${order.deliveryAddress.contactPhone}` : null,
        '품목:',
        ...itemLines,
    ].filter((line): line is string => Boolean(line)).join('\n');

    await prisma.orderStatusHistory.create({
        data: {
            orderId,
            previousStatus: order.status,
            newStatus: order.status,
            changedByUserId: session.user.id,
            changeReason: `[알림톡 준비] ${supplier.supplierName} (${supplier.contactPerson ?? '담당자'} ${supplier.phone}) 품목 ${order.items.length}건`,
            internalMemo: message,
        },
    });
    revalidatePath(`/admin/orders/${orderId}`);

    return { ok: true, message };
}

export async function updateOrderMemo(orderId: string, memo: string): Promise<ChangeStatusResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff') return { ok: false, error: '직원만 메모를 수정할 수 있습니다.' };

    const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true, status: true, memo: true, deletedAt: true },
    });
    if (!order || order.deletedAt) return { ok: false, error: '주문을 찾을 수 없습니다.' };

    const nextMemo = memo.trim() || null;
    const currentMemo = order.memo?.trim() || null;
    if (nextMemo === currentMemo) return { ok: false, error: '변경된 메모가 없습니다.' };

    try {
        await prisma.$transaction(async (tx) => {
            await tx.order.update({ where: { id: orderId }, data: { memo: nextMemo } });
            await tx.orderStatusHistory.create({
                data: {
                    orderId,
                    previousStatus: order.status,
                    newStatus: order.status,
                    changedByUserId: session.user.id,
                    changeReason: `[메모 수정] ${nextMemo ?? '(비움)'}`,
                },
            });
        });
        revalidatePath('/admin');
        revalidatePath(`/admin/orders/${orderId}`);
        revalidatePath('/portal');
        revalidatePath(`/portal/orders/${orderId}`);
        return { ok: true };
    } catch (e) {
        console.error('updateOrderMemo failed:', e);
        return { ok: false, error: '메모 수정 중 오류가 발생했습니다.' };
    }
}

export async function createMissingDispatchBackorder(
    orderId: string,
    deliveryDate: string,
    missingItems: Array<{ itemId: string; quantity: number }>,
): Promise<ChangeStatusResult & { backorderNo?: string }> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff') return { ok: false, error: '직원만 미배차분을 생성할 수 있습니다.' };
    if (!deliveryDate) return { ok: false, error: '변경 납품요청일을 입력해 주세요.' };

    const nextDeliveryDate = new Date(`${deliveryDate}T00:00:00`);
    if (Number.isNaN(nextDeliveryDate.getTime())) return { ok: false, error: '납품요청일 형식이 올바르지 않습니다.' };

    const normalized = missingItems
        .map((item) => ({ itemId: item.itemId, quantity: Number(item.quantity) }))
        .filter((item) => item.itemId && Number.isFinite(item.quantity) && item.quantity > 0);
    if (normalized.length === 0) return { ok: false, error: '미배차 수량을 1개 이상 입력해 주세요.' };

    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
            customer: { select: { companyName: true } },
            items: { include: { product: { select: { productName: true } } } },
        },
    });
    if (!order || order.deletedAt) return { ok: false, error: '주문을 찾을 수 없습니다.' };

    const missingByItemId = new Map(normalized.map((item) => [item.itemId, item.quantity]));
    const selectedItems = order.items.filter((item) => missingByItemId.has(item.id));
    if (selectedItems.length !== normalized.length) return { ok: false, error: '선택한 품목을 찾을 수 없습니다.' };

    for (const item of selectedItems) {
        const quantity = missingByItemId.get(item.id)!;
        if (quantity > item.requestedQuantity) {
            return { ok: false, error: `${item.product.productName} 미배차 수량이 주문 수량보다 큽니다.` };
        }
    }

    const fullOrderMissing = order.items.every((item) => missingByItemId.get(item.id) === item.requestedQuantity);
    const wouldRemoveAllItems = order.items.every((item) => (missingByItemId.get(item.id) ?? 0) >= item.requestedQuantity);
    if (wouldRemoveAllItems && !fullOrderMissing) {
        return { ok: false, error: '전체 품목 미배차는 전체 수량을 선택해 주세요.' };
    }

    try {
        let backorderNo = '';
        await prisma.$transaction(async (tx) => {
            backorderNo = await getNextOrderNo(tx, deliveryDate);
            await tx.order.create({
                data: {
                    orderNo: backorderNo,
                    customerId: order.customerId,
                    deliveryAddressId: order.deliveryAddressId,
                    requestedByUserId: session.user.id,
                    salesRepId: order.salesRepId,
                    orderSource: 'SALES_MANUAL',
                    status: 'APPROVED',
                    requestedDeliveryDate: nextDeliveryDate,
                    memo: compactJoin([
                        `[미배차분 자동생성] 원오더 ${order.orderNo}`,
                        order.memo,
                    ], '\n'),
                    items: {
                        create: selectedItems.map((item) => ({
                            productId: item.productId,
                            requestedQuantity: missingByItemId.get(item.id)!,
                            approvedQuantity: missingByItemId.get(item.id)!,
                            shippedQuantity: null,
                            salesEntityId: item.salesEntityId,
                            purchaseEntityId: item.purchaseEntityId,
                            purchaseSupplierId: item.purchaseSupplierId,
                            hanwhaBagType: item.hanwhaBagType,
                            purchaseSupplierConfirmedAt: item.purchaseSupplierId ? new Date() : null,
                            fulfillmentType: item.fulfillmentType,
                            salesUnitPrice: item.salesUnitPrice,
                            purchaseUnitPrice: item.purchaseUnitPrice,
                            unit: item.unit,
                            memo: item.memo,
                        })),
                    },
                    statusHistory: {
                        create: {
                            previousStatus: null,
                            newStatus: 'APPROVED',
                            changedByUserId: session.user.id,
                            changeReason: `[미배차분 자동생성] 원오더 ${order.orderNo} / 변경 납품요청일 ${deliveryDate}`,
                        },
                    },
                },
            });

            if (fullOrderMissing) {
                await tx.order.update({ where: { id: orderId }, data: { status: 'DISPATCH_FAILED' } });
                await tx.orderStatusHistory.create({
                    data: {
                        orderId,
                        previousStatus: order.status,
                        newStatus: 'DISPATCH_FAILED',
                        changedByUserId: session.user.id,
                        changeReason: `[전체 미배차] ${backorderNo} 자동 생성 / 변경 납품요청일 ${deliveryDate}`,
                    },
                });
                return;
            }

            for (const item of selectedItems) {
                const missingQuantity = missingByItemId.get(item.id)!;
                const nextQuantity = item.requestedQuantity - missingQuantity;

                if (nextQuantity <= 0) {
                    await tx.ledgerEntry.deleteMany({ where: { orderItemId: item.id } });
                    await tx.orderItem.delete({ where: { id: item.id } });
                    continue;
                }

                await tx.orderItem.update({
                    where: { id: item.id },
                    data: {
                        requestedQuantity: nextQuantity,
                        approvedQuantity: item.approvedQuantity == null ? null : Math.min(item.approvedQuantity, nextQuantity),
                    },
                });

                const nextSalesSupplyAmount = item.salesUnitPrice == null ? null : item.salesUnitPrice * nextQuantity;
                const nextPurchaseSupplyAmount = item.purchaseUnitPrice == null ? null : item.purchaseUnitPrice * nextQuantity;
                await tx.ledgerEntry.updateMany({
                    where: { orderItemId: item.id, ledgerType: 'SALES' },
                    data: {
                        quantity: nextQuantity,
                        supplyAmount: nextSalesSupplyAmount,
                        vatAmount: nextSalesSupplyAmount == null ? null : Math.round(nextSalesSupplyAmount * 0.1),
                        totalAmount: nextSalesSupplyAmount == null ? null : Math.round(nextSalesSupplyAmount * 1.1),
                    },
                });
                await tx.ledgerEntry.updateMany({
                    where: { orderItemId: item.id, ledgerType: 'PURCHASE' },
                    data: {
                        quantity: nextQuantity,
                        supplyAmount: nextPurchaseSupplyAmount,
                        vatAmount: nextPurchaseSupplyAmount == null ? null : Math.round(nextPurchaseSupplyAmount * 0.1),
                        totalAmount: nextPurchaseSupplyAmount == null ? null : Math.round(nextPurchaseSupplyAmount * 1.1),
                    },
                });
            }

            await syncOrderWarehouseStockMovements(tx, orderId);
            await tx.orderStatusHistory.create({
                data: {
                    orderId,
                    previousStatus: order.status,
                    newStatus: order.status,
                    changedByUserId: session.user.id,
                    changeReason: `[미배차분 분할] ${backorderNo} 자동 생성 / ${selectedItems.map((item) => `${item.product.productName} ${missingByItemId.get(item.id)}${item.unit}`).join(', ')}`,
                },
            });
        });

        revalidatePath('/admin');
        revalidatePath(`/admin/orders/${orderId}`);
        return { ok: true, backorderNo };
    } catch (e) {
        console.error('createMissingDispatchBackorder failed:', e);
        return { ok: false, error: '미배차분 오더 생성 중 오류가 발생했습니다.' };
    }
}

export async function startHanwhaNewOrder(orderId: string) {
    const session = await auth();
    if (!session?.user) return { ok: false as const, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff') {
        return { ok: false as const, error: '직원만 한화오더를 실행할 수 있습니다.' };
    }

    const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
            id: true,
            status: true,
            memo: true,
            requestedDeliveryDate: true,
            deletedAt: true,
            deliveryAddress: { select: { label: true } },
            items: {
                select: {
                    requestedQuantity: true,
                    unit: true,
                    hanwhaBagType: true,
                    purchaseSupplier: { select: { supplierName: true } },
                    product: { select: { productName: true, productCode: true, hanwhaMaterialName: true } },
                },
            },
        },
    });

    if (!order || order.deletedAt) {
        return { ok: false as const, error: '주문을 찾을 수 없습니다.' };
    }
    if (order.status !== OrderStatus.APPROVED) {
        return { ok: false as const, error: '승인 완료된 주문에서만 한화오더를 실행할 수 있습니다.' };
    }

    const username = await getHanwhaUsername();
    const password = await getHanwhaPassword();
    const hanwhaItems = order.items.filter((item) => isHanwhaSupplierName(item.purchaseSupplier?.supplierName));
    if (hanwhaItems.length === 0) {
        return { ok: false as const, error: '매입처가 한화솔루션인 품목이 없어 한화오더를 실행하지 않았습니다.' };
    }
    const result = await openHanwhaNewOrder({
        username,
        password,
        deliveryAddressName: order.deliveryAddress.label,
        memo: order.memo,
        deliveryDate: order.requestedDeliveryDate,
        items: hanwhaItems.map((item) => ({
            productName: item.product.productName,
            productCode: item.product.productCode,
            hanwhaMaterialName: item.product.hanwhaMaterialName,
            hanwhaBagType: item.hanwhaBagType,
            quantity: item.requestedQuantity,
            unit: item.unit,
        })),
    });

    if (!result.ok) {
        return { ok: false as const, error: friendlyHanwhaNewOrderError(result.error, result.errorCode), errorCode: result.errorCode };
    }

    await prisma.orderStatusHistory.create({
        data: {
            orderId,
            previousStatus: order.status,
            newStatus: order.status,
            changedByUserId: session.user.id,
            changeReason: `[한화오더] 한화솔루션 품목 ${hanwhaItems.length}건 주문요청 자동 진행`,
        },
    });
    await prisma.order.update({ where: { id: orderId }, data: { hanwhaOrderedAt: new Date() } });

    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true as const, message: result.message };
}