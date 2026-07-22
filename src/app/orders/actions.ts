'use server';

import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { OrderStatus } from '@/shared/enums';
import {
    checkHanwhaESalesOrderStatus,
    openHanwhaESalesOrder,
    prepareHanwhaESalesApprovalForOrders,
    requestHanwhaESalesApprovalForOrders,
    type HanwhaESalesOrderInput,
} from '@/lib/hanwha-esales-login';
import { getHanwhaPassword, getHanwhaUsername } from '@/lib/hanwha-credentials';
import { syncOrderWarehouseStockMovements } from '@/lib/warehouse-stock-sync';
import { productIdentityKey } from '@/lib/product-identity';
import { getEffectivePrice } from '@/app/admin/credit/actions';
import { calculateCustomerReceivable } from '@/lib/credit-balance';
import { resolveHanwhaMaterialName } from '@/lib/hanwha-material-map';
import { purchaseRequestDateFromOrderNo } from '@/lib/ledger-policy';
import { runHanwhaAutomationQueued } from '@/lib/hanwha-automation-gate';
import { isCanonicalOrderStatus, normalizeOrderStatus, ORDER_STATUS_VALUES } from '@/lib/orders';
import { isYangHeeCheol } from '@/lib/staff-permissions';
import {
    BACKGROUND_JOB_TYPES,
    enqueueBackgroundJob,
    parseJobJsonAs,
    toBackgroundJobView,
    updateBackgroundJobResult,
    type BackgroundJobView,
} from '@/lib/background-jobs';
import {
    HanwhaProductSelectionRequiredError,
    resumeHanwhaNewOrderAfterProductSelection,
    type HanwhaNewOrderJobMetadata,
} from '@/lib/hanwha-new-order-job';

type HanwhaOrderJobStatus = 'QUEUED' | 'RUNNING' | 'WAITING_MANUAL_ACTION' | 'DONE' | 'FAILED';

type HanwhaOrderJob = {
    id: string;
    orderId: string;
    orderNo: string;
    requestedByUserId: string;
    approveAfterOrder?: boolean;
    status: HanwhaOrderJobStatus;
    queuedAt: number;
    startedAt?: number;
    finishedAt?: number;
    message?: string;
    error?: string;
    resumeInput?: HanwhaESalesOrderInput;
    resumeRowIndex?: number;
    manualAction?: 'PRODUCT_SELECTION';
    manualTitle?: string;
    manualButtonLabel?: string;
    forceReorder?: boolean;
};

class HanwhaManualProductSelectionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'HanwhaManualProductSelectionError';
    }
}

const globalForHanwhaAction = globalThis as typeof globalThis & {
    __hanyangHanwhaOrderQueue?: HanwhaOrderJob[];
    __hanyangHanwhaOrderJobs?: Map<string, HanwhaOrderJob>;
    __hanyangHanwhaOrderRunning?: boolean;
};

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
    customerId: string;          // 嫄곕옒泥?(customer 濡쒓렇?????먮룞, staff???쇱뿉??
    deliveryAddressId: string;
    /** deliveryAddressId媛 鍮꾩뼱?덉쓣 ???먮룞 ?앹꽦???꾩갑吏紐?*/
    deliveryAddressName?: string;
    orderDate: string;           // YYYY-MM-DD
    deliveryDate: string;        // YYYY-MM-DD
    shipAhead?: boolean;         // ?좎텧?? ?꾩갑?쇱? ?좎??섍퀬 留ㅼ텧?쇱옄???듭썡 1?쇰줈 諛섏쁺
    purchaseCarryover?: boolean; // 留ㅼ엯?댁썡: ?꾩갑?쇱? ?좎??섍퀬 留ㅼ엯?쇱옄???듭썡 1?쇰줈 諛섏쁺
    sameDayDelivery?: boolean;   // ?뱀씪?꾩갑: 留ㅼ엯?쇱옄瑜??꾩갑?쇨낵 ?숈씪?섍쾶 諛섏쁺
    items: OrderItemInput[];
    driverCustomerNotice?: string;
    orderExtraRequest?: string;
    allowDuplicate?: boolean;
};

export type CreateOrderResult =
    | {
        ok: true;
        orderId: string;
        orderNo: string;
        status?: string;
        creditOver?: boolean;
        creditOverMessage?: string;
        hanwhaOrderQueued?: boolean;
    }
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

    // Use upsert + atomic increment to avoid race conditions under concurrent order creation.
    // If the row doesn't exist yet, we seed it from the current max orderNo for that date.
    let seqRow = await tx.orderSequence.findUnique({ where: { orderDate: date }, select: { lastSeq: true } });
    if (!seqRow) {
        const lastOrder = await tx.order.findFirst({
            where: { orderNo: { startsWith: prefix } },
            select: { orderNo: true },
            orderBy: { orderNo: 'desc' },
        });
        const seedSeq = lastOrder?.orderNo.match(/-(\d{4})$/)?.[1] ? Number(lastOrder!.orderNo.match(/-(\d{4})$/)![1]) : 0;
        // upsert: if concurrent insert races us, increment anyway
        seqRow = await tx.orderSequence.upsert({
            where: { orderDate: date },
            create: { orderDate: date, lastSeq: seedSeq + 1 },
            update: { lastSeq: { increment: 1 } },
            select: { lastSeq: true },
        });
    } else {
        seqRow = await tx.orderSequence.update({
            where: { orderDate: date },
            data: { lastSeq: { increment: 1 } },
            select: { lastSeq: true },
        });
    }
    return `${prefix}${String(seqRow.lastSeq).padStart(4, '0')}`;
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
        .replace(/주식회사|\(주\)|㈜/g, '')
        .replace(/\s|[()]/g, '')
        .trim();
}

function normalizeHanwhaItemName(value: string | null | undefined) {
    return (value ?? '').replace(/\s+/g, '').toUpperCase();
}

function normalizeHanwhaItemNameLoose(value: string | null | undefined) {
    return normalizeHanwhaItemName(value).replace(/[^A-Z0-9]/g, '');
}

function isHanyangCustomerName(value: string | null | undefined) {
    return normalizeCompanyName(value) === '?쒖뼇?좏솕';
}

function normalizeHanwhaBagType(value: string | null | undefined) {
    const bagType = value?.trim().toUpperCase();
    return bagType && ['FFS', 'FB500', 'FB700', 'FB750'].includes(bagType) ? bagType : null;
}

function normalizeProductForDefaultBag(value: string | null | undefined) {
    return (value ?? '').replace(/\s+/g, '').toUpperCase();
}

function defaultHanwhaBagTypeForProduct(productName: string | null | undefined) {
    return normalizeProductForDefaultBag(productName) === 'MLLDPE<M1605EN>' ? 'FB700' : null;
}

function resolveHanwhaBagType(value: string | null | undefined, productName: string | null | undefined) {
    return normalizeHanwhaBagType(value) ?? defaultHanwhaBagTypeForProduct(productName);
}

function isApprovedHanwhaStatus(value: string | null | undefined) {
    return (value ?? '').trim() === '승인';
}

function isHanwhaSupplierName(value: string | null | undefined) {
    const normalized = normalizeCompanyName(value);
    return normalized === '한화솔루션' || normalized.includes('한화솔루션');
}

function isHanwhaOrderItem(item: {
    hanwhaBagType?: string | null;
    purchaseSupplier?: { supplierName: string | null } | null;
    product?: { productName?: string | null; hanwhaItemCode?: string | null; hanwhaMaterialName?: string | null } | null;
}) {
    const supplierName = item.purchaseSupplier?.supplierName?.trim();
    if (supplierName) return isHanwhaSupplierName(supplierName);
    const productName = normalizeProductForDefaultBag(item.product?.productName);
    const bagType = resolveHanwhaBagType(item.hanwhaBagType, item.product?.productName);
    return productName === 'MLLDPE<M1605EN>'
        && bagType === 'FFS'
        && Boolean(item.product?.hanwhaItemCode?.trim() || item.product?.hanwhaMaterialName?.trim());
}

function isWarehouseOutbound(fulfillmentType: string | null | undefined, isInternalPurchaseOnly: boolean) {
    return fulfillmentType === 'WAREHOUSE' && !isInternalPurchaseOnly;
}

export async function setDefaultDeliveryAddress(addressId: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '濡쒓렇?몄씠 ?꾩슂?⑸땲??' };
    if (!addressId) return { ok: false, error: '?꾩갑吏瑜??좏깮??二쇱꽭??' };

    const address = await prisma.deliveryAddress.findUnique({
        where: { id: addressId },
        select: { id: true, customerId: true, isActive: true },
    });
    if (!address || !address.isActive) return { ok: false, error: '?꾩갑吏瑜?李얠쓣 ???놁뒿?덈떎.' };
    if (session.user.userKind === 'customer' && session.user.customerId !== address.customerId) {
        return { ok: false, error: '蹂몄씤 嫄곕옒泥섏쓽 ?꾩갑吏留?蹂寃쏀븷 ???덉뒿?덈떎.' };
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

export async function updateDeliveryAddressDefaultRequest(
    addressId: string,
    field: 'driverCustomerNotice' | 'orderExtraRequest',
    value: string,
): Promise<ChangeStatusResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '濡쒓렇?몄씠 ?꾩슂?⑸땲??' };
    if (session.user.userKind !== 'staff') return { ok: false, error: '吏곸썝留??꾩갑吏 ?뷀뤃?멸컪????ν븷 ???덉뒿?덈떎.' };
    if (!addressId) return { ok: false, error: '?꾩갑吏瑜??좏깮??二쇱꽭??' };

    const address = await prisma.deliveryAddress.findUnique({
        where: { id: addressId },
        select: { id: true, isActive: true },
    });
    if (!address || !address.isActive) return { ok: false, error: '?꾩갑吏瑜?李얠쓣 ???놁뒿?덈떎.' };

    const nextValue = value.trim() || null;
    await prisma.deliveryAddress.update({
        where: { id: addressId },
        data: field === 'driverCustomerNotice'
            ? { defaultDriverCustomerNotice: nextValue }
            : { defaultOrderExtraRequest: nextValue },
    });

    revalidatePath('/admin/orders/new');
    return { ok: true };
}

const SPLIT_REMAINING_ORDER_STATUSES = new Set([
    'DISPATCH_COMPLETED',
    'SHIPPED',
]);

