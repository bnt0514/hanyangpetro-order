/**
 * GET /api/customers/[id]/data
 *  - 거래처에 종속된 도착지 + 노출 가능 제품 목록
 *  - 권한:
 *      - staff: 모든 거래처 조회 가능
 *      - customer: 자기 customerId만 조회 가능
 *  - 응답: { addresses: ComboboxOption[], products: ComboboxOption[], companyEntities: CompanyEntityOption[] }
 */
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

function normalizeCompanyName(value: string | null | undefined) {
    return (value ?? '')
        .replace(/주식\s*회사/g, '')
        .replace(/\(주\)|㈜|\s|[()]/g, '')
        .trim();
}

function canonicalProductCode(productName: string, productCode: string | null | undefined) {
    if (productCode && !/^ITEM-|^IMP-/i.test(productCode)) return productCode;
    return productName
        .replace(/P\.P/gi, 'PP')
        .replace(/[<>]/g, '_')
        .replace(/[^a-zA-Z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toUpperCase();
}

export async function GET(
    _req: Request,
    ctx: { params: Promise<{ id: string }> },
) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { id: customerId } = await ctx.params;

    if (session.user.userKind === 'customer' && session.user.customerId !== customerId) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const isStaff = session.user.userKind === 'staff';

    const [customer, addresses, whitelist, allProducts, companyEntities, suppliers] = await Promise.all([
        prisma.customer.findUnique({
            where: { id: customerId },
            select: { id: true, companyName: true, customerCode: true },
        }),
        prisma.deliveryAddress.findMany({
            where: { customerId, isActive: true },
            select: {
                id: true,
                label: true,
                addressLine1: true,
                addressLine2: true,
                contactPhone: true,
                isDefault: true,
            },
            orderBy: [{ isDefault: 'desc' }, { label: 'asc' }],
        }),
        prisma.customerProductWhitelist.findMany({
            where: { customerId, isVisibleInPortal: true },
            select: {
                productId: true,
                product: {
                    select: {
                        productCode: true,
                        productName: true,
                        isActive: true,
                        defaultSalesEntityId: true,
                        defaultPurchaseEntityId: true,
                        defaultSupplierId: true,
                        defaultSalesEntity: { select: { displayName: true } },
                        defaultPurchaseEntity: { select: { displayName: true } },
                        defaultSupplier: { select: { supplierName: true } },
                    },
                },
            },
        }),
        // 직원 전용: 모든 활성 제품. 거래처는 fallback 안 함.
        isStaff
            ? prisma.product.findMany({
                where: { isActive: true },
                select: {
                    id: true,
                    productCode: true,
                    productName: true,
                    defaultSalesEntityId: true,
                    defaultPurchaseEntityId: true,
                    defaultSupplierId: true,
                    defaultSalesEntity: { select: { displayName: true } },
                    defaultPurchaseEntity: { select: { displayName: true } },
                    defaultSupplier: { select: { supplierName: true } },
                },
                orderBy: { productName: 'asc' },
            })
            : Promise.resolve([] as {
                id: string;
                productCode: string;
                productName: string;
                defaultSalesEntityId: string | null;
                defaultPurchaseEntityId: string | null;
                defaultSupplierId: string | null;
                defaultSalesEntity: { displayName: string } | null;
                defaultPurchaseEntity: { displayName: string } | null;
                defaultSupplier: { supplierName: string } | null;
            }[]),
        prisma.companyEntity.findMany({
            where: { isActive: true },
            select: { id: true, code: true, displayName: true },
            orderBy: { displayName: 'asc' },
        }),
        isStaff
            ? prisma.supplier.findMany({
                where: { isActive: true },
                select: { id: true, supplierName: true, contactPerson: true, phone: true },
                orderBy: { supplierName: 'asc' },
            })
            : Promise.resolve([]),
    ]);

    if (!customer) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    const isInternalPurchaseOnlyCustomer = normalizeCompanyName(customer.companyName) === '한양유화';

    const allProductIds = Array.from(new Set([
        ...whitelist.map((w) => w.productId),
        ...allProducts.map((p) => p.id),
    ]));
    const [savedPrices, recentPricedItems, recentSalesLedgerEntries, recentPurchaseLedgerEntries] = allProductIds.length > 0
        ? await Promise.all([
            prisma.customerProductPrice.findMany({
                where: { customerId, productId: { in: allProductIds } },
                orderBy: { lastUsedAt: 'desc' },
            }),
            prisma.orderItem.findMany({
                where: {
                    productId: { in: allProductIds },
                    order: { customerId, deletedAt: null },
                    OR: [{ salesUnitPrice: { not: null } }, { purchaseUnitPrice: { not: null } }],
                },
                select: {
                    productId: true,
                    purchaseSupplierId: true,
                    purchaseSupplier: { select: { supplierName: true } },
                    salesUnitPrice: true,
                    purchaseUnitPrice: true,
                    createdAt: true,
                    order: { select: { requestedDeliveryDate: true } },
                },
                orderBy: { createdAt: 'desc' },
                take: 500,
            }),
            prisma.ledgerEntry.findMany({
                where: {
                    ledgerType: 'SALES',
                    customerId,
                    productId: { in: allProductIds },
                    unitPrice: { not: null },
                },
                select: {
                    productId: true,
                    unitPrice: true,
                    transactionDate: true,
                    createdAt: true,
                },
                orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
                take: 1000,
            }),
            prisma.ledgerEntry.findMany({
                where: {
                    ledgerType: 'PURCHASE',
                    productId: { in: allProductIds },
                    unitPrice: { not: null },
                },
                select: {
                    productId: true,
                    supplierId: true,
                    supplier: { select: { supplierName: true } },
                    unitPrice: true,
                    transactionDate: true,
                    createdAt: true,
                },
                orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
                take: 1000,
            }),
        ])
        : [[], [], [], []];

    const lastSalesPriceByProduct = new Map<string, number>();
    const lastPurchasePriceByProduct = new Map<string, number>();
    const lastPurchaseSupplierByProduct = new Map<string, { id: string; name: string }>();
    for (const price of savedPrices) {
        if (price.priceType === 'SALES' && !lastSalesPriceByProduct.has(price.productId)) {
            lastSalesPriceByProduct.set(price.productId, price.unitPrice);
        }
        if (price.priceType === 'PURCHASE' && !lastPurchasePriceByProduct.has(price.productId)) {
            lastPurchasePriceByProduct.set(price.productId, price.unitPrice);
        }
    }
    const sortedRecentItems = [...recentPricedItems].sort((a, b) => {
        const aTime = a.order.requestedDeliveryDate?.getTime() ?? a.createdAt.getTime();
        const bTime = b.order.requestedDeliveryDate?.getTime() ?? b.createdAt.getTime();
        return bTime - aTime;
    });
    for (const item of sortedRecentItems) {
        if (item.salesUnitPrice != null && !lastSalesPriceByProduct.has(item.productId)) {
            lastSalesPriceByProduct.set(item.productId, item.salesUnitPrice);
        }
        if (item.purchaseUnitPrice != null && !lastPurchasePriceByProduct.has(item.productId)) {
            lastPurchasePriceByProduct.set(item.productId, item.purchaseUnitPrice);
        }
        if (item.purchaseSupplierId && item.purchaseSupplier && !lastPurchaseSupplierByProduct.has(item.productId)) {
            lastPurchaseSupplierByProduct.set(item.productId, { id: item.purchaseSupplierId, name: item.purchaseSupplier.supplierName });
        }
    }
    for (const entry of recentSalesLedgerEntries) {
        if (entry.unitPrice != null && !lastSalesPriceByProduct.has(entry.productId!)) {
            lastSalesPriceByProduct.set(entry.productId!, entry.unitPrice);
        }
    }
    for (const entry of recentPurchaseLedgerEntries) {
        if (entry.unitPrice != null && !lastPurchasePriceByProduct.has(entry.productId!)) {
            lastPurchasePriceByProduct.set(entry.productId!, entry.unitPrice);
        }
        if (entry.supplierId && entry.supplier && !lastPurchaseSupplierByProduct.has(entry.productId!)) {
            lastPurchaseSupplierByProduct.set(entry.productId!, { id: entry.supplierId, name: entry.supplier.supplierName });
        }
    }

    // 거래처(customer): 화이트리스트(주문 이력) 있는 것만 노출.
    //                    이력 없으면 빈 배열 → "담당자에게 문의" 안내.
    // 직원(staff):       화이트리스트 + 그 외 모든 제품 (중복 제거, 화이트리스트 우선)
    let productOpts: {
        value: string;
        label: string;
        sublabel?: string;
        defaultSalesEntityId?: string | null;
        defaultSalesEntityName?: string | null;
        defaultPurchaseEntityId?: string | null;
        defaultPurchaseEntityName?: string | null;
        defaultSupplierId?: string | null;
        defaultSupplierName?: string | null;
        lastPurchaseSupplierId?: string | null;
        lastPurchaseSupplierName?: string | null;
        lastSalesUnitPrice?: number | null;
        lastPurchaseUnitPrice?: number | null;
    }[];

    const whitelistOpts = whitelist
        .filter((w) => w.product && w.product.isActive)
        .map((w) => ({
            value: w.productId,
            label: w.product!.productName,
            sublabel: canonicalProductCode(w.product!.productName, w.product!.productCode),
            defaultSalesEntityId: w.product!.defaultSalesEntityId,
            defaultSalesEntityName: w.product!.defaultSalesEntity?.displayName ?? null,
            defaultPurchaseEntityId: w.product!.defaultPurchaseEntityId,
            defaultPurchaseEntityName: w.product!.defaultPurchaseEntity?.displayName ?? null,
            defaultSupplierId: w.product!.defaultSupplierId,
            defaultSupplierName: w.product!.defaultSupplier?.supplierName ?? null,
            lastPurchaseSupplierId: lastPurchaseSupplierByProduct.get(w.productId)?.id ?? null,
            lastPurchaseSupplierName: lastPurchaseSupplierByProduct.get(w.productId)?.name ?? null,
            lastSalesUnitPrice: isInternalPurchaseOnlyCustomer ? null : lastSalesPriceByProduct.get(w.productId) ?? null,
            lastPurchaseUnitPrice: lastPurchasePriceByProduct.get(w.productId) ?? null,
        }));

    if (isStaff) {
        const seen = new Set(whitelistOpts.map((p) => p.value));
        const otherOpts = allProducts
            .filter((p) => !seen.has(p.id))
            .map((p) => ({
                value: p.id,
                label: p.productName,
                sublabel: canonicalProductCode(p.productName, p.productCode),
                defaultSalesEntityId: p.defaultSalesEntityId,
                defaultSalesEntityName: p.defaultSalesEntity?.displayName ?? null,
                defaultPurchaseEntityId: p.defaultPurchaseEntityId,
                defaultPurchaseEntityName: p.defaultPurchaseEntity?.displayName ?? null,
                defaultSupplierId: p.defaultSupplierId,
                defaultSupplierName: p.defaultSupplier?.supplierName ?? null,
                lastPurchaseSupplierId: lastPurchaseSupplierByProduct.get(p.id)?.id ?? null,
                lastPurchaseSupplierName: lastPurchaseSupplierByProduct.get(p.id)?.name ?? null,
                lastSalesUnitPrice: isInternalPurchaseOnlyCustomer ? null : lastSalesPriceByProduct.get(p.id) ?? null,
                lastPurchaseUnitPrice: lastPurchasePriceByProduct.get(p.id) ?? null,
            }));
        productOpts = [...whitelistOpts, ...otherOpts];
    } else {
        productOpts = whitelistOpts;
    }

    return NextResponse.json({
        customer: {
            id: customer.id,
            companyName: customer.companyName,
            customerCode: customer.customerCode,
            isInternalPurchaseOnly: isInternalPurchaseOnlyCustomer,
        },
        addresses: addresses.map(a => ({
            value: a.id,
            label: a.label,
            sublabel: [a.isDefault ? '기본' : '', a.addressLine1].filter(Boolean).join(' · ') || undefined,
            addressLine1: a.addressLine1,
            addressLine2: a.addressLine2,
            contactPhone: a.contactPhone,
        })),
        products: productOpts,
        companyEntities,
        suppliers: suppliers.map((supplier) => ({
            id: supplier.id,
            supplierName: supplier.supplierName,
            contactPerson: supplier.contactPerson,
            phone: supplier.phone,
        })),
    });
}
