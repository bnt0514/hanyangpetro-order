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
import { canonicalProductCode, productIdentityKey } from '@/lib/product-identity';

function normalizeCompanyName(value: string | null | undefined) {
    return (value ?? '')
        .replace(/주식\s*회사/g, '')
        .replace(/\(주\)|㈜|\s|[()]/g, '')
        .trim();
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

    // 고객 모드: 거래처원장에 매출 내역 있는 productId 미리 수집
    const ledgerProductIds: string[] = [];
    if (!isStaff) {
        const ledgerEntries = await prisma.ledgerEntry.findMany({
            where: { customerId, ledgerType: 'SALES', productId: { not: null } },
            select: { productId: true },
            distinct: ['productId'],
        });
        for (const e of ledgerEntries) {
            if (e.productId) ledgerProductIds.push(e.productId);
        }
    }

    const [customer, addresses, whitelist, allProducts, ledgerProducts, companyEntities, suppliers] = await Promise.all([
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
                        hanwhaMaterialName: true,
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
                    hanwhaMaterialName: true,
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
                hanwhaMaterialName: string | null;
                defaultSalesEntity: { displayName: string } | null;
                defaultPurchaseEntity: { displayName: string } | null;
                defaultSupplier: { supplierName: string } | null;
            }[]),
        // 고객 전용: 거래처원장 매출 내역 있는 제품 상세
        !isStaff && ledgerProductIds.length > 0
            ? prisma.product.findMany({
                where: { id: { in: ledgerProductIds }, isActive: true },
                select: {
                    id: true,
                    productCode: true,
                    productName: true,
                    defaultSalesEntityId: true,
                    defaultPurchaseEntityId: true,
                    defaultSupplierId: true,
                    hanwhaMaterialName: true,
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
                hanwhaMaterialName: string | null;
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

    const selectedProductKeys = new Set<string>();
    const productKeyById = new Map<string, string>();
    const productDefaultsByKey = new Map<string, {
        defaultSalesEntityId: string | null;
        defaultSalesEntityName: string | null;
        defaultPurchaseEntityId: string | null;
        defaultPurchaseEntityName: string | null;
        defaultSupplierId: string | null;
        defaultSupplierName: string | null;
        hanwhaMaterialName: string | null;
    }>();
    const visibleProducts = [
        ...whitelist.filter((w) => w.product).map((w) => ({ id: w.productId, product: w.product! })),
        ...allProducts.map((p) => ({ id: p.id, product: p })),
        ...ledgerProducts.map((p) => ({ id: p.id, product: p })),
    ];
    for (const { id, product } of visibleProducts) {
        const key = productIdentityKey(product.productName, product.productCode);
        productKeyById.set(id, key);
        selectedProductKeys.add(key);
        if (!productDefaultsByKey.has(key)) {
            productDefaultsByKey.set(key, {
                defaultSalesEntityId: product.defaultSalesEntityId,
                defaultSalesEntityName: product.defaultSalesEntity?.displayName ?? null,
                defaultPurchaseEntityId: product.defaultPurchaseEntityId,
                defaultPurchaseEntityName: product.defaultPurchaseEntity?.displayName ?? null,
                defaultSupplierId: product.defaultSupplierId,
                defaultSupplierName: product.defaultSupplier?.supplierName ?? null,
                hanwhaMaterialName: product.hanwhaMaterialName,
            });
        }
    }

    const aliasProducts = selectedProductKeys.size > 0
        ? await prisma.product.findMany({
            where: { isActive: true },
            select: { id: true, productName: true, productCode: true },
        })
        : [];
    for (const product of aliasProducts) {
        const key = productIdentityKey(product.productName, product.productCode);
        if (selectedProductKeys.has(key)) productKeyById.set(product.id, key);
    }
    const relatedProductIds = Array.from(productKeyById.keys());

    const [savedPrices, recentPricedItems, recentSalesLedgerEntries, recentPurchaseLedgerEntries] = relatedProductIds.length > 0
        ? await Promise.all([
            prisma.customerProductPrice.findMany({
                where: { customerId, productId: { in: relatedProductIds } },
                orderBy: { lastUsedAt: 'desc' },
            }),
            prisma.orderItem.findMany({
                where: {
                    productId: { in: relatedProductIds },
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
                    unitPrice: { not: null },
                    OR: [
                        { productId: { in: relatedProductIds } },
                        { productId: null },
                    ],
                },
                select: {
                    productId: true,
                    productName: true,
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
                    unitPrice: { not: null },
                    OR: [
                        { productId: { in: relatedProductIds } },
                        { productId: null },
                    ],
                },
                select: {
                    productId: true,
                    productName: true,
                    supplierId: true,
                    supplier: { select: { supplierName: true } },
                    unitPrice: true,
                    transactionDate: true,
                    createdAt: true,
                },
                orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
                take: 2000,
            }),
        ])
        : [[], [], [], []];

    const lastSalesPriceByProductKey = new Map<string, number>();
    const lastPurchasePriceByProductKey = new Map<string, number>();
    const lastPurchaseSupplierByProductKey = new Map<string, { id: string; name: string }>();
    for (const price of savedPrices) {
        const key = productKeyById.get(price.productId);
        if (!key) continue;
        if (price.priceType === 'SALES' && !lastSalesPriceByProductKey.has(key)) {
            lastSalesPriceByProductKey.set(key, price.unitPrice);
        }
        if (price.priceType === 'PURCHASE' && !lastPurchasePriceByProductKey.has(key)) {
            lastPurchasePriceByProductKey.set(key, price.unitPrice);
        }
    }
    const sortedRecentItems = [...recentPricedItems].sort((a, b) => {
        const aTime = a.order.requestedDeliveryDate?.getTime() ?? a.createdAt.getTime();
        const bTime = b.order.requestedDeliveryDate?.getTime() ?? b.createdAt.getTime();
        return bTime - aTime;
    });
    for (const item of sortedRecentItems) {
        const key = productKeyById.get(item.productId);
        if (!key) continue;
        if (item.salesUnitPrice != null && !lastSalesPriceByProductKey.has(key)) {
            lastSalesPriceByProductKey.set(key, item.salesUnitPrice);
        }
        if (item.purchaseUnitPrice != null && !lastPurchasePriceByProductKey.has(key)) {
            lastPurchasePriceByProductKey.set(key, item.purchaseUnitPrice);
        }
        if (item.purchaseSupplierId && item.purchaseSupplier && !lastPurchaseSupplierByProductKey.has(key)) {
            lastPurchaseSupplierByProductKey.set(key, { id: item.purchaseSupplierId, name: item.purchaseSupplier.supplierName });
        }
    }
    for (const entry of recentSalesLedgerEntries) {
        const key = entry.productId ? productKeyById.get(entry.productId) : productIdentityKey(entry.productName);
        if (entry.unitPrice != null && key && selectedProductKeys.has(key) && !lastSalesPriceByProductKey.has(key)) {
            lastSalesPriceByProductKey.set(key, entry.unitPrice);
        }
    }
    for (const entry of recentPurchaseLedgerEntries) {
        const key = entry.productId ? productKeyById.get(entry.productId) : productIdentityKey(entry.productName);
        if (!key || !selectedProductKeys.has(key)) continue;
        if (entry.unitPrice != null && !lastPurchasePriceByProductKey.has(key)) {
            lastPurchasePriceByProductKey.set(key, entry.unitPrice);
        }
        if (entry.supplierId && entry.supplier && !lastPurchaseSupplierByProductKey.has(key)) {
            lastPurchaseSupplierByProductKey.set(key, { id: entry.supplierId, name: entry.supplier.supplierName });
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
        hanwhaMaterialName?: string | null;
        lastPurchaseSupplierId?: string | null;
        lastPurchaseSupplierName?: string | null;
        lastSalesUnitPrice?: number | null;
        lastPurchaseUnitPrice?: number | null;
    }[];

    function sharedProductData(product: {
        productName: string;
        productCode: string;
        defaultSalesEntityId: string | null;
        defaultSalesEntity?: { displayName: string } | null;
        defaultPurchaseEntityId: string | null;
        defaultPurchaseEntity?: { displayName: string } | null;
        defaultSupplierId: string | null;
        defaultSupplier?: { supplierName: string } | null;
        hanwhaMaterialName: string | null;
    }) {
        const key = productIdentityKey(product.productName, product.productCode);
        const sharedDefaults = productDefaultsByKey.get(key);
        return {
            sublabel: canonicalProductCode(product.productName, product.productCode),
            defaultSalesEntityId: product.defaultSalesEntityId ?? sharedDefaults?.defaultSalesEntityId ?? null,
            defaultSalesEntityName: product.defaultSalesEntity?.displayName ?? sharedDefaults?.defaultSalesEntityName ?? null,
            defaultPurchaseEntityId: product.defaultPurchaseEntityId ?? sharedDefaults?.defaultPurchaseEntityId ?? null,
            defaultPurchaseEntityName: product.defaultPurchaseEntity?.displayName ?? sharedDefaults?.defaultPurchaseEntityName ?? null,
            defaultSupplierId: product.defaultSupplierId ?? sharedDefaults?.defaultSupplierId ?? null,
            defaultSupplierName: product.defaultSupplier?.supplierName ?? sharedDefaults?.defaultSupplierName ?? null,
            hanwhaMaterialName: product.hanwhaMaterialName ?? sharedDefaults?.hanwhaMaterialName ?? null,
            lastPurchaseSupplierId: lastPurchaseSupplierByProductKey.get(key)?.id ?? null,
            lastPurchaseSupplierName: lastPurchaseSupplierByProductKey.get(key)?.name ?? null,
            lastSalesUnitPrice: isInternalPurchaseOnlyCustomer ? null : lastSalesPriceByProductKey.get(key) ?? null,
            lastPurchaseUnitPrice: lastPurchasePriceByProductKey.get(key) ?? null,
        };
    }

    const whitelistOpts = whitelist
        .filter((w) => w.product && w.product.isActive)
        .map((w) => ({
            value: w.productId,
            label: w.product!.productName,
            ...sharedProductData(w.product!),
        }));

    if (isStaff) {
        const seen = new Set(whitelistOpts.map((p) => productIdentityKey(p.label, p.sublabel)));
        const otherOpts = allProducts
            .filter((p) => !seen.has(productIdentityKey(p.productName, p.productCode)))
            .map((p) => ({
                value: p.id,
                label: p.productName,
                ...sharedProductData(p),
            }));
        productOpts = [...whitelistOpts, ...otherOpts];
    } else {
        // 거래처 모드: 화이트리스트 + 거래처원장에 매출내역 있는 제품
        const seen = new Set(whitelistOpts.map((p) => productIdentityKey(p.label, p.sublabel)));
        const ledgerOpts = ledgerProducts
            .filter((p) => !seen.has(productIdentityKey(p.productName, p.productCode)))
            .map((p) => ({
                value: p.id,
                label: p.productName,
                ...sharedProductData(p),
            }));
        productOpts = [...whitelistOpts, ...ledgerOpts];
    }

    const uniqueProductOpts = Array.from(
        productOpts.reduce((map, option) => {
            const key = productIdentityKey(option.label, option.sublabel);
            if (!map.has(key)) map.set(key, option);
            return map;
        }, new Map<string, typeof productOpts[number]>()).values(),
    );

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
            isDefault: a.isDefault,
            addressLine1: a.addressLine1,
            addressLine2: a.addressLine2,
            contactPhone: a.contactPhone,
        })),
        products: uniqueProductOpts,
        companyEntities,
        suppliers: suppliers.map((supplier) => ({
            id: supplier.id,
            supplierName: supplier.supplierName,
            contactPerson: supplier.contactPerson,
            phone: supplier.phone,
        })),
    });
}