function addDays(date: Date, days: number) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function nextMonthFirst(date: Date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

function dateToIso(date: Date | null | undefined) {
    if (!date) return '-';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateToYmd(date: Date | null | undefined) {
    if (!date) return '';
    return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

function isLaterDate(a: Date | null | undefined, b: Date | null | undefined) {
    if (!a || !b) return false;
    const ad = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
    const bd = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
    return ad > bd;
}

function quantityToMetricTon(quantity: number, unit: string | null | undefined) {
    const normalizedUnit = (unit ?? '').trim().toUpperCase();
    if (normalizedUnit === 'KG') return quantity / 1000;
    return quantity;
}

function withPurchaseCarryoverSalesPrefix(value: string | null | undefined, date: Date | null | undefined) {
    if (!date) return value ?? null;
    const prefix = `${date.getMonth() + 1}월매출`;
    const text = value?.trim() ?? '';
    if (!text) return prefix;
    if (text.startsWith(prefix)) return text;
    return `${prefix} ${text}`;
}

function hanwhaQueue() {
    globalForHanwhaAction.__hanyangHanwhaOrderQueue ??= [];
    globalForHanwhaAction.__hanyangHanwhaOrderJobs ??= new Map();
    return {
        queue: globalForHanwhaAction.__hanyangHanwhaOrderQueue,
        jobs: globalForHanwhaAction.__hanyangHanwhaOrderJobs,
    };
}

function hanwhaJobPosition(jobId: string) {
    const { queue } = hanwhaQueue();
    const index = queue.findIndex((job) => job.id === jobId);
    return index >= 0 ? index + 1 : 0;
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
 * 二쇰Ц ?앹꽦 (嫄곕옒泥?吏곸썝 怨듯넻)
 * - 嫄곕옒泥?濡쒓렇?? customerId媛 蹂몄씤怨??쇱튂?댁빞 ??
 * - 吏곸썝 濡쒓렇?? ?대뼡 嫄곕옒泥섎뱺 媛??
 * - 紐⑤뱺 ?꾩닔媛?寃利?
 */
export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '濡쒓렇?몄씠 ?꾩슂?⑸땲??' };

    // ?? ?낅젰 寃利????????????????????????????????????????????????
    if (!input.customerId) return { ok: false, error: '嫄곕옒泥섎? ?좏깮?댁＜?몄슂.' };
    if (!input.deliveryAddressId && !input.deliveryAddressName?.trim())
        return { ok: false, error: '?꾩갑吏瑜??좏깮?댁＜?몄슂.' };
    if (!input.orderDate) return { ok: false, error: '二쇰Ц?쇱옄瑜??낅젰?댁＜?몄슂.' };
    if (!input.deliveryDate) return { ok: false, error: '?꾩갑?쇱옄瑜??낅젰?댁＜?몄슂.' };
    if (!input.items || input.items.length === 0)
        return { ok: false, error: '?쒗뭹??1媛??댁긽 ?좏깮?댁＜?몄슂.' };

    for (const it of input.items) {
        if (!it.productId) return { ok: false, error: '紐⑤뱺 ?쒗뭹???좏깮?댁＜?몄슂.' };
        if (!Number.isFinite(it.quantity) || it.quantity <= 0)
            return { ok: false, error: '紐⑤뱺 ?쒗뭹???섎웾???낅젰?댁＜?몄슂.' };
        if (!['WAREHOUSE', 'DIRECT'].includes(it.fulfillmentType ?? '')) {
            return { ok: false, error: '紐⑤뱺 ?쒗뭹??李쎄퀬/吏곸넚???좏깮?댁＜?몄슂.' };
        }
        const salesUnitPrice = toOptionalPrice(it.salesUnitPrice);
        const purchaseUnitPrice = toOptionalPrice(it.purchaseUnitPrice);
        if (Number.isNaN(salesUnitPrice) || Number.isNaN(purchaseUnitPrice)) {
            return { ok: false, error: '?④????レ옄濡??낅젰?댁＜?몄슂.' };
        }
        if ((salesUnitPrice != null && salesUnitPrice < 0) || (purchaseUnitPrice != null && purchaseUnitPrice < 0)) {
            return { ok: false, error: '?④???0 ?댁긽?쇰줈 ?낅젰?댁＜?몄슂.' };
        }
    }

    // ?? 沅뚰븳 寃利????????????????????????????????????????????????
    if (session.user.userKind === 'customer') {
        if (session.user.customerId !== input.customerId) {
            return { ok: false, error: '蹂몄씤 嫄곕옒泥섏쓽 二쇰Ц留??앹꽦?????덉뒿?덈떎.' };
        }
    }

    const isStaff = session.user.userKind === 'staff';
    const productIdsForDefaults = Array.from(new Set(input.items.map((it) => it.productId)));
    const [inputCustomer, productsForDefaults, activeCompanies, hanwhaSupplier] = await Promise.all([
        prisma.customer.findUnique({ where: { id: input.customerId }, select: { companyName: true, receivableAmount: true, creditLimit: true, openingReceivable: true, openingReceivableDate: true } }),
        prisma.product.findMany({
            where: { id: { in: productIdsForDefaults }, isActive: true },
            select: {
                id: true,
                productCode: true,
                productName: true,
                defaultSalesEntityId: true,
                defaultPurchaseEntityId: true,
                defaultSupplierId: true,
                hanwhaMaterialName: true,
                hanwhaItemCode: true,
            },
        }),
        prisma.companyEntity.findMany({
            where: { isActive: true },
            select: { id: true, code: true, displayName: true, legalName: true, isDefaultSales: true, isDefaultPurchase: true },
        }),
        prisma.supplier.findFirst({
            where: { isActive: true, supplierName: { contains: '한화솔루션' } },
            select: { id: true },
        }),
    ]);
    if (!inputCustomer) return { ok: false, error: '嫄곕옒泥섎? 李얠쓣 ???놁뒿?덈떎.' };
    const isInternalPurchaseOnly = isHanyangCustomerName(inputCustomer.companyName);
    const productMap = new Map(productsForDefaults.map((product) => [product.id, product]));
    const companyIds = new Set(activeCompanies.map((company) => company.id));
    const hanyangEntityId = activeCompanies.find((company) =>
        company.code === 'HANYANG_PETRO'
        || normalizeCompanyName(company.displayName) === '?쒖뼇?좏솕'
        || normalizeCompanyName(company.legalName) === '?쒖뼇?좏솕'
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
            if (!product) throw new Error(`${index + 1}번째 품목을 찾을 수 없습니다.`);
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
                    ? (
                        it.purchaseSupplierId
                        || product.defaultSupplierId
                        // A direct-sale Hanwha product must never lose its
                        // supplier simply because a client-side combobox value
                        // did not reach the save request.
                        || ((product.hanwhaItemCode?.trim() || product.hanwhaMaterialName?.trim()) ? hanwhaSupplier?.id ?? null : null)
                    )
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
                hanwhaBagType: resolveHanwhaBagType(it.hanwhaBagType, product.productName),
                salesUnitPrice: isStaff && !isInternalPurchaseOnly ? toOptionalPrice(it.salesUnitPrice) : null,
                purchaseUnitPrice: isStaff ? toOptionalPrice(it.purchaseUnitPrice) : null,
            };
        });
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : '?덈ぉ 湲곕낯媛??뺤씤 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.' };
    }

    const creditMonth = new Date().toISOString().slice(0, 7);
    let estimatedOrderAmount = 0;
    for (const item of resolvedItems) {
        const unitPrice = item.salesUnitPrice ?? await getEffectivePrice(item.productId, creditMonth);
        estimatedOrderAmount += unitPrice * item.quantity;
    }
    const currentReceivable = await calculateCustomerReceivable(input.customerId) ?? inputCustomer.receivableAmount;
    const projectedReceivable = currentReceivable + estimatedOrderAmount;
    const isCreditOver = inputCustomer.creditLimit > 0 && projectedReceivable > inputCustomer.creditLimit;
    const creditOverAmount = Math.max(0, projectedReceivable - inputCustomer.creditLimit);
    // 직원이 직접 등록한 일반 주문은 매입처까지 확정된 내부 등록이므로
    // 별도의 오더 승인 단계를 거치지 않는다. 여신초과는 기존 승인 절차를 유지한다.
    const initialStatus = isCreditOver
        ? 'CREDIT_OVER_LIMIT'
        : isStaff
            ? 'APPROVED'
            : 'REQUESTED';

    // ?? ?꾩갑吏 寃利? ID媛 ?덉쑝硫?湲곗〈 ?꾩갑吏 寃利? ?놁쑝硫?二쇰Ц ?앹꽦 ???먮룞 ?앹꽦 ??
    let resolvedAddressId = input.deliveryAddressId;
    const deliveryAddressName = input.deliveryAddressName?.trim();
    if (resolvedAddressId) {
        // ?? ?꾩갑吏 寃利??????????????????????????????????????????????
        const addr = await prisma.deliveryAddress.findUnique({
            where: { id: resolvedAddressId },
            select: { id: true, customerId: true, isActive: true },
        });
        if (!addr || addr.customerId !== input.customerId || !addr.isActive) {
            return { ok: false, error: '?꾩갑吏媛 嫄곕옒泥섏? ?쇱튂?섏? ?딆뒿?덈떎.' };
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
                status: { not: 'REJECTED' },
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
                error: `동일 도착일로 같은 품목/수량/거래처 주문이 이미 있습니다. (${duplicateOrderNos.join(', ')}) 그래도 추가 오더로 저장하시겠습니까?`,
            };
        }
    }

    // ?? ?몃옖??뀡?쇰줈 二쇰Ц ?앹꽦 ??????????????????????????????????
    try {
        const sameDayDelivery = Boolean(input.sameDayDelivery && isStaff);
        const requestedDeliveryDate = new Date(input.deliveryDate + 'T00:00:00');
        const requestedPurchaseDate = new Date(input.orderDate + 'T00:00:00');
        const salesLedgerDate = input.shipAhead && isStaff && !sameDayDelivery ? nextMonthFirst(requestedDeliveryDate) : null;
        const purchaseLedgerDate = input.purchaseCarryover && isStaff && !sameDayDelivery
            ? nextMonthFirst(requestedPurchaseDate)
            : sameDayDelivery
                ? requestedDeliveryDate
            : requestedPurchaseDate;
        const driverCustomerNotice = input.driverCustomerNotice?.trim() || null;
        const orderExtraRequest = input.orderExtraRequest?.trim() || null;
        const order = await prisma.$transaction(async (tx) => {
            if (!resolvedAddressId) {
                const newAddr = await tx.deliveryAddress.create({
                    data: {
                        customerId: input.customerId,
                        label: deliveryAddressName!,
                        addressLine1: deliveryAddressName!,
                        isDefault: false,
                        isActive: true,
                        memo: '二쇰Ц ?깅줉 ???먮룞 ?앹꽦',
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
                    status: initialStatus,
                    creditWarningLevel: isCreditOver ? 2 : projectedReceivable >= inputCustomer.creditLimit * 0.8 && inputCustomer.creditLimit > 0 ? 1 : 0,
                    estimatedAmount: estimatedOrderAmount,
                    requestedDeliveryDate,
                    sameDayDelivery,
                    driverCustomerNotice,
                    orderExtraRequest,
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
                            salesLedgerDate,
                            purchaseLedgerDate,
                            unit: 'TON',
                        })),
                    },
                    statusHistory: {
                        create: {
                            previousStatus: null,
                            newStatus: initialStatus,
                            changedByUserId:
                                session.user.userKind === 'staff' ? session.user.id : undefined,
                            changeReason: isCreditOver
                                ? `주문 등록 - 여신한도 ${creditOverAmount.toLocaleString('ko-KR')}원 초과, 여신초과 승인 필요`
                                : salesLedgerDate || purchaseLedgerDate
                                    ? `주문 등록 - ${[
                                        salesLedgerDate ? `매출일자 ${dateToIso(salesLedgerDate)}` : null,
                                        purchaseLedgerDate ? `매입일자 ${dateToIso(purchaseLedgerDate)}` : null,
                                    ].filter(Boolean).join(' / ')}`
                                    : '주문 등록',
                        },
                    },
                },
                include: { items: true },
            });
            if (isCreditOver) {
                await tx.creditOverrideRequest.create({
                    data: {
                        orderId: created.id,
                        currentReceivable,
                        creditLimit: inputCustomer.creditLimit,
                        overAmount: creditOverAmount,
                        status: 'PENDING',
                        requestedById: session.user.userKind === 'staff' ? session.user.id : undefined,
                    },
                });
            }
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

        // ?붿씠?몃━?ㅽ듃 ?먮룞 異붽? (嫄곕옒泥섎퀎 ?먯＜ 二쇰Ц?섎뒗 ?쒗뭹 ?숈뒿)
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

        // Staff orders with a Hanwha purchase supplier are approved at save
        // time. Queue the e-Sales work here, not after a detail page mount.
        const resolvedSupplierIds = Array.from(new Set(
            resolvedItems
                .map((item) => item.purchaseSupplierId)
                .filter((supplierId): supplierId is string => Boolean(supplierId)),
        ));
        const hasHanwhaPurchaseSupplier = resolvedSupplierIds.length > 0 && Boolean(await prisma.supplier.findFirst({
            where: {
                id: { in: resolvedSupplierIds },
                isActive: true,
                supplierName: { contains: '한화솔루션' },
            },
            select: { id: true },
        }));
        let hanwhaOrderQueued = false;
        if (isStaff && initialStatus === 'APPROVED' && hasHanwhaPurchaseSupplier) {
            const queued = await enqueueHanwhaNewOrder(order.id, true);
            hanwhaOrderQueued = queued.ok;
            if (!queued.ok) {
                console.error(`Unable to queue automatic Hanwha order for ${order.orderNo}: ${queued.error}`);
            }
        }

        revalidatePath('/admin');
        revalidatePath('/portal');

        return {
            ok: true,
            orderId: order.id,
            orderNo: order.orderNo,
            status: initialStatus,
            creditOver: isCreditOver,
            creditOverMessage: isCreditOver
                ? `여신한도 초과 상태로 저장되었습니다. 초과액 ${creditOverAmount.toLocaleString('ko-KR')}원. 여신초과 승인 전에는 오더승인으로 진행할 수 없습니다.`
                : undefined,
            hanwhaOrderQueued,
        };
    } catch (e) {
        console.error('createOrder failed:', e);
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            return { ok: false, error: '주문번호가 중복되었습니다. 다시 한 번 저장해주세요.' };
        }
        return { ok: false, error: '주문 저장 중 오류가 발생했습니다.' };
    }
}

// ?????????????????????????????????????????????????????????????
// 二쇰Ц ?곹깭 蹂寃?(吏곸썝 ?꾩슜): ?뱀씤 / 蹂대쪟 / 諛섎젮 / 痍⑥냼
// ?????????????????????????????????????????????????????????????
export type ChangeStatusResult = { ok: true } | { ok: false; error: string };

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
    REQUESTED: ['APPROVED', 'REJECTED'],
    CREDIT_OVER_LIMIT: ['APPROVED', 'REJECTED'],
    APPROVED: ['DISPATCHING', 'REJECTED'],
    DISPATCHING: ['DISPATCH_COMPLETED', 'REJECTED'],
    DISPATCH_COMPLETED: ['SHIPPED', 'REJECTED'],
};

export async function changeOrderStatus(
    orderId: string,
    nextStatus: string,
    reason?: string,
): Promise<ChangeStatusResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '濡쒓렇?몄씠 ?꾩슂?⑸땲??' };
    if (session.user.userKind !== 'staff') {
        return { ok: false, error: '吏곸썝留??곹깭瑜?蹂寃쏀븷 ???덉뒿?덈떎.' };
    }

    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { customer: { select: { companyName: true } }, creditOverride: true },
    });
    if (!order) return { ok: false, error: '二쇰Ц??李얠쓣 ???놁뒿?덈떎.' };

    const currentStatus = normalizeOrderStatus(order.status);
    if (!isCanonicalOrderStatus(nextStatus)) {
        return { ok: false, error: '사용하지 않는 주문 상태입니다.' };
    }

    const allowed = ALLOWED_TRANSITIONS[currentStatus] ?? [];
    if (!allowed.includes(nextStatus)) {
        return {
            ok: false,
            error: `'${currentStatus}' 상태에서 '${nextStatus}'로 변경할 수 없습니다.`,
        };
    }

    if (nextStatus === 'APPROVED') {
        if (currentStatus === 'CREDIT_OVER_LIMIT' && order.creditOverride?.status !== 'APPROVED') {
            return {
                ok: false,
                error: '여신초과 오더는 여신초과 승인 완료 후에만 오더승인으로 진행할 수 있습니다.',
            };
        }
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
                error: `오더 승인 전 모든 품목의 매입처를 저장해야 합니다. 미확정: ${missingSupplierItems.map((item) => item.product.productName).join(', ')}`,
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
    if (!session?.user) return { ok: false, error: '濡쒓렇?몄씠 ?꾩슂?⑸땲??' };
    if (session.user.userKind !== 'staff') {
        return { ok: false, error: '吏곸썝留??곹깭瑜?蹂寃쏀븷 ???덉뒿?덈떎.' };
    }
    if (!reason?.trim()) return { ok: false, error: '?곹깭 蹂寃??ъ쑀瑜??낅젰?댁＜?몄슂.' };

    const allowedStatuses = ORDER_STATUS_VALUES as string[];
    if (!allowedStatuses.includes(nextStatus)) {
        return { ok: false, error: '議댁옱?섏? ?딅뒗 二쇰Ц ?곹깭?낅땲??' };
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.deletedAt) return { ok: false, error: '二쇰Ц??李얠쓣 ???놁뒿?덈떎.' };
    if (normalizeOrderStatus(order.status) === nextStatus) return { ok: false, error: '이미 같은 주문 상태입니다.' };

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
        return { ok: false, error: '도착일 형식이 올바르지 않습니다.' };
    }
    if (!reason?.trim()) return { ok: false, error: '도착일 수정 사유를 입력해 주세요.' };

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
            if (order.sameDayDelivery) {
                await tx.orderItem.updateMany({
                    where: { orderId },
                    data: {
                        salesLedgerDate: null,
                        purchaseLedgerDate: nextDate,
                    },
                });
                await tx.ledgerEntry.updateMany({
                    where: { orderItem: { orderId }, ledgerType: 'SALES' },
                    data: { transactionDate: nextDate },
                });
                await tx.ledgerEntry.updateMany({
                    where: {
                        ledgerType: 'PURCHASE',
                        OR: [
                            { orderId },
                            { orderItem: { orderId } },
                        ],
                    },
                    data: { transactionDate: nextDate },
                });
            }
            await tx.orderStatusHistory.create({
                data: {
                    orderId,
                    previousStatus: order.status,
                    newStatus: order.status,
                    changedByUserId: session.user.id,
                    changeReason: `[도착일 수정] ${currentDateValue} -> ${nextDeliveryDate} / ${reason.trim()}`,
                },
            });
            await syncOrderWarehouseStockMovements(tx, orderId);
        });
        revalidatePath('/admin');
        revalidatePath(`/admin/orders/${orderId}`);
        revalidatePath('/portal');
        revalidatePath(`/portal/orders/${orderId}`);
        revalidatePath('/admin/today-shipping');
        return { ok: true };
    } catch (e) {
        console.error('updateOrderDeliveryDate failed:', e);
        return { ok: false, error: '도착일 수정 중 오류가 발생했습니다.' };
    }
}

export async function updateOrderCustomerAndDeliveryAddress(
    orderId: string,
    nextCustomerId: string,
    nextDeliveryAddressId: string,
    reason?: string,
): Promise<ChangeStatusResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '濡쒓렇?몄씠 ?꾩슂?⑸땲??' };
    if (session.user.userKind !== 'staff') {
        return { ok: false, error: '吏곸썝留?嫄곕옒泥섏? ?꾩갑吏瑜??섏젙?????덉뒿?덈떎.' };
    }
    if (!nextCustomerId || !nextDeliveryAddressId) {
        return { ok: false, error: '嫄곕옒泥섏? ?꾩갑吏瑜?紐⑤몢 ?좏깮?댁＜?몄슂.' };
    }

    const [order, nextCustomer, nextAddress] = await Promise.all([
        prisma.order.findUnique({
            where: { id: orderId },
            include: {
                customer: { select: { id: true, companyName: true, customerCode: true } },
                deliveryAddress: { select: { id: true, label: true, addressLine1: true } },
            },
        }),
        prisma.customer.findUnique({
            where: { id: nextCustomerId },
            select: { id: true, companyName: true, customerCode: true, isActive: true },
        }),
        prisma.deliveryAddress.findUnique({
            where: { id: nextDeliveryAddressId },
            select: { id: true, customerId: true, label: true, addressLine1: true, isActive: true },
        }),
    ]);

    if (!order || order.deletedAt) return { ok: false, error: '二쇰Ц??李얠쓣 ???놁뒿?덈떎.' };
    if (!nextCustomer || !nextCustomer.isActive) return { ok: false, error: '?ъ슜 媛?ν븳 嫄곕옒泥섎? ?좏깮?댁＜?몄슂.' };
    if (!nextAddress || !nextAddress.isActive) return { ok: false, error: '?ъ슜 媛?ν븳 ?꾩갑吏瑜??좏깮?댁＜?몄슂.' };
    if (nextAddress.customerId !== nextCustomer.id) {
        return { ok: false, error: '?좏깮???꾩갑吏媛 ?대떦 嫄곕옒泥섏뿉 ?랁븯吏 ?딆뒿?덈떎.' };
    }
    if (order.customerId === nextCustomer.id && order.deliveryAddressId === nextAddress.id) {
        return { ok: true };
    }

    const beforeCustomer = `${order.customer.companyName}${order.customer.customerCode ? `(${order.customer.customerCode})` : ''}`;
    const afterCustomer = `${nextCustomer.companyName}${nextCustomer.customerCode ? `(${nextCustomer.customerCode})` : ''}`;
    const beforeAddress = `${order.deliveryAddress.label} ${order.deliveryAddress.addressLine1}`.trim();
    const afterAddress = `${nextAddress.label} ${nextAddress.addressLine1}`.trim();
    const trimmedReason = reason?.trim();

    try {
        await prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id: orderId },
                data: {
                    customerId: nextCustomer.id,
                    deliveryAddressId: nextAddress.id,
                },
            });
            await tx.ledgerEntry.updateMany({
                where: {
                    ledgerType: 'SALES',
                    OR: [
                        { orderId },
                        { orderItem: { orderId } },
                    ],
                },
                data: {
                    customerId: nextCustomer.id,
                    counterpartyCode: nextCustomer.customerCode,
                    counterpartyName: nextCustomer.companyName,
                },
            });
            await tx.orderStatusHistory.create({
                data: {
                    orderId,
                    previousStatus: order.status,
                    newStatus: order.status,
                    changedByUserId: session.user.id,
                    changeReason: `[嫄곕옒泥??꾩갑吏 ?섏젙] ${beforeCustomer} / ${beforeAddress} -> ${afterCustomer} / ${afterAddress}${trimmedReason ? ` / ${trimmedReason}` : ''}`,
                },
            });
        });
        revalidatePath('/admin');
        revalidatePath(`/admin/orders/${orderId}`);
        revalidatePath('/admin/ledger');
        revalidatePath(`/admin/customers/${order.customerId}/ledger`);
        revalidatePath(`/admin/customers/${nextCustomer.id}/ledger`);
        return { ok: true };
    } catch (e) {
        console.error('updateOrderCustomerAndDeliveryAddress failed:', e);
        return { ok: false, error: '嫄곕옒泥??꾩갑吏 ?섏젙 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.' };
    }
}

export async function updateOrderSalesLedgerDateMode(
    orderId: string,
    shipAhead: boolean,
    reason?: string,
): Promise<ChangeStatusResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '濡쒓렇?몄씠 ?꾩슂?⑸땲??' };
    if (session.user.userKind !== 'staff') {
        return { ok: false, error: '吏곸썝留?留ㅼ텧?쇱옄瑜??섏젙?????덉뒿?덈떎.' };
    }

    const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
            id: true,
            orderNo: true,
            createdAt: true,
            status: true,
            hanwhaOrderedAt: true,
            deletedAt: true,
            requestedDeliveryDate: true,
            items: { select: { id: true, salesLedgerDate: true } },
        },
    });
    if (!order || order.deletedAt) return { ok: false, error: '二쇰Ц??李얠쓣 ???놁뒿?덈떎.' };
    if (!order.requestedDeliveryDate) return { ok: false, error: '?꾩갑?쇱옄媛 ?놁뼱 ?좎텧??留ㅼ텧?쇱옄瑜?怨꾩궛?????놁뒿?덈떎.' };
    if (order.items.length === 0) return { ok: false, error: '?섏젙???덈ぉ???놁뒿?덈떎.' };

    const deliveryDate = order.requestedDeliveryDate;
    const nextDate = shipAhead ? nextMonthFirst(deliveryDate) : null;
    const currentDates = Array.from(new Set(order.items.map((item) => item.salesLedgerDate ? dateToIso(item.salesLedgerDate) : '?꾩갑??湲곗?')));
    const currentText = currentDates.length === 1 ? currentDates[0] : currentDates.join(', ');
    const nextText = nextDate ? dateToIso(nextDate) : '?꾩갑??湲곗?';
    if (currentDates.length === 1 && currentText === nextText) {
        return { ok: false, error: '?대? 媛숈? 留ㅼ텧?쇱옄 ?ㅼ젙?낅땲??' };
    }

    try {
        await prisma.$transaction(async (tx) => {
            await tx.orderItem.updateMany({
                where: { orderId },
                data: { salesLedgerDate: nextDate },
            });
            if (shipAhead) {
                await tx.order.update({
                    where: { id: orderId },
                    data: { sameDayDelivery: false },
                });
            }
            await tx.ledgerEntry.updateMany({
                where: { orderItem: { orderId }, ledgerType: 'SALES' },
                data: { transactionDate: nextDate ?? deliveryDate },
            });
            await tx.orderStatusHistory.create({
                data: {
                    orderId,
                    previousStatus: order.status,
                    newStatus: order.status,
                    changedByUserId: session.user.id,
                    changeReason: `[留ㅼ텧?쇱옄 蹂寃? ${currentText} ??${nextText}${reason?.trim() ? ` / ${reason.trim()}` : ''}`,
                },
            });
        });
        revalidatePath('/admin');
        revalidatePath(`/admin/orders/${orderId}`);
        revalidatePath(`/portal/orders/${orderId}`);
        revalidatePath('/admin/ledger');
        revalidatePath('/admin/today-shipping');
        return { ok: true };
    } catch (e) {
        console.error('updateOrderSalesLedgerDateMode failed:', e);
        return { ok: false, error: '留ㅼ텧?쇱옄 蹂寃?以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.' };
    }
}

export async function updateOrderPurchaseLedgerDateMode(
    orderId: string,
    carryover: boolean,
    reason?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
    const session = await auth();
    if (!session?.user || session.user.userKind !== 'staff') return { ok: false, error: '직원만 변경할 수 있습니다.' };

    const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
            id: true,
            orderNo: true,
            createdAt: true,
            status: true,
            requestedDeliveryDate: true,
            deletedAt: true,
            items: { select: { id: true, purchaseLedgerDate: true } },
        },
    });
    if (!order || order.deletedAt) return { ok: false, error: '주문을 찾을 수 없습니다.' };
    if (!order.requestedDeliveryDate) return { ok: false, error: '도착일자가 없어 매입이월 일자를 계산할 수 없습니다.' };

    const basePurchaseDate = purchaseRequestDateFromOrderNo(order.orderNo) ?? order.createdAt;
    const nextDate = carryover ? nextMonthFirst(basePurchaseDate) : basePurchaseDate;
    const currentDates = Array.from(new Set(order.items.map((item) => dateToIso(item.purchaseLedgerDate ?? basePurchaseDate))));
    const nextLabel = dateToIso(nextDate);

    try {
        await prisma.$transaction(async (tx) => {
            await tx.orderItem.updateMany({
                where: { orderId: order.id },
                data: { purchaseLedgerDate: nextDate },
            });
            if (carryover) {
                await tx.order.update({
                    where: { id: order.id },
                    data: { sameDayDelivery: false },
                });
            }
            await tx.ledgerEntry.updateMany({
                where: { orderId: order.id, ledgerType: 'PURCHASE' },
                data: { transactionDate: nextDate },
            });
            await tx.orderStatusHistory.create({
                data: {
                    orderId: order.id,
                    previousStatus: order.status,
                    newStatus: order.status,
                    changedByUserId: session.user.id,
                    changeReason: `[매입이월 ${carryover ? '설정' : '해제'}] 매입일자 ${currentDates.join(', ')} -> ${nextLabel}${reason ? ` / ${reason}` : ''}`,
                },
            });
        });
        revalidatePath(`/admin/orders/${order.id}`);
        revalidatePath('/admin/reports/sales-daily');
        revalidatePath('/admin/reports/performance');
        revalidatePath('/admin/ledger');
        revalidatePath('/admin/today-shipping');
        return { ok: true };
    } catch (e) {
        console.error('updateOrderPurchaseLedgerDateMode failed:', e);
        return { ok: false, error: '매입일자 변경 중 오류가 발생했습니다.' };
    }
}

export async function updateOrderSameDayDeliveryMode(
    orderId: string,
    sameDayDelivery: boolean,
    reason?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
    const session = await auth();
    if (!session?.user || session.user.userKind !== 'staff') return { ok: false, error: '직원만 변경할 수 있습니다.' };

    const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
            id: true,
            orderNo: true,
            createdAt: true,
            status: true,
            requestedDeliveryDate: true,
            sameDayDelivery: true,
            deletedAt: true,
            items: { select: { id: true, salesLedgerDate: true, purchaseLedgerDate: true } },
        },
    });
    if (!order || order.deletedAt) return { ok: false, error: '주문을 찾을 수 없습니다.' };
    if (!order.requestedDeliveryDate) return { ok: false, error: '도착일자가 없어 당일도착 일자를 계산할 수 없습니다.' };
    if (order.items.length === 0) return { ok: false, error: '수정할 품목이 없습니다.' };

    const basePurchaseDate = purchaseRequestDateFromOrderNo(order.orderNo) ?? order.createdAt;
    const requestedDeliveryDate = order.requestedDeliveryDate;
    const nextPurchaseDate = sameDayDelivery ? requestedDeliveryDate : basePurchaseDate;
    const nextSalesDate = null;
    const currentPurchaseDates = Array.from(new Set(order.items.map((item) => dateToIso(item.purchaseLedgerDate ?? basePurchaseDate))));
    const currentSalesDates = Array.from(new Set(order.items.map((item) => item.salesLedgerDate ? dateToIso(item.salesLedgerDate) : '도착일 기준')));
    const nextPurchaseLabel = dateToIso(nextPurchaseDate);
    const nextSalesLabel = '도착일 기준';

    if (order.sameDayDelivery === sameDayDelivery) {
        return { ok: false, error: sameDayDelivery ? '이미 당일도착으로 설정되어 있습니다.' : '이미 당일도착이 해제되어 있습니다.' };
    }

    try {
        await prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id: order.id },
                data: { sameDayDelivery },
            });
            await tx.orderItem.updateMany({
                where: { orderId: order.id },
                data: {
                    salesLedgerDate: nextSalesDate,
                    purchaseLedgerDate: nextPurchaseDate,
                },
            });
            await tx.ledgerEntry.updateMany({
                where: { orderItem: { orderId: order.id }, ledgerType: 'SALES' },
                data: { transactionDate: requestedDeliveryDate },
            });
            await tx.ledgerEntry.updateMany({
                where: {
                    ledgerType: 'PURCHASE',
                    OR: [
                        { orderId: order.id },
                        { orderItem: { orderId: order.id } },
                    ],
                },
                data: { transactionDate: nextPurchaseDate },
            });
            await tx.orderStatusHistory.create({
                data: {
                    orderId: order.id,
                    previousStatus: order.status,
                    newStatus: order.status,
                    changedByUserId: session.user.id,
                    changeReason: `[당일도착 ${sameDayDelivery ? '설정' : '해제'}] 매출일자 ${currentSalesDates.join(', ')} -> ${nextSalesLabel} / 매입일자 ${currentPurchaseDates.join(', ')} -> ${nextPurchaseLabel}${reason ? ` / ${reason}` : ''}`,
                },
            });
        });
        revalidatePath(`/admin/orders/${order.id}`);
        revalidatePath('/admin/reports/sales-daily');
        revalidatePath('/admin/reports/performance');
        revalidatePath('/admin/ledger');
        revalidatePath('/admin/today-shipping');
        return { ok: true };
    } catch (e) {
        console.error('updateOrderSameDayDeliveryMode failed:', e);
        return { ok: false, error: '당일도착 변경 중 오류가 발생했습니다.' };
    }
}

export async function updateOrderPurchaseLedgerDate(
    orderId: string,
    nextPurchaseDate: string,
    reason: string,
): Promise<ChangeStatusResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff') {
        return { ok: false, error: '직원만 매입일자를 수정할 수 있습니다.' };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextPurchaseDate)) {
        return { ok: false, error: '매입일자 형식이 올바르지 않습니다.' };
    }
    if (!reason?.trim()) return { ok: false, error: '매입일자 수정 사유를 입력해 주세요.' };

    const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
            id: true,
            orderNo: true,
            createdAt: true,
            status: true,
            hanwhaOrderedAt: true,
            deletedAt: true,
            requestedDeliveryDate: true,
            items: { select: { id: true, purchaseLedgerDate: true } },
        },
    });
    if (!order || order.deletedAt) return { ok: false, error: '주문을 찾을 수 없습니다.' };
    if (order.items.length === 0) return { ok: false, error: '수정할 품목이 없습니다.' };

    const nextDate = new Date(nextPurchaseDate + 'T00:00:00');
    if (Number.isNaN(nextDate.getTime())) return { ok: false, error: '매입일자가 올바르지 않습니다.' };

    const fallbackPurchaseDate = purchaseRequestDateFromOrderNo(order.orderNo) ?? order.createdAt;
    const currentDates = Array.from(new Set(order.items.map((item) => dateToIso(item.purchaseLedgerDate ?? fallbackPurchaseDate))));
    const currentText = currentDates.length === 1 ? currentDates[0] : currentDates.join(', ');
    if (currentDates.length === 1 && currentText === nextPurchaseDate) {
        return { ok: false, error: '이미 같은 매입일자입니다.' };
    }

    try {
        await prisma.$transaction(async (tx) => {
            await tx.orderItem.updateMany({
                where: { orderId },
                data: { purchaseLedgerDate: nextDate },
            });
            await tx.ledgerEntry.updateMany({
                where: {
                    ledgerType: 'PURCHASE',
                    OR: [
                        { orderId },
                        { orderItem: { orderId } },
                    ],
                },
                data: { transactionDate: nextDate },
            });
            await tx.orderStatusHistory.create({
                data: {
                    orderId,
                    previousStatus: order.status,
                    newStatus: order.status,
                    changedByUserId: session.user.id,
                    changeReason: `[매입일자 수정] ${currentText} -> ${nextPurchaseDate} / ${reason.trim()}`,
                },
            });
        });
        revalidatePath('/admin');
        revalidatePath(`/admin/orders/${orderId}`);
        revalidatePath('/admin/ledger');
        revalidatePath('/admin/reports/sales-daily');
        revalidatePath('/admin/reports/performance');
        return { ok: true };
    } catch (e) {
        console.error('updateOrderPurchaseLedgerDate failed:', e);
        return { ok: false, error: '매입일자 수정 중 오류가 발생했습니다.' };
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
            return { ok: false, error: '도착일 당일 오전 11시 이후에는 변경 요청이 불가합니다. 담당자에게 연락해 주세요.' };
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
                    ? `[도착일 변경 요청 승인] ${currentDateText} -> ${nextDateText}${reviewMemo?.trim() ? ` / ${reviewMemo.trim()}` : ''}`
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
    if (!session?.user) return { ok: false, error: '濡쒓렇?몄씠 ?꾩슂?⑸땲??' };
    if (session.user.userKind !== 'staff') {
        return { ok: false, error: '吏곸썝留??섎웾???섏젙?????덉뒿?덈떎.' };
    }
    if (!Number.isFinite(nextQuantity) || nextQuantity <= 0) {
        return { ok: false, error: '?섎웾? 0蹂대떎 而ㅼ빞 ?⑸땲??' };
    }
    if (!reason?.trim()) return { ok: false, error: '?섎웾 ?섏젙 ?ъ쑀瑜??낅젰?댁＜?몄슂.' };

    const item = await prisma.orderItem.findUnique({
        where: { id: itemId },
        include: { order: true, product: { select: { productName: true } } },
    });
    if (!item || item.order.deletedAt) return { ok: false, error: '二쇰Ц ?덈ぉ??李얠쓣 ???놁뒿?덈떎.' };
    if (item.requestedQuantity === nextQuantity) return { ok: false, error: '?대? 媛숈? ?섎웾?낅땲??' };

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
                    changeReason: `[?섎웾 ?섏젙] ${item.product.productName}: ${previousQuantity}${item.unit} ??${nextQuantity}${item.unit} / ${reason.trim()}`,
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
        return { ok: false, error: '?섎웾 ?섏젙 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.' };
    }
}

// 嫄곕옒泥?蹂몄씤 二쇰Ц 痍⑥냼 (REQUESTED ?곹깭???뚮쭔)
export async function cancelOwnOrder(orderId: string): Promise<ChangeStatusResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '濡쒓렇?몄씠 ?꾩슂?⑸땲??' };
    if (session.user.userKind !== 'customer') {
        return { ok: false, error: '嫄곕옒泥?怨꾩젙留?媛?ν빀?덈떎.' };
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return { ok: false, error: '二쇰Ц??李얠쓣 ???놁뒿?덈떎.' };
    if (order.customerId !== session.user.customerId) {
        return { ok: false, error: '蹂몄씤 二쇰Ц留?痍⑥냼?????덉뒿?덈떎.' };
    }
    if (order.status !== 'REQUESTED') {
        return {
            ok: false,
            error: '?대? ?곸뾽??먯꽌 泥섎━ 以묒씠??痍⑥냼?????놁뒿?덈떎. ?대떦?먯뿉寃??곕씫?댁＜?몄슂.',
        };
    }

    try {
        await prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id: orderId },
                data: { status: 'REJECTED' },
            });
            await tx.orderStatusHistory.create({
                data: {
                    orderId,
                    previousStatus: order.status,
                    newStatus: 'REJECTED',
                    changeReason: `嫄곕옒泥??먭? 痍⑥냼 (${session.user.name ?? session.user.id})`,
                },
            });
        });
        revalidatePath('/portal');
        revalidatePath(`/portal/orders/${orderId}`);
        revalidatePath('/admin');
        return { ok: true };
    } catch (e) {
        console.error('cancelOwnOrder failed:', e);
        return { ok: false, error: '痍⑥냼 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.' };
    }
}

// ?????????????????????????????????????????????????????????????
// 二쇰Ц ?뚰봽????젣 (吏곸썝 ?꾩슜)
// ??젣 ?꾩뿉??/admin/orders/deleted ?먯꽌 議고쉶 媛??
// ?????????????????????????????????????????????????????????????
export async function softDeleteOrder(
    orderId: string,
    reason: string,
): Promise<ChangeStatusResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '濡쒓렇?몄씠 ?꾩슂?⑸땲??' };
    if (session.user.userKind !== 'staff') {
        return { ok: false, error: '吏곸썝留?二쇰Ц????젣?????덉뒿?덈떎.' };
    }
    if (!reason?.trim()) return { ok: false, error: '??젣 ?ъ쑀瑜??낅젰?댁＜?몄슂.' };

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return { ok: false, error: '二쇰Ц??李얠쓣 ???놁뒿?덈떎.' };
    if (order.deletedAt) return { ok: false, error: '?대? ??젣??二쇰Ц?낅땲??' };

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
                    changeReason: `[??젣] ${reason.trim()}`,
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
        return { ok: false, error: '??젣 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.' };
    }
}

// ===============================================================
// 二쇰Ц ?덈ぉ ?섏젙 (吏곸썝 ?꾩슜): ?덈ぉ 諛??섎웾 ?숈떆 蹂寃?
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
    if (!session?.user) return { ok: false, error: '濡쒓렇?몄씠 ?꾩슂?⑸땲??' };
    if (session.user.userKind !== 'staff') {
        return { ok: false, error: '吏곸썝留??덈ぉ???섏젙?????덉뒿?덈떎.' };
    }
    if (!nextProductId) return { ok: false, error: '?덈ぉ???좏깮??二쇱꽭??' };
    if (!Number.isFinite(nextQuantity) || nextQuantity <= 0) {
        return { ok: false, error: '?섎웾? 0蹂대떎 而ㅼ빞 ?⑸땲??' };
    }
    const nextSalesUnitPrice = toOptionalPrice(options?.salesUnitPrice);
    const nextPurchaseUnitPrice = toOptionalPrice(options?.purchaseUnitPrice);
    if (Number.isNaN(nextSalesUnitPrice) || Number.isNaN(nextPurchaseUnitPrice)) {
        return { ok: false, error: '?④????レ옄濡??낅젰??二쇱꽭??' };
    }
    if ((nextSalesUnitPrice != null && nextSalesUnitPrice < 0) || (nextPurchaseUnitPrice != null && nextPurchaseUnitPrice < 0)) {
        return { ok: false, error: '?④???0 ?댁긽?쇰줈 ?낅젰??二쇱꽭??' };
    }
    if (!reason?.trim()) return { ok: false, error: '?섏젙 ?ъ쑀瑜??낅젰??二쇱꽭??' };
    if (!['WAREHOUSE', 'DIRECT'].includes(options?.fulfillmentType ?? '')) {
        return { ok: false, error: '李쎄퀬/吏곸넚???좏깮??二쇱꽭??' };
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
    if (!item || item.order.deletedAt) return { ok: false, error: '二쇰Ц ??ぉ??李얠쓣 ???놁뒿?덈떎.' };
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
    if (!nextProduct) return { ok: false, error: '?좏깮???덈ぉ??李얠쓣 ???놁뒿?덈떎.' };

    const activeCompanies = await prisma.companyEntity.findMany({
        where: { isActive: true },
        select: { id: true, displayName: true, isDefaultSales: true, isDefaultPurchase: true },
    });
    const companyMap = new Map(activeCompanies.map((company) => [company.id, company]));
    const fallbackSalesEntityId = activeCompanies.find((company) => company.isDefaultSales)?.id ?? activeCompanies[0]?.id;
    const fallbackPurchaseEntityId = activeCompanies.find((company) => company.isDefaultPurchase)?.id ?? fallbackSalesEntityId;
    const nextSalesEntityId = isInternalPurchaseOnly ? (options?.purchaseEntityId || nextProduct.defaultPurchaseEntityId || fallbackPurchaseEntityId || fallbackSalesEntityId) : (options?.salesEntityId || nextProduct.defaultSalesEntityId || fallbackSalesEntityId);
    const nextPurchaseEntityId = options?.purchaseEntityId || nextProduct.defaultPurchaseEntityId || fallbackPurchaseEntityId || nextSalesEntityId;
    if (!isInternalPurchaseOnly && (!nextSalesEntityId || !companyMap.has(nextSalesEntityId))) return { ok: false, error: '留ㅼ텧二쇱껜瑜??좏깮??二쇱꽭??' };
    if (!nextPurchaseEntityId || !companyMap.has(nextPurchaseEntityId)) return { ok: false, error: '留ㅼ엯二쇱껜瑜??좏깮??二쇱꽭??' };

    const nextPurchaseSupplierId = options && 'purchaseSupplierId' in options
        ? (options.purchaseSupplierId || null)
        : (item.purchaseSupplierId || nextProduct.defaultSupplierId || null);
    let nextPurchaseSupplierName: string | null = null;
    if (nextPurchaseSupplierId) {
        const supplier = await prisma.supplier.findFirst({
            where: { id: nextPurchaseSupplierId, isActive: true },
            select: { supplierName: true },
        });
        if (!supplier) return { ok: false, error: '留ㅼ엯泥섎? ?좏깮??二쇱꽭??' };
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
    if (unchanged) return { ok: false, error: '蹂寃쎈맂 ?댁슜???놁뒿?덈떎.' };

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
                    hanwhaBagType: resolveHanwhaBagType(options?.hanwhaBagType, nextProduct.productName),
                    purchaseSupplierConfirmedAt: nextPurchaseSupplierId ? new Date() : null,
                    fulfillmentType: options!.fulfillmentType,
                    salesUnitPrice: isInternalPurchaseOnly ? null : nextSalesUnitPrice,
                    purchaseUnitPrice: nextPurchaseUnitPrice,
                    ...(!item.purchaseLedgerDate && nextPurchaseSupplierId
                        ? { purchaseLedgerDate: purchaseRequestDateFromOrderNo(item.order.orderNo) ?? item.order.createdAt }
                        : {}),
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
            // ?곌껐??LedgerEntry ?숆린??(orderItemId濡??곌껐???먯옣 ?곗씠??
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
                changeDesc.push(`?덈ぉ: ${item.product.productName} ??${nextProduct.productName}`);
            if (previousQuantity !== nextQuantity) {
                const splitText = options?.createBackorderForReducedQuantity && previousQuantity > nextQuantity && SPLIT_REMAINING_ORDER_STATUSES.has(item.order.status)
                    ? ` (미배차분 ${previousQuantity - nextQuantity}${item.unit} 익일 신규오더 생성)`
                    : '';
                changeDesc.push(`?섎웾: ${previousQuantity}${item.unit} ??${nextQuantity}${item.unit}${splitText}`);
            }
            if (item.salesEntityId !== nextSalesEntityId)
                changeDesc.push(`留ㅼ텧二쇱껜: ${item.salesEntity?.displayName ?? '-'} ??${companyMap.get(nextSalesEntityId)?.displayName ?? '-'}`);
            if (currentFulfillmentType !== options!.fulfillmentType)
                changeDesc.push(`李쎄퀬/吏곸넚: ${currentFulfillmentType === 'WAREHOUSE' ? '李쎄퀬' : currentFulfillmentType === 'DIRECT' ? '吏곸넚' : '-'} ??${options!.fulfillmentType === 'WAREHOUSE' ? '李쎄퀬' : '吏곸넚'}`);
            if ((item.purchaseSupplierId ?? null) !== nextPurchaseSupplierId || supplierConfirmationMissing)
                changeDesc.push(`留ㅼ엯泥? ${item.purchaseSupplier?.supplierName ?? '-'} ??${nextPurchaseSupplierName ?? '-'}`);
            if (!isInternalPurchaseOnly && (item.salesUnitPrice ?? null) !== nextSalesUnitPrice)
                changeDesc.push(`留ㅼ텧?④?: ${item.salesUnitPrice?.toLocaleString('ko-KR') ?? '-'} ??${nextSalesUnitPrice?.toLocaleString('ko-KR') ?? '-'}`);
            if ((item.purchaseUnitPrice ?? null) !== nextPurchaseUnitPrice)
                changeDesc.push(`留ㅼ엯?④?: ${item.purchaseUnitPrice?.toLocaleString('ko-KR') ?? '-'} ??${nextPurchaseUnitPrice?.toLocaleString('ko-KR') ?? '-'}`);
            await tx.orderStatusHistory.create({
                data: {
                    orderId: item.orderId,
                    previousStatus: item.order.status,
                    newStatus: item.order.status,
                    changedByUserId: session.user.id,
                    changeReason: `[?덈ぉ ?섏젙] ${changeDesc.join(', ')} / ${reason.trim()}`,
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
        return { ok: false, error: '?덈ぉ ?섏젙 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.' };
    }
}

export async function bulkConfirmOrderPurchaseSupplier(
    orderId: string,
    supplierId: string,
): Promise<ChangeStatusResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '濡쒓렇?몄씠 ?꾩슂?⑸땲??' };
    if (session.user.userKind !== 'staff') return { ok: false, error: '吏곸썝留?留ㅼ엯泥섎? ??ν븷 ???덉뒿?덈떎.' };
    if (!supplierId) return { ok: false, error: '留ㅼ엯泥섎? ?좏깮??二쇱꽭??' };

    const [order, supplier] = await Promise.all([
        prisma.order.findUnique({ where: { id: orderId }, select: { id: true, status: true, deletedAt: true, items: { select: { id: true } } } }),
        prisma.supplier.findFirst({ where: { id: supplierId, isActive: true }, select: { supplierName: true } }),
    ]);
    if (!order || order.deletedAt) return { ok: false, error: '二쇰Ц??李얠쓣 ???놁뒿?덈떎.' };
    if (!supplier) return { ok: false, error: '留ㅼ엯泥섎? 李얠쓣 ???놁뒿?덈떎.' };
    if (order.items.length === 0) return { ok: false, error: '??ν븷 ?덈ぉ???놁뒿?덈떎.' };

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
                    changeReason: `[留ㅼ엯泥??쇨큵 ??? ?꾩껜 ?덈ぉ ??${supplier.supplierName}`,
                },
            });
        });
        revalidatePath('/admin');
        revalidatePath(`/admin/orders/${orderId}`);
        return { ok: true };
    } catch (e) {
        console.error('bulkConfirmOrderPurchaseSupplier failed:', e);
        return { ok: false, error: '留ㅼ엯泥??쇨큵 ???以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.' };
    }
}

export async function prepareSupplierKakaoNotice(
    orderId: string,
    supplierId: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '濡쒓렇?몄씠 ?꾩슂?⑸땲??' };
    if (session.user.userKind !== 'staff') return { ok: false, error: '吏곸썝留??뚮┝?≪쓣 以鍮꾪븷 ???덉뒿?덈떎.' };

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
    if (!order || order.deletedAt) return { ok: false, error: '二쇰Ц??李얠쓣 ???놁뒿?덈떎.' };
    if (order.status !== 'APPROVED') return { ok: false, error: '?뚮┝??以鍮꾨뒗 ?ㅻ뜑 ?섎씫 ??媛?ν빀?덈떎.' };
    if (order.items.length === 0) return { ok: false, error: '?대떦 留ㅼ엯泥??덈ぉ???놁뒿?덈떎.' };

    const supplier = await prisma.supplier.findUnique({
        where: { id: supplierId },
        select: { supplierName: true, contactPerson: true, phone: true },
    });
    if (!supplier) return { ok: false, error: '留ㅼ엯泥섎? 李얠쓣 ???놁뒿?덈떎.' };
    if (!supplier.phone) return { ok: false, error: `${supplier.supplierName} ?대떦???꾪솕踰덊샇媛 ?놁뒿?덈떎.` };

    const deliveryAddress = compactJoin([
        order.deliveryAddress.label,
        order.deliveryAddress.addressLine1,
        order.deliveryAddress.addressLine2,
    ]);
    const itemLines = order.items.map((item) => (
        `- ${item.product.productName} (${item.product.productCode}): ${item.requestedQuantity}${item.unit}`
    ));
    const message = [
        `[?쒖뼇?좏솕 留ㅼ엯?ㅻ뜑] ${order.orderNo}`,
        `嫄곕옒泥? ${order.customer.companyName}`,
        `?꾩갑?? ${order.requestedDeliveryDate?.toISOString().slice(0, 10) ?? '-'}`,
        `?꾩갑吏: ${deliveryAddress || '-'}`,
        order.deliveryAddress.contactPhone ? `?꾩갑吏 ?곕씫泥? ${order.deliveryAddress.contactPhone}` : null,
        '?덈ぉ:',
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

export async function updateOrderNotes(
    orderId: string,
    notes: { driverCustomerNotice?: string; orderExtraRequest?: string },
): Promise<ChangeStatusResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '濡쒓렇?몄씠 ?꾩슂?⑸땲??' };
    if (session.user.userKind !== 'staff') return { ok: false, error: '吏곸썝留??붿껌?ы빆???섏젙?????덉뒿?덈떎.' };

    const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
            id: true,
            status: true,
            memo: true,
            driverCustomerNotice: true,
            orderExtraRequest: true,
            deliveryAddressId: true,
            deletedAt: true,
        },
    });
    if (!order || order.deletedAt) return { ok: false, error: '二쇰Ц??李얠쓣 ???놁뒿?덈떎.' };

    const hasDriverCustomerNotice = Object.prototype.hasOwnProperty.call(notes, 'driverCustomerNotice');
    const hasOrderExtraRequest = Object.prototype.hasOwnProperty.call(notes, 'orderExtraRequest');
    if (!hasDriverCustomerNotice && !hasOrderExtraRequest) return { ok: false, error: '??ν븷 ?댁슜???놁뒿?덈떎.' };

    const nextDriverCustomerNotice = hasDriverCustomerNotice
        ? notes.driverCustomerNotice?.trim() || null
        : order.driverCustomerNotice?.trim() || null;
    const nextOrderExtraRequest = hasOrderExtraRequest
        ? notes.orderExtraRequest?.trim() || null
        : (order.orderExtraRequest ?? order.memo)?.trim() || null;
    const currentDriverCustomerNotice = order.driverCustomerNotice?.trim() || null;
    const currentOrderExtraRequest = (order.orderExtraRequest ?? order.memo)?.trim() || null;
    if (nextDriverCustomerNotice === currentDriverCustomerNotice && nextOrderExtraRequest === currentOrderExtraRequest) {
        return { ok: false, error: '蹂寃쎈맂 ?댁슜???놁뒿?덈떎.' };
    }

    try {
        await prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id: orderId },
                data: {
                    ...(hasDriverCustomerNotice ? { driverCustomerNotice: nextDriverCustomerNotice } : {}),
                    ...(hasOrderExtraRequest ? { orderExtraRequest: nextOrderExtraRequest } : {}),
                },
            });
            await tx.orderStatusHistory.create({
                data: {
                    orderId,
                    previousStatus: order.status,
                    newStatus: order.status,
                    changedByUserId: session.user.id,
                    changeReason: hasDriverCustomerNotice && !hasOrderExtraRequest
                        ? '[湲곗궗 諛?怨좉컼 ?뚮┝?ы빆 ?섏젙]'
                        : hasOrderExtraRequest && !hasDriverCustomerNotice
                            ? '[二쇰Ц 異붽? ?붿껌?ы빆 ?섏젙]'
                            : '[?쒗솕 ?붿껌?ы빆 ?섏젙]',
                },
            });
        });
        revalidatePath('/admin');
        revalidatePath(`/admin/orders/${orderId}`);
        revalidatePath('/portal');
        revalidatePath(`/portal/orders/${orderId}`);
        return { ok: true };
    } catch (e) {
        console.error('updateOrderNotes failed:', e);
        return { ok: false, error: '?붿껌?ы빆 ?섏젙 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.' };
    }
}

export async function createMissingDispatchBackorder(
    orderId: string,
    deliveryDate: string,
    missingItems: Array<{ itemId: string; quantity: number }>,
): Promise<ChangeStatusResult & { backorderNo?: string }> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '濡쒓렇?몄씠 ?꾩슂?⑸땲??' };
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
                        order.orderExtraRequest ?? order.memo,
                    ], '\n'),
                    driverCustomerNotice: order.driverCustomerNotice,
                    orderExtraRequest: order.orderExtraRequest ?? order.memo,
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
                await tx.order.update({ where: { id: orderId }, data: { status: 'REJECTED' } });
                await tx.orderStatusHistory.create({
                    data: {
                        orderId,
                        previousStatus: order.status,
                        newStatus: 'REJECTED',
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

async function runHanwhaOrderJob(job: HanwhaOrderJob, approveAfterOrder: boolean) {
    const order = await prisma.order.findUnique({
        where: { id: job.orderId },
        select: {
            id: true,
            orderNo: true,
            createdAt: true,
            status: true,
            hanwhaOrderedAt: true,
            deletedAt: true,
            requestedDeliveryDate: true,
            driverCustomerNotice: true,
            orderExtraRequest: true,
            customer: { select: { companyName: true } },
            deliveryAddress: {
                select: {
                    label: true,
                    addressLine1: true,
                    addressLine2: true,
                },
            },
            items: {
                select: {
                    requestedQuantity: true,
                    unit: true,
                    hanwhaBagType: true,
                    purchaseLedgerDate: true,
                    product: {
                        select: {
                            productName: true,
                            productCode: true,
                            hanwhaMaterialName: true,
                            hanwhaItemCode: true,
                        },
                    },
                    purchaseSupplier: { select: { supplierName: true } },
                },
            },
        },
    });

    if (!order || order.deletedAt) {
        throw new Error('주문을 찾을 수 없습니다.');
    }
    const canRunReorder = Boolean(job.forceReorder && order.hanwhaOrderedAt && order.status === OrderStatus.DISPATCHING);
    if (order.status !== OrderStatus.APPROVED && !canRunReorder) {
        throw new Error('승인 완료된 주문에서만 한화 e-Sales를 열 수 있습니다.');
    }

    const hanwhaItems = order.items.filter(isHanwhaOrderItem);
    if (hanwhaItems.length === 0) {
        throw new Error('한화 e-Sales에 입력할 한화 품목이 없습니다. 매입처가 한화솔루션이거나 제품 DB에 한화 품목코드가 등록된 품목만 처리합니다.');
    }
    if (!order.requestedDeliveryDate) {
        throw new Error('납품요청일이 없어 한화 e-Sales 주문을 입력할 수 없습니다.');
    }

    const basePurchaseDate = purchaseRequestDateFromOrderNo(order.orderNo) ?? order.createdAt;
    const poDate = hanwhaItems.find((item) => isLaterDate(item.purchaseLedgerDate, basePurchaseDate))?.purchaseLedgerDate ?? null;
    const shipToAddress = compactJoin([
        order.deliveryAddress.addressLine1,
        order.deliveryAddress.addressLine2,
    ], ' ');
    const shipToName = order.deliveryAddress.label || order.customer.companyName;
    const hanwhaItemCodeRows = await prisma.hanwhaItemCode.findMany({
        select: { itemName: true, itemCode: true },
    });
    function findHanwhaDbItemCode(materialName: string) {
        const target = normalizeHanwhaItemName(materialName);
        const looseTarget = normalizeHanwhaItemNameLoose(materialName);
        if (!target) return null;
        return hanwhaItemCodeRows.find((row) => normalizeHanwhaItemName(row.itemName) === target)?.itemCode
            ?? hanwhaItemCodeRows.find((row) => normalizeHanwhaItemName(row.itemName).startsWith(`${target}_`))?.itemCode
            ?? hanwhaItemCodeRows.find((row) => normalizeHanwhaItemNameLoose(row.itemName) === looseTarget)?.itemCode
            ?? hanwhaItemCodeRows.find((row) => normalizeHanwhaItemNameLoose(row.itemName).startsWith(looseTarget))?.itemCode
            ?? null;
    }

    const hanwhaInput: HanwhaESalesOrderInput = {
        username: await getHanwhaUsername(),
        password: await getHanwhaPassword(),
        shipToName,
        shipToAddress,
        customerName: order.customer.companyName,
        orderDateYmd: dateToYmd(new Date()),
        poDateYmd: poDate ? dateToYmd(poDate) : null,
        deliveryDateYmd: dateToYmd(order.requestedDeliveryDate),
        driverCustomerNotice: order.driverCustomerNotice,
        orderExtraRequest: poDate ? withPurchaseCarryoverSalesPrefix(order.orderExtraRequest, poDate) : order.orderExtraRequest,
        approveAfterOrder: false,
        items: hanwhaItems.map((item) => {
            const hanwhaBagType = resolveHanwhaBagType(item.hanwhaBagType, item.product.productName);
            const materialName = resolveHanwhaMaterialName({
                productName: item.product.productName,
                productCode: item.product.productCode,
                explicitMaterialName: item.product.hanwhaMaterialName,
                bagType: hanwhaBagType,
            });
            const preferMappedItemCode = hanwhaBagType && hanwhaBagType !== 'FFS';
            const mappedItemCode = findHanwhaDbItemCode(materialName);
            const itemCode = preferMappedItemCode
                ? mappedItemCode || item.product.hanwhaItemCode?.trim()
                : item.product.hanwhaItemCode?.trim() || mappedItemCode;
            if (!itemCode) {
                throw new Error(`제품 DB에 한화 품목코드가 등록되지 않았습니다: ${item.product.productName} / ${materialName}`);
            }
            return {
                productName: item.product.productName,
                productCode: item.product.productCode,
                materialName,
                itemCode,
                quantity: quantityToMetricTon(item.requestedQuantity, item.unit),
            };
        }),
    };

    const result = await openHanwhaESalesOrder(hanwhaInput);

    if (!result.ok) {
        if (result.manualAction === 'PRODUCT_SELECTION') {
            job.resumeInput = hanwhaInput;
            job.resumeRowIndex = result.rowIndex ?? 0;
            job.manualAction = result.manualAction;
            job.manualTitle = result.manualTitle ?? '수동 조치가 필요합니다.';
            job.manualButtonLabel = result.manualButtonLabel ?? '완료 후 계속';
            job.message = result.error;
            throw new HanwhaManualProductSelectionError(result.error);
        }
        throw new Error(result.error);
    }

    job.message = approveAfterOrder
        ? `${result.message} 승인요청을 이어서 진행 중입니다.`
        : `${result.message} 주문 진행 조회와 체크를 이어서 진행 중입니다.`;

    const postOrderMessage = await runHanwhaPostOrderStep(approveAfterOrder, result.orderNo);

    const nextOrderStatus = order.status === OrderStatus.APPROVED ? OrderStatus.DISPATCHING : order.status;
    await prisma.order.update({
        where: { id: job.orderId },
        data: { hanwhaOrderedAt: new Date(), status: nextOrderStatus },
    });

    await prisma.orderStatusHistory.create({
        data: {
            orderId: job.orderId,
            previousStatus: order.status,
            newStatus: nextOrderStatus,
            changedByUserId: job.requestedByUserId,
            changeReason: approveAfterOrder
                ? `[한화 e-Sales] 대리점오더 자동 입력 후 조회/체크/승인요청 완료 (한화솔루션 품목 ${hanwhaItems.length}건 / 주문 ${order.orderNo})`
                : `[한화 e-Sales] 대리점오더 자동 입력 후 조회/체크 완료 (한화솔루션 품목 ${hanwhaItems.length}건 / 주문 ${order.orderNo})`,
        },
    });

    revalidatePath('/admin');
    revalidatePath('/admin/dispatch');
    revalidatePath(`/admin/orders/${job.orderId}`);
    job.message = `${result.message} ${postOrderMessage}`;
}

async function runHanwhaPostOrderStep(approveAfterOrder: boolean, hanwhaOrderNo?: string | null) {
    if (!hanwhaOrderNo?.trim()) {
        throw new Error('한화 e-Sales 주문번호를 읽지 못해 주문 목록에서 특정 주문만 선택할 수 없습니다. 전체 선택 방지를 위해 후속 처리를 중단했습니다.');
    }
    const input = {
        username: await getHanwhaUsername(),
        password: await getHanwhaPassword(),
        orderDateYmd: dateToYmd(new Date()),
        orderNo: hanwhaOrderNo,
    };
    const result = approveAfterOrder
        ? await requestHanwhaESalesApprovalForOrders(input)
        : await prepareHanwhaESalesApprovalForOrders(input);
    if (!result.ok) throw new Error(result.error);
    return result.message;
}

async function processHanwhaOrderQueue() {
    if (globalForHanwhaAction.__hanyangHanwhaOrderRunning) return;
    globalForHanwhaAction.__hanyangHanwhaOrderRunning = true;
    const { queue } = hanwhaQueue();

    try {
        let blockedForManualAction = false;
        do {
            while (queue.length > 0) {
                const job = queue.shift()!;
                job.status = 'RUNNING';
                job.startedAt = Date.now();
                try {
                    await runHanwhaAutomationQueued(
                        `한화오더 ${job.orderNo}`,
                        () => runHanwhaOrderJob(job, Boolean(job.approveAfterOrder)),
                    );
                    job.status = 'DONE';
                    job.finishedAt = Date.now();
                    job.message ??= '한화 e-Sales 대리점오더 입력이 완료되었습니다.';
                } catch (error) {
                    if (error instanceof HanwhaManualProductSelectionError) {
                        job.status = 'WAITING_MANUAL_ACTION';
                        job.message = error.message;
                        blockedForManualAction = true;
                        break;
                    }
                    job.status = 'FAILED';
                    job.finishedAt = Date.now();
                    job.error = error instanceof Error ? error.message : '한화 e-Sales 실행 중 오류가 발생했습니다.';
                }
            }
        } while (!blockedForManualAction && queue.length > 0);
    } finally {
        globalForHanwhaAction.__hanyangHanwhaOrderRunning = false;
    }
}

export async function getHanwhaNewOrderJobStatus(jobId: string) {
    const session = await auth();
    if (!session?.user || session.user.userKind !== 'staff') {
        return { ok: false as const, error: '沅뚰븳???놁뒿?덈떎.' };
    }
    const job = await prisma.backgroundJob.findUnique({ where: { id: jobId } });
    if (!job || job.type !== BACKGROUND_JOB_TYPES.HANWHA_NEW_ORDER) {
        return { ok: false as const, error: '?쒗솕 e-Sales ?닿린 ?묒뾽 ?뺣낫瑜?李얠쓣 ???놁뒿?덈떎.' };
    }
    const metadata = parseJobJsonAs<HanwhaNewOrderJobMetadata>(job.metadata);
    const position = job.status === 'QUEUED'
        ? await prisma.backgroundJob.count({
            where: {
                type: BACKGROUND_JOB_TYPES.HANWHA_NEW_ORDER,
                status: 'QUEUED',
                queuedAt: { lte: job.queuedAt },
            },
        })
        : 0;

    return {
        ok: true as const,
        jobId: job.id,
        orderId: metadata?.orderId ?? job.entityId ?? '',
        orderNo: job.title.replace(/^.*?\s/, ''),
        status: job.status as HanwhaOrderJobStatus,
        position,
        message: job.message,
        error: job.error,
        manualAction: metadata?.manualAction,
        manualTitle: metadata?.manualTitle,
        manualButtonLabel: metadata?.manualButtonLabel,
    };
}

async function enqueueHanwhaNewOrder(orderId: string, approveAfterOrder: boolean) {
    const session = await auth();
    if (!session?.user) return { ok: false as const, error: '濡쒓렇?몄씠 ?꾩슂?⑸땲??' };
    if (session.user.userKind !== 'staff') {
        return { ok: false as const, error: '吏곸썝留??쒗솕 e-Sales瑜??????덉뒿?덈떎.' };
    }

    const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
            id: true,
            orderNo: true,
            status: true,
            hanwhaOrderedAt: true,
            deletedAt: true,
            items: {
                select: {
                    hanwhaBagType: true,
                    purchaseSupplier: { select: { supplierName: true } },
                    product: {
                        select: {
                            productName: true,
                            hanwhaMaterialName: true,
                            hanwhaItemCode: true,
                        },
                    },
                },
            },
        },
    });

    if (!order || order.deletedAt) return { ok: false as const, error: '주문을 찾을 수 없습니다.' };
    const isReorder = Boolean(order.hanwhaOrderedAt);
    const canReorder = isReorder && isYangHeeCheol(session.user);
    if (isReorder && !canReorder) {
        return { ok: false as const, error: '이미 한화오더가 정상 완료된 주문입니다. 재오더는 양희철만 가능합니다.' };
    }
    if (order.status !== OrderStatus.APPROVED && !(canReorder && order.status === OrderStatus.DISPATCHING)) {
        return { ok: false as const, error: '승인 완료 또는 배차중 주문에서만 한화 e-Sales를 열 수 있습니다.' };
    }
    if (!order.items.some(isHanwhaOrderItem)) {
        return { ok: false as const, error: '한화 e-Sales에 입력할 한화 품목이 없습니다. 매입처가 한화솔루션이거나 제품 DB에 한화 품목코드가 등록된 품목만 처리합니다.' };
    }

    const queued = await enqueueBackgroundJob({
        type: BACKGROUND_JOB_TYPES.HANWHA_NEW_ORDER,
        queueKey: `hanwha-new-order:${orderId}`,
        entityType: 'ORDER',
        entityId: orderId,
        title: `한화오더 ${order.orderNo}`,
        message: approveAfterOrder
            ? '한화 e-Sales 입력 후 승인요청 대기열에 등록했습니다. 곧 진행을 시작합니다.'
            : '한화 e-Sales 입력 대기열에 등록했습니다. 곧 진행을 시작합니다.',
        requestedByUserId: session.user.id,
        metadata: {
            orderId,
            approveAfterOrder,
            forceReorder: canReorder,
        } satisfies HanwhaNewOrderJobMetadata,
    });
    const job = queued.job;
    const metadata = parseJobJsonAs<HanwhaNewOrderJobMetadata>(job.metadata);
    const position = job.status === 'QUEUED'
        ? await prisma.backgroundJob.count({
            where: {
                type: BACKGROUND_JOB_TYPES.HANWHA_NEW_ORDER,
                status: 'QUEUED',
                queuedAt: { lte: job.queuedAt },
            },
        })
        : 0;

    return {
        ok: true as const,
        jobId: job.id,
        status: job.status as HanwhaOrderJobStatus,
        position,
        message: job.message ?? (job.status === 'WAITING_MANUAL_ACTION'
            ? 'e-Sales에서 필요한 수동 조치를 완료한 뒤 계속 버튼을 눌러주세요.'
            : job.status === 'RUNNING'
                ? '한화오더가 현재 한화 e-Sales 입력 진행 중입니다.'
                : position > 1
                    ? `다른 한화 e-Sales 작업이 진행 중입니다. 대기열 ${position}번째입니다.`
                    : '한화 e-Sales 입력 대기열에 등록했습니다. 곧 진행을 시작합니다.'),
        manualAction: metadata?.manualAction,
        manualTitle: metadata?.manualTitle,
        manualButtonLabel: metadata?.manualButtonLabel,
    };
}

export async function startHanwhaNewOrder(orderId: string) {
    return enqueueHanwhaNewOrder(orderId, false);
}

export async function startHanwhaNewOrderWithApproval(orderId: string) {
    return enqueueHanwhaNewOrder(orderId, true);
}

export type HanwhaOrderStatusCheckStartResult =
    | { ok: true; cached: true; message: string; status: string; rowText: string }
    | { ok: true; queued: true; job: BackgroundJobView; message: string }
    | { ok: false; error: string };

export type HanwhaOrderStatusCheckJobResult =
    | { ok: true; job: BackgroundJobView; status?: string; rowText?: string; message?: string }
    | { ok: false; error: string };

export async function startHanwhaOrderStatusCheck(orderId: string): Promise<HanwhaOrderStatusCheckStartResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff') {
        return { ok: false, error: '직원만 한화 주문상태확인을 실행할 수 있습니다.' };
    }

    const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
            id: true,
            orderNo: true,
            hanwhaStatusText: true,
            hanwhaStatusRowText: true,
            deletedAt: true,
        },
    });
    if (!order || order.deletedAt) return { ok: false, error: '주문을 찾을 수 없습니다.' };

    if (isApprovedHanwhaStatus(order.hanwhaStatusText)) {
        return {
            ok: true,
            cached: true,
            message: '한화 e-Sales 주문상태를 확인했습니다. 현재 상태: 승인',
            status: '승인',
            rowText: order.hanwhaStatusRowText ?? '',
        };
    }

    const { job, created } = await enqueueBackgroundJob({
        type: BACKGROUND_JOB_TYPES.HANWHA_ORDER_STATUS_CHECK,
        queueKey: `HANWHA_ORDER_STATUS:${order.id}`,
        entityType: 'ORDER',
        entityId: order.id,
        title: `주문상태확인 ${order.orderNo}`,
        message: '한화 e-Sales 주문상태확인을 백그라운드에서 진행합니다.',
        requestedByUserId: session.user.id,
        metadata: { orderId: order.id },
    });

    return {
        ok: true,
        queued: true,
        job: toBackgroundJobView(job),
        message: created
            ? '주문상태확인 작업을 등록했습니다. 완료되면 자동으로 반영됩니다.'
            : '이 주문의 상태확인 작업이 이미 진행 중입니다. 완료되면 자동으로 반영됩니다.',
    };
}

export async function getHanwhaOrderStatusCheckJobStatus(jobId: string): Promise<HanwhaOrderStatusCheckJobResult> {
    const session = await auth();
    if (!session?.user || session.user.userKind !== 'staff') return { ok: false, error: '권한이 없습니다.' };

    const job = await prisma.backgroundJob.findUnique({ where: { id: jobId } });
    if (!job) return { ok: false, error: '주문상태확인 작업을 찾을 수 없습니다.' };

    const result = parseJobJsonAs<{ message?: string; status?: string; rowText?: string }>(job.result);
    return {
        ok: true,
        job: toBackgroundJobView(job),
        message: result?.message,
        status: result?.status,
        rowText: result?.rowText,
    };
}

export async function checkHanwhaOrderStatus(orderId: string) {
    const session = await auth();
    if (!session?.user) return { ok: false as const, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff') {
        return { ok: false as const, error: '직원만 한화 주문상태확인을 실행할 수 있습니다.' };
    }

    const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
            id: true,
            orderNo: true,
            createdAt: true,
            requestedDeliveryDate: true,
            hanwhaOrderedAt: true,
            hanwhaStatusText: true,
            hanwhaStatusRowText: true,
            hanwhaStatusSource: true,
            hanwhaStatusCheckedAt: true,
            hanwhaStatusManualApprovedAt: true,
            deletedAt: true,
            customer: { select: { companyName: true } },
            deliveryAddress: {
                select: {
                    label: true,
                    addressLine1: true,
                },
            },
            items: {
                select: {
                    requestedQuantity: true,
                    approvedQuantity: true,
                    unit: true,
                    hanwhaBagType: true,
                    purchaseLedgerDate: true,
                    purchaseSupplier: { select: { supplierName: true } },
                    product: {
                        select: {
                            productName: true,
                            productCode: true,
                            hanwhaMaterialName: true,
                            hanwhaItemCode: true,
                        },
                    },
                },
            },
        },
    });

    if (!order || order.deletedAt) return { ok: false as const, error: '주문을 찾을 수 없습니다.' };
    if (!order.requestedDeliveryDate) return { ok: false as const, error: '도착일자가 없어 한화 주문상태를 확인할 수 없습니다.' };

    if (isApprovedHanwhaStatus(order.hanwhaStatusText)) {
        return {
            ok: true as const,
            message: '한화 e-Sales 주문상태를 확인했습니다. 현재 상태: 승인',
            status: '승인',
            rowText: order.hanwhaStatusRowText ?? '',
        };
    }

    const hanwhaItems = order.items.filter(isHanwhaOrderItem);
    if (hanwhaItems.length === 0) {
        return { ok: false as const, error: '한화 주문상태를 확인할 한화 품목이 없습니다. 매입처가 한화솔루션이거나 제품 DB에 한화 품목코드가 등록된 품목만 처리합니다.' };
    }

    const purchaseDateCandidates = hanwhaItems
        .map((item) => item.purchaseLedgerDate ?? purchaseRequestDateFromOrderNo(order.orderNo) ?? order.createdAt)
        .filter((date): date is Date => !!date);
    const startDateCandidates = [
        order.createdAt,
        ...purchaseDateCandidates,
    ];
    const orderDateFrom = startDateCandidates
        .reduce((earliest, candidate) => candidate.getTime() < earliest.getTime() ? candidate : earliest, startDateCandidates[0]);
    const orderDateTo = order.requestedDeliveryDate;
    const shipToName = order.deliveryAddress.label || order.customer.companyName;
    const result = await runHanwhaAutomationQueued(
        `주문상태조회 ${order.orderNo}`,
        async () => checkHanwhaESalesOrderStatus({
            username: await getHanwhaUsername(),
            password: await getHanwhaPassword(),
            orderDateFromYmd: dateToYmd(orderDateFrom),
            orderDateToYmd: dateToYmd(orderDateTo),
            shipToName,
            deliveryDateYmd: dateToYmd(order.requestedDeliveryDate),
            items: hanwhaItems.map((item) => ({
                materialName: resolveHanwhaMaterialName({
                    productName: item.product.productName,
                    productCode: item.product.productCode,
                    explicitMaterialName: item.product.hanwhaMaterialName,
                    bagType: resolveHanwhaBagType(item.hanwhaBagType, item.product.productName),
                }),
                itemCode: item.product.hanwhaItemCode,
                quantity: quantityToMetricTon(item.approvedQuantity ?? item.requestedQuantity, item.unit),
            })),
        }),
    );

    if (!result.ok) return { ok: false as const, error: result.error };
    await prisma.order.update({
        where: { id: order.id },
        data: {
            hanwhaStatusText: result.status,
            hanwhaStatusRowText: result.rowText,
            hanwhaStatusCheckedAt: new Date(),
            hanwhaStatusSource: 'ORDER_DETAIL_CHECK',
        },
    });
    revalidatePath('/admin/today-shipping');
    revalidatePath(`/admin/orders/${order.id}`);
    return {
        ok: true as const,
        message: result.message,
        status: result.status,
        rowText: result.rowText,
    };
}

export async function requestHanwhaESalesApprovalForTodayOrders() {
    const session = await auth();
    if (!session?.user) return { ok: false as const, error: '濡쒓렇?몄씠 ?꾩슂?⑸땲??' };
    if (session.user.userKind !== 'staff') {
        return { ok: false as const, error: '吏곸썝留??쒗솕 e-Sales ?뱀씤?붿껌???ㅽ뻾?????덉뒿?덈떎.' };
    }

    const result = await runHanwhaAutomationQueued(
        '?뱀씪 誘몄듅???ㅻ뜑 ?뱀씤?붿껌',
        async () => requestHanwhaESalesApprovalForOrders({
            username: await getHanwhaUsername(),
            password: await getHanwhaPassword(),
            orderDateYmd: dateToYmd(new Date()),
        }),
    );

    if (!result.ok) return { ok: false as const, error: result.error };
    return { ok: true as const, message: result.message };
}

export async function completeHanwhaManualAction(jobId: string) {
    const session = await auth();
    if (!session?.user || session.user.userKind !== 'staff') {
        return { ok: false as const, error: '沅뚰븳???놁뒿?덈떎.' };
    }

    const job = await prisma.backgroundJob.findUnique({ where: { id: jobId } });
    if (!job || job.type !== BACKGROUND_JOB_TYPES.HANWHA_NEW_ORDER) {
        return { ok: false as const, error: '?쒗솕 e-Sales ?묒뾽 ?뺣낫瑜?李얠쓣 ???놁뒿?덈떎.' };
    }
    if (job.status !== 'WAITING_MANUAL_ACTION') {
        return { ok: false as const, error: '?섎룞 議곗튂 ?湲?以묒씤 ?묒뾽???꾨떃?덈떎.' };
    }
    const metadata = parseJobJsonAs<HanwhaNewOrderJobMetadata>(job.metadata);
    if (metadata?.manualAction !== 'PRODUCT_SELECTION') {
        return { ok: false as const, error: '???섎룞 議곗튂???꾩쭅 ?먮룞 ?댁뼱媛湲곕? 吏?먰븯吏 ?딆뒿?덈떎.' };
    }
    if (!metadata.resumeInput || metadata.resumeRowIndex == null) {
        return { ok: false as const, error: '?댁뼱媛湲??뺣낫媛 ?놁뼱 ?먮룞 ?낅젰???ш컻?????놁뒿?덈떎.' };
    }

    await prisma.backgroundJob.update({
        where: { id: job.id },
        data: {
            status: 'RUNNING',
            error: null,
            message: '?섎룞 ?좏깮???덈ぉ ?댄썑 ?낅젰???댁뼱??吏꾪뻾 以묒엯?덈떎.',
            heartbeatAt: new Date(),
        },
    });

    try {
        const result = await runHanwhaAutomationQueued(
            `?쒗솕?ㅻ뜑 ?댁뼱媛湲?${job.title}`,
            () => resumeHanwhaNewOrderAfterProductSelection({ ...metadata, requestedByUserId: session.user.id }),
        );
        await updateBackgroundJobResult(job.id, 'DONE', {
            message: result.message,
            result: { orderId: metadata.orderId },
        });
        revalidatePath('/admin');
        revalidatePath('/admin/dispatch');
        revalidatePath(`/admin/orders/${metadata.orderId}`);
        return { ok: true as const, jobId: job.id, status: 'DONE' as const, message: result.message };
    } catch (error) {
        if (error instanceof HanwhaProductSelectionRequiredError) {
            const waitingMetadata: HanwhaNewOrderJobMetadata = {
                ...metadata,
                resumeInput: error.resumeInput,
                resumeRowIndex: error.resumeRowIndex,
                manualAction: 'PRODUCT_SELECTION',
                manualTitle: error.manualTitle,
                manualButtonLabel: error.manualButtonLabel,
            };
            await prisma.backgroundJob.update({
                where: { id: job.id },
                data: {
                    status: 'WAITING_MANUAL_ACTION',
                    message: error.message,
                    error: null,
                    metadata: JSON.stringify(waitingMetadata),
                    heartbeatAt: new Date(),
                },
            });
            return {
                ok: true as const,
                jobId: job.id,
                status: 'WAITING_MANUAL_ACTION' as const,
                message: error.message,
                manualAction: waitingMetadata.manualAction,
                manualTitle: waitingMetadata.manualTitle,
                manualButtonLabel: waitingMetadata.manualButtonLabel,
            };
        }
        const message = error instanceof Error ? error.message : '한화 e-Sales 후속 처리 중 오류가 발생했습니다.';
        await updateBackgroundJobResult(job.id, 'FAILED', { error: message });
        return { ok: false as const, error: message };
    }
}

export async function completeHanwhaProductSelection(jobId: string) {
    return completeHanwhaManualAction(jobId);
}
