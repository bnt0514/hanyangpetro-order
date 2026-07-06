'use server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';

export type LedgerMutationResult = { ok: true } | { ok: false; error: string };

type LedgerMode = 'SALES' | 'PURCHASE';

const LEDGER_EDITORS = new Set(['양희철']);
const QUANTITY_EPSILON = 0.000001;

function parseDateOnly(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    return new Date(`${value}T00:00:00`);
}

function dateToIso(value: Date | null | undefined) {
    if (!value) return '-';
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function calcAmounts(quantity: number, unitPrice: number | null) {
    if (unitPrice == null) return { supplyAmount: null, vatAmount: null, totalAmount: null };
    const supplyAmount = Math.round(quantity * unitPrice);
    const vatAmount = Math.round(supplyAmount * 0.1);
    return { supplyAmount, vatAmount, totalAmount: supplyAmount + vatAmount };
}

function appendAuditMemo(memo: string | null | undefined, line: string) {
    return [memo?.trim(), line].filter(Boolean).join('\n');
}

function isSameQuantity(a: number, b: number) {
    return Math.abs(a - b) <= QUANTITY_EPSILON;
}

async function requireLedgerEditor(): Promise<{ ok: true; userId: string; userName: string } | { ok: false; error: string }> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    const user = session.user.userKind === 'staff'
        ? await prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true, isActive: true } })
        : null;
    const userName = user?.name?.replace(/\s/g, '') ?? '';
    if (session.user.userKind !== 'staff' || !user?.isActive || !LEDGER_EDITORS.has(userName)) {
        return { ok: false, error: '원장 수정/추가는 양희철만 가능합니다.' };
    }
    return { ok: true, userId: session.user.id, userName: user.name };
}

async function getProduct(productId: string | null | undefined, productName: string) {
    if (!productId) return { id: null, productCode: null, productName };
    const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { id: true, productCode: true, productName: true },
    });
    if (!product) return null;
    return product;
}

export async function updateLedgerRow(input: {
    mode: LedgerMode;
    rowId: string;
    transactionDate: string;
    productId?: string | null;
    productName: string;
    quantity: number;
    unit: string;
    unitPrice: number | null;
    memo?: string | null;
    reason: string;
}): Promise<LedgerMutationResult> {
    const editor = await requireLedgerEditor();
    if (!editor.ok) return editor;

    const transactionDate = parseDateOnly(input.transactionDate);
    if (!transactionDate) return { ok: false, error: '일자를 확인해 주세요.' };
    if (!input.productName.trim() && !input.productId) return { ok: false, error: '품목을 입력하거나 선택해 주세요.' };
    if (!Number.isFinite(input.quantity) || input.quantity === 0) return { ok: false, error: '수량은 0이 아닌 숫자여야 합니다.' };
    if (input.unitPrice != null && (!Number.isFinite(input.unitPrice) || input.unitPrice < 0)) return { ok: false, error: '단가는 0 이상 숫자로 입력해 주세요.' };
    if (!input.reason.trim()) return { ok: false, error: '수정 사유를 입력해 주세요.' };

    const product = await getProduct(input.productId, input.productName.trim());
    if (!product) return { ok: false, error: '품목을 찾을 수 없습니다.' };
    const amounts = calcAmounts(input.quantity, input.unitPrice);

    if (input.rowId.startsWith('ledger:')) {
        const ledgerEntryId = input.rowId.slice('ledger:'.length);
        const entry = await prisma.ledgerEntry.findUnique({
            where: { id: ledgerEntryId },
            include: { order: { select: { id: true, orderNo: true, status: true } } },
        });
        if (!entry || entry.ledgerType !== input.mode) return { ok: false, error: '원장 항목을 찾을 수 없습니다.' };

        const audit = `[원장 수정] ${dateToIso(entry.transactionDate)} → ${input.transactionDate}, ${entry.productName} → ${product.productName}, 수량 ${entry.quantity}${entry.unit} → ${input.quantity}${input.unit}, 단가 ${entry.unitPrice?.toLocaleString('ko-KR') ?? '-'} → ${input.unitPrice?.toLocaleString('ko-KR') ?? '-'} / ${input.reason.trim()}`;

        await prisma.$transaction(async (tx) => {
            await tx.ledgerEntry.update({
                where: { id: ledgerEntryId },
                data: {
                    transactionDate,
                    productId: product.id,
                    productCode: product.productCode,
                    productName: product.productName,
                    quantity: input.quantity,
                    unit: input.unit,
                    unitPrice: input.unitPrice,
                    supplyAmount: amounts.supplyAmount,
                    vatAmount: amounts.vatAmount,
                    totalAmount: amounts.totalAmount,
                    memo: appendAuditMemo(input.memo ?? entry.memo, audit),
                },
            });
            if (entry.order) {
                await tx.orderStatusHistory.create({
                    data: {
                        orderId: entry.order.id,
                        previousStatus: entry.order.status,
                        newStatus: entry.order.status,
                        changedByUserId: editor.userId,
                        changeReason: `[연결 원장 수정] 오더 ${entry.order.orderNo} / ${audit}`,
                    },
                });
            }
        });

        revalidatePath('/admin');
        if (entry.customerId) revalidatePath(`/admin/customers/${entry.customerId}/ledger`);
        if (entry.supplierId) revalidatePath(`/admin/suppliers/${entry.supplierId}/ledger`);
        if (entry.orderId) revalidatePath(`/admin/orders/${entry.orderId}`);
        revalidatePath('/portal');
        revalidatePath('/portal/ledger');
        return { ok: true };
    }

    if (!product.id) return { ok: false, error: '오더 항목 수정은 등록된 품목 선택이 필요합니다.' };

    const item = await prisma.orderItem.findUnique({
        where: { id: input.rowId },
        include: {
            product: { select: { productName: true } },
            order: { select: { id: true, orderNo: true, customerId: true, status: true, requestedDeliveryDate: true, deletedAt: true } },
        },
    });
    if (!item || item.order.deletedAt) return { ok: false, error: '오더 항목을 찾을 수 없습니다.' };

    const previousDate = input.mode === 'SALES' ? item.salesLedgerDate ?? item.order.requestedDeliveryDate : item.purchaseLedgerDate;
    const previousPrice = input.mode === 'SALES' ? item.salesUnitPrice : item.purchaseUnitPrice;
    const approvedQuantity = item.approvedQuantity === item.requestedQuantity ? input.quantity : item.approvedQuantity;
    const changeReason = `[원장 수정] ${input.mode === 'SALES' ? '매출' : '매입'}일자 ${dateToIso(previousDate)} → ${input.transactionDate}, 품목 ${item.product.productName} → ${product.productName}, 수량 ${item.requestedQuantity}${item.unit} → ${input.quantity}${input.unit}, 단가 ${previousPrice?.toLocaleString('ko-KR') ?? '-'} → ${input.unitPrice?.toLocaleString('ko-KR') ?? '-'} / ${input.reason.trim()}`;

    await prisma.$transaction(async (tx) => {
        await tx.orderItem.update({
            where: { id: input.rowId },
            data: {
                productId: product.id!,
                requestedQuantity: input.quantity,
                approvedQuantity,
                unit: input.unit,
                memo: input.memo?.trim() || null,
                ...(input.mode === 'SALES'
                    ? { salesLedgerDate: transactionDate, salesUnitPrice: input.unitPrice }
                    : { purchaseLedgerDate: transactionDate, purchaseUnitPrice: input.unitPrice }),
            },
        });
        await tx.ledgerEntry.updateMany({
            where: { orderItemId: input.rowId, ledgerType: input.mode },
            data: {
                transactionDate,
                productId: product.id,
                productCode: product.productCode,
                productName: product.productName,
                quantity: input.quantity,
                unit: input.unit,
                unitPrice: input.unitPrice,
                supplyAmount: amounts.supplyAmount,
                vatAmount: amounts.vatAmount,
                totalAmount: amounts.totalAmount,
                memo: input.memo?.trim() || null,
            },
        });
        await tx.orderStatusHistory.create({
            data: {
                orderId: item.orderId,
                previousStatus: item.order.status,
                newStatus: item.order.status,
                changedByUserId: editor.userId,
                changeReason,
            },
        });
        if (input.mode === 'SALES' && input.unitPrice != null && item.salesEntityId) {
            await tx.customerProductPrice.upsert({
                where: {
                    customerId_productId_companyEntityId_priceType: {
                        customerId: item.order.customerId,
                        productId: product.id!,
                        companyEntityId: item.salesEntityId,
                        priceType: 'SALES',
                    },
                },
                update: { unitPrice: input.unitPrice, sourceOrderItemId: input.rowId, lastUsedAt: new Date(), createdById: editor.userId },
                create: { customerId: item.order.customerId, productId: product.id!, companyEntityId: item.salesEntityId, priceType: 'SALES', unitPrice: input.unitPrice, sourceOrderItemId: input.rowId, createdById: editor.userId },
            });
        }
    });

    revalidatePath('/admin');
    revalidatePath(`/admin/orders/${item.orderId}`);
    revalidatePath(`/admin/customers/${item.order.customerId}/ledger`);
    if (item.purchaseSupplierId) revalidatePath(`/admin/suppliers/${item.purchaseSupplierId}/ledger`);
    revalidatePath('/portal');
    revalidatePath('/portal/ledger');
    return { ok: true };
}

export async function createLedgerManualRow(input: {
    mode: LedgerMode;
    transactionDate: string;
    customerId?: string | null;
    supplierId?: string | null;
    companyEntityId?: string | null;
    productId?: string | null;
    productName: string;
    quantity: number;
    unit: string;
    unitPrice: number | null;
    memo?: string | null;
}): Promise<LedgerMutationResult> {
    const editor = await requireLedgerEditor();
    if (!editor.ok) return editor;
    const transactionDate = parseDateOnly(input.transactionDate);
    if (!transactionDate) return { ok: false, error: '일자를 확인해 주세요.' };
    if (!Number.isFinite(input.quantity) || input.quantity === 0) return { ok: false, error: '수량은 0이 아닌 숫자여야 합니다.' };
    if (input.unitPrice != null && (!Number.isFinite(input.unitPrice) || input.unitPrice < 0)) return { ok: false, error: '단가는 0 이상 숫자로 입력해 주세요.' };

    const product = await getProduct(input.productId, input.productName.trim());
    if (!product) return { ok: false, error: '품목을 찾을 수 없습니다.' };
    const amounts = calcAmounts(input.quantity, input.unitPrice);

    const [customer, supplier] = await Promise.all([
        input.customerId ? prisma.customer.findUnique({ where: { id: input.customerId }, select: { customerCode: true, companyName: true } }) : null,
        input.supplierId ? prisma.supplier.findUnique({ where: { id: input.supplierId }, select: { id: true, supplierName: true } }) : null,
    ]);
    if (input.mode === 'SALES' && !customer) return { ok: false, error: '거래처를 찾을 수 없습니다.' };
    if (input.mode === 'PURCHASE' && !supplier) return { ok: false, error: '매입처를 찾을 수 없습니다.' };

    const entry = await prisma.ledgerEntry.create({
        data: {
            ledgerType: input.mode,
            transactionDate,
            companyEntityId: input.companyEntityId || null,
            customerId: input.mode === 'SALES' ? input.customerId || null : null,
            supplierId: input.mode === 'PURCHASE' ? input.supplierId || null : null,
            counterpartyCode: input.mode === 'SALES' ? customer?.customerCode ?? null : null,
            counterpartyName: input.mode === 'SALES' ? customer!.companyName : supplier!.supplierName,
            productId: product.id,
            productCode: product.productCode,
            productName: product.productName,
            quantity: input.quantity,
            unit: input.unit,
            unitPrice: input.unitPrice,
            supplyAmount: amounts.supplyAmount,
            vatAmount: amounts.vatAmount,
            totalAmount: amounts.totalAmount,
            memo: appendAuditMemo(input.memo, `[원장 직접 추가] ${editor.userName}`),
            sourceType: 'MANUAL',
            sourceHash: `MANUAL:${input.mode}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        },
    });

    revalidatePath('/admin');
    if (entry.customerId) revalidatePath(`/admin/customers/${entry.customerId}/ledger`);
    if (entry.supplierId) revalidatePath(`/admin/suppliers/${entry.supplierId}/ledger`);
    revalidatePath('/portal');
    revalidatePath('/portal/ledger');
    return { ok: true };
}

export async function splitSalesLedgerRow(input: {
    rowId: string;
    targetCustomerId: string;
    quantity: number;
    reason?: string | null;
}): Promise<LedgerMutationResult> {
    const editor = await requireLedgerEditor();
    if (!editor.ok) return editor;

    const splitQuantity = Number(input.quantity);
    if (!input.targetCustomerId) return { ok: false, error: '이관할 거래처를 선택해 주세요.' };
    if (!Number.isFinite(splitQuantity) || splitQuantity <= 0) return { ok: false, error: '분리 수량은 0보다 커야 합니다.' };

    const targetCustomer = await prisma.customer.findUnique({
        where: { id: input.targetCustomerId },
        select: { id: true, customerCode: true, companyName: true, isActive: true },
    });
    if (!targetCustomer?.isActive) return { ok: false, error: '이관할 거래처를 찾을 수 없습니다.' };

    const reason = input.reason?.trim();
    const splitHash = () => `SALES_SPLIT:${Date.now()}:${Math.random().toString(36).slice(2)}`;

    if (input.rowId.startsWith('ledger:')) {
        const ledgerEntryId = input.rowId.slice('ledger:'.length);
        const entry = await prisma.ledgerEntry.findUnique({
            where: { id: ledgerEntryId },
            include: { customer: { select: { id: true, companyName: true } }, order: { select: { id: true, orderNo: true, status: true } } },
        });
        if (!entry || entry.ledgerType !== 'SALES' || !entry.customerId) return { ok: false, error: '매출 원장 행을 찾을 수 없습니다.' };
        if (entry.customerId === targetCustomer.id) return { ok: false, error: '같은 거래처로는 매출분리를 할 수 없습니다.' };
        if (splitQuantity > entry.quantity && !isSameQuantity(splitQuantity, entry.quantity)) return { ok: false, error: '분리/이관 수량은 현재 수량을 초과할 수 없습니다.' };

        const fullTransfer = isSameQuantity(splitQuantity, entry.quantity);
        const remainingQuantity = entry.quantity - splitQuantity;
        const remainingAmounts = calcAmounts(remainingQuantity, entry.unitPrice);
        const splitAmounts = calcAmounts(splitQuantity, entry.unitPrice);
        const audit = `[${fullTransfer ? '매출이관' : '매출분리'}] ${entry.customer?.companyName ?? entry.counterpartyName} ${entry.quantity}${entry.unit} 중 ${splitQuantity}${entry.unit} -> ${targetCustomer.companyName}${reason ? ` / ${reason}` : ''}`;

        await prisma.$transaction(async (tx) => {
            if (fullTransfer) {
                await tx.ledgerEntry.update({
                    where: { id: ledgerEntryId },
                    data: {
                        customerId: targetCustomer.id,
                        counterpartyCode: targetCustomer.customerCode,
                        counterpartyName: targetCustomer.companyName,
                        memo: appendAuditMemo(entry.memo, audit),
                    },
                });
                if (entry.order) {
                    await tx.order.update({
                        where: { id: entry.order.id },
                        data: { customerId: targetCustomer.id },
                    });
                    await tx.ledgerEntry.updateMany({
                        where: { orderId: entry.order.id, ledgerType: 'SALES' },
                        data: {
                            customerId: targetCustomer.id,
                            counterpartyCode: targetCustomer.customerCode,
                            counterpartyName: targetCustomer.companyName,
                        },
                    });
                    await tx.orderStatusHistory.create({
                        data: {
                            orderId: entry.order.id,
                            previousStatus: entry.order.status,
                            newStatus: entry.order.status,
                            changedByUserId: editor.userId,
                            changeReason: `[매출이관] ${entry.order.orderNo} / ${audit}`,
                        },
                    });
                }
                return;
            }
            await tx.ledgerEntry.update({
                where: { id: ledgerEntryId },
                data: {
                    quantity: remainingQuantity,
                    supplyAmount: remainingAmounts.supplyAmount,
                    vatAmount: remainingAmounts.vatAmount,
                    totalAmount: remainingAmounts.totalAmount,
                    memo: appendAuditMemo(entry.memo, audit),
                },
            });
            const created = await tx.ledgerEntry.create({
                data: {
                    ledgerType: 'SALES',
                    transactionDate: entry.transactionDate,
                    companyEntityId: entry.companyEntityId,
                    customerId: targetCustomer.id,
                    counterpartyCode: targetCustomer.customerCode,
                    counterpartyName: targetCustomer.companyName,
                    productId: entry.productId,
                    productCode: entry.productCode,
                    productName: entry.productName,
                    quantity: splitQuantity,
                    unit: entry.unit,
                    unitPrice: entry.unitPrice,
                    supplyAmount: splitAmounts.supplyAmount,
                    vatAmount: splitAmounts.vatAmount,
                    totalAmount: splitAmounts.totalAmount,
                    memo: `[매출분리] ${entry.customer?.companyName ?? entry.counterpartyName} 원장 ${dateToIso(entry.transactionDate)}에서 이관${reason ? ` / ${reason}` : ''}`,
                    sourceType: 'SALES_SPLIT',
                    sourceHash: splitHash(),
                },
            });
            if (entry.order) {
                await tx.orderStatusHistory.create({
                    data: {
                        orderId: entry.order.id,
                        previousStatus: entry.order.status,
                        newStatus: entry.order.status,
                        changedByUserId: editor.userId,
                        changeReason: `[매출분리] ${entry.order.orderNo} / ${audit} / 분리 원장 ${created.id}`,
                    },
                });
            }
        });

        revalidatePath('/admin');
        revalidatePath(`/admin/customers/${entry.customerId}/ledger`);
        revalidatePath(`/admin/customers/${targetCustomer.id}/ledger`);
        if (entry.orderId) revalidatePath(`/admin/orders/${entry.orderId}`);
        revalidatePath('/portal');
        revalidatePath('/portal/ledger');
        return { ok: true };
    }

    const item = await prisma.orderItem.findUnique({
        where: { id: input.rowId },
        include: {
            product: { select: { id: true, productCode: true, productName: true } },
            order: { select: { id: true, orderNo: true, customerId: true, status: true, requestedDeliveryDate: true, deletedAt: true, customer: { select: { companyName: true } } } },
        },
    });
    if (!item || item.order.deletedAt) return { ok: false, error: '오더 품목을 찾을 수 없습니다.' };
    if (item.order.customerId === targetCustomer.id) return { ok: false, error: '같은 거래처로는 매출분리를 할 수 없습니다.' };
    if (splitQuantity > item.requestedQuantity && !isSameQuantity(splitQuantity, item.requestedQuantity)) return { ok: false, error: '분리/이관 수량은 현재 수량을 초과할 수 없습니다.' };

    const fullTransfer = isSameQuantity(splitQuantity, item.requestedQuantity);
    const remainingQuantity = item.requestedQuantity - splitQuantity;
    const remainingAmounts = calcAmounts(remainingQuantity, item.salesUnitPrice);
    const splitAmounts = calcAmounts(splitQuantity, item.salesUnitPrice);
    const transactionDate = item.salesLedgerDate ?? item.order.requestedDeliveryDate;
    if (!transactionDate) return { ok: false, error: '원 매출일자를 찾을 수 없습니다.' };
    const audit = `[${fullTransfer ? '매출이관' : '매출분리'}] ${item.order.customer.companyName} 오더 ${item.order.orderNo} ${item.requestedQuantity}${item.unit} 중 ${splitQuantity}${item.unit} -> ${targetCustomer.companyName}${reason ? ` / ${reason}` : ''}`;

    await prisma.$transaction(async (tx) => {
        if (fullTransfer) {
            await tx.order.update({
                where: { id: item.orderId },
                data: { customerId: targetCustomer.id },
            });
            await tx.ledgerEntry.updateMany({
                where: { orderId: item.orderId, ledgerType: 'SALES' },
                data: {
                    customerId: targetCustomer.id,
                    counterpartyCode: targetCustomer.customerCode,
                    counterpartyName: targetCustomer.companyName,
                    memo: appendAuditMemo(item.memo, audit),
                },
            });
            await tx.orderStatusHistory.create({
                data: {
                    orderId: item.orderId,
                    previousStatus: item.order.status,
                    newStatus: item.order.status,
                    changedByUserId: editor.userId,
                    changeReason: audit,
                },
            });
            return;
        }
        await tx.orderItem.update({
            where: { id: item.id },
            data: {
                requestedQuantity: remainingQuantity,
                approvedQuantity: item.approvedQuantity == null ? null : Math.min(item.approvedQuantity, remainingQuantity),
                shippedQuantity: item.shippedQuantity == null ? null : Math.min(item.shippedQuantity, remainingQuantity),
                receivedQuantity: item.receivedQuantity == null ? null : Math.min(item.receivedQuantity, remainingQuantity),
                memo: appendAuditMemo(item.memo, audit),
            },
        });
        await tx.ledgerEntry.updateMany({
            where: { orderItemId: item.id, ledgerType: 'SALES' },
            data: {
                quantity: remainingQuantity,
                supplyAmount: remainingAmounts.supplyAmount,
                vatAmount: remainingAmounts.vatAmount,
                totalAmount: remainingAmounts.totalAmount,
                memo: appendAuditMemo(item.memo, audit),
            },
        });
        const created = await tx.ledgerEntry.create({
            data: {
                ledgerType: 'SALES',
                transactionDate,
                companyEntityId: item.salesEntityId,
                customerId: targetCustomer.id,
                counterpartyCode: targetCustomer.customerCode,
                counterpartyName: targetCustomer.companyName,
                productId: item.productId,
                productCode: item.product.productCode,
                productName: item.product.productName,
                quantity: splitQuantity,
                unit: item.unit,
                unitPrice: item.salesUnitPrice,
                supplyAmount: splitAmounts.supplyAmount,
                vatAmount: splitAmounts.vatAmount,
                totalAmount: splitAmounts.totalAmount,
                memo: `[매출분리] ${item.order.customer.companyName} 오더 ${item.order.orderNo}에서 이관${reason ? ` / ${reason}` : ''}`,
                sourceType: 'SALES_SPLIT',
                sourceHash: splitHash(),
            },
        });
        await tx.orderStatusHistory.create({
            data: {
                orderId: item.orderId,
                previousStatus: item.order.status,
                newStatus: item.order.status,
                changedByUserId: editor.userId,
                changeReason: `${audit} / 분리 원장 ${created.id}`,
            },
        });
    });

    revalidatePath('/admin');
    revalidatePath(`/admin/orders/${item.orderId}`);
    revalidatePath(`/admin/customers/${item.order.customerId}/ledger`);
    revalidatePath(`/admin/customers/${targetCustomer.id}/ledger`);
    revalidatePath('/portal');
    revalidatePath('/portal/ledger');
    return { ok: true };
}

function splitTrackedQuantity(value: number | null, splitQuantity: number, remainingQuantity: number) {
    if (value == null) return { remaining: null, split: null };
    return {
        remaining: Math.min(value, remainingQuantity),
        split: Math.min(value, splitQuantity),
    };
}

export async function splitPurchaseLedgerRow(input: {
    rowId: string;
    targetSupplierId: string;
    quantity: number;
    reason?: string | null;
}): Promise<LedgerMutationResult> {
    const editor = await requireLedgerEditor();
    if (!editor.ok) return editor;

    const splitQuantity = Number(input.quantity);
    if (!input.targetSupplierId) return { ok: false, error: '이관할 매입처를 선택해 주세요.' };
    if (!Number.isFinite(splitQuantity) || splitQuantity <= 0) return { ok: false, error: '분리 수량은 0보다 커야 합니다.' };

    const targetSupplier = await prisma.supplier.findUnique({
        where: { id: input.targetSupplierId },
        select: { id: true, supplierName: true, isActive: true },
    });
    if (!targetSupplier?.isActive) return { ok: false, error: '이관할 매입처를 찾을 수 없습니다.' };

    const reason = input.reason?.trim();
    const splitHash = () => `PURCHASE_SPLIT:${Date.now()}:${Math.random().toString(36).slice(2)}`;

    if (input.rowId.startsWith('ledger:')) {
        const ledgerEntryId = input.rowId.slice('ledger:'.length);
        const entry = await prisma.ledgerEntry.findUnique({
            where: { id: ledgerEntryId },
            include: { supplier: { select: { id: true, supplierName: true } }, order: { select: { id: true, orderNo: true, status: true } } },
        });
        if (!entry || entry.ledgerType !== 'PURCHASE' || !entry.supplierId) return { ok: false, error: '매입 원장 행을 찾을 수 없습니다.' };
        if (entry.supplierId === targetSupplier.id) return { ok: false, error: '같은 매입처로는 매입분리를 할 수 없습니다.' };
        if (splitQuantity > entry.quantity && !isSameQuantity(splitQuantity, entry.quantity)) return { ok: false, error: '분리/이관 수량은 현재 수량을 초과할 수 없습니다.' };

        const fullTransfer = isSameQuantity(splitQuantity, entry.quantity);
        const remainingQuantity = Math.max(0, entry.quantity - splitQuantity);
        const remainingAmounts = calcAmounts(remainingQuantity, entry.unitPrice);
        const splitAmounts = calcAmounts(splitQuantity, entry.unitPrice);
        const audit = `[${fullTransfer ? '매입이관' : '매입분리'}] ${entry.supplier?.supplierName ?? entry.counterpartyName} ${entry.quantity}${entry.unit} 중 ${splitQuantity}${entry.unit} -> ${targetSupplier.supplierName}${reason ? ` / ${reason}` : ''}`;

        await prisma.$transaction(async (tx) => {
            if (fullTransfer) {
                await tx.ledgerEntry.update({
                    where: { id: ledgerEntryId },
                    data: {
                        supplierId: targetSupplier.id,
                        counterpartyCode: null,
                        counterpartyName: targetSupplier.supplierName,
                        memo: appendAuditMemo(entry.memo, audit),
                    },
                });
                if (entry.order) {
                    await tx.ledgerEntry.updateMany({
                        where: { orderId: entry.order.id, ledgerType: 'PURCHASE', supplierId: entry.supplierId },
                        data: {
                            supplierId: targetSupplier.id,
                            counterpartyCode: null,
                            counterpartyName: targetSupplier.supplierName,
                        },
                    });
                    await tx.orderStatusHistory.create({
                        data: {
                            orderId: entry.order.id,
                            previousStatus: entry.order.status,
                            newStatus: entry.order.status,
                            changedByUserId: editor.userId,
                            changeReason: `[매입이관] ${entry.order.orderNo} / ${audit}`,
                        },
                    });
                }
                return;
            }

            await tx.ledgerEntry.update({
                where: { id: ledgerEntryId },
                data: {
                    quantity: remainingQuantity,
                    supplyAmount: remainingAmounts.supplyAmount,
                    vatAmount: remainingAmounts.vatAmount,
                    totalAmount: remainingAmounts.totalAmount,
                    memo: appendAuditMemo(entry.memo, audit),
                },
            });
            const created = await tx.ledgerEntry.create({
                data: {
                    ledgerType: 'PURCHASE',
                    transactionDate: entry.transactionDate,
                    companyEntityId: entry.companyEntityId,
                    supplierId: targetSupplier.id,
                    counterpartyCode: null,
                    counterpartyName: targetSupplier.supplierName,
                    productId: entry.productId,
                    productCode: entry.productCode,
                    productName: entry.productName,
                    quantity: splitQuantity,
                    unit: entry.unit,
                    unitPrice: entry.unitPrice,
                    supplyAmount: splitAmounts.supplyAmount,
                    vatAmount: splitAmounts.vatAmount,
                    totalAmount: splitAmounts.totalAmount,
                    memo: `[매입분리] ${entry.supplier?.supplierName ?? entry.counterpartyName} 원장 ${dateToIso(entry.transactionDate)}에서 이관${reason ? ` / ${reason}` : ''}`,
                    sourceType: 'PURCHASE_SPLIT',
                    sourceHash: splitHash(),
                },
            });
            if (entry.order) {
                await tx.orderStatusHistory.create({
                    data: {
                        orderId: entry.order.id,
                        previousStatus: entry.order.status,
                        newStatus: entry.order.status,
                        changedByUserId: editor.userId,
                        changeReason: `[매입분리] ${entry.order.orderNo} / ${audit} / 분리 원장 ${created.id}`,
                    },
                });
            }
        });

        revalidatePath('/admin');
        revalidatePath(`/admin/suppliers/${entry.supplierId}/ledger`);
        revalidatePath(`/admin/suppliers/${targetSupplier.id}/ledger`);
        if (entry.orderId) revalidatePath(`/admin/orders/${entry.orderId}`);
        revalidatePath('/portal');
        revalidatePath('/portal/ledger');
        return { ok: true };
    }

    const item = await prisma.orderItem.findUnique({
        where: { id: input.rowId },
        include: {
            product: { select: { id: true, productCode: true, productName: true } },
            purchaseSupplier: { select: { id: true, supplierName: true } },
            order: { select: { id: true, orderNo: true, customerId: true, status: true, requestedDeliveryDate: true, deletedAt: true } },
        },
    });
    if (!item || item.order.deletedAt) return { ok: false, error: '오더 품목을 찾을 수 없습니다.' };
    if (!item.purchaseSupplierId || !item.purchaseSupplier) return { ok: false, error: '현재 매입처가 없는 품목은 매입분리할 수 없습니다.' };
    if (item.purchaseSupplierId === targetSupplier.id) return { ok: false, error: '같은 매입처로는 매입분리를 할 수 없습니다.' };
    if (splitQuantity > item.requestedQuantity && !isSameQuantity(splitQuantity, item.requestedQuantity)) return { ok: false, error: '분리/이관 수량은 현재 수량을 초과할 수 없습니다.' };

    const currentSupplierName = item.purchaseSupplier.supplierName;
    const fullTransfer = isSameQuantity(splitQuantity, item.requestedQuantity);
    const remainingQuantity = Math.max(0, item.requestedQuantity - splitQuantity);
    const remainingAmounts = calcAmounts(remainingQuantity, item.purchaseUnitPrice);
    const purchaseDate = item.purchaseLedgerDate;
    if (!purchaseDate) return { ok: false, error: '매입일자를 찾을 수 없습니다.' };
    const approved = splitTrackedQuantity(item.approvedQuantity, splitQuantity, remainingQuantity);
    const shipped = splitTrackedQuantity(item.shippedQuantity, splitQuantity, remainingQuantity);
    const received = splitTrackedQuantity(item.receivedQuantity, splitQuantity, remainingQuantity);
    const audit = `[${fullTransfer ? '매입이관' : '매입분리'}] ${currentSupplierName} 오더 ${item.order.orderNo} ${item.requestedQuantity}${item.unit} 중 ${splitQuantity}${item.unit} -> ${targetSupplier.supplierName}${reason ? ` / ${reason}` : ''}`;

    await prisma.$transaction(async (tx) => {
        if (fullTransfer) {
            await tx.orderItem.update({
                where: { id: item.id },
                data: {
                    purchaseSupplierId: targetSupplier.id,
                    purchaseSupplierConfirmedAt: new Date(),
                    memo: appendAuditMemo(item.memo, audit),
                },
            });
            await tx.ledgerEntry.updateMany({
                where: { orderItemId: item.id, ledgerType: 'PURCHASE' },
                data: {
                    supplierId: targetSupplier.id,
                    counterpartyCode: null,
                    counterpartyName: targetSupplier.supplierName,
                    memo: appendAuditMemo(item.memo, audit),
                },
            });
            await tx.orderStatusHistory.create({
                data: {
                    orderId: item.orderId,
                    previousStatus: item.order.status,
                    newStatus: item.order.status,
                    changedByUserId: editor.userId,
                    changeReason: audit,
                },
            });
            return;
        }

        await tx.orderItem.update({
            where: { id: item.id },
            data: {
                requestedQuantity: remainingQuantity,
                approvedQuantity: approved.remaining,
                shippedQuantity: shipped.remaining,
                receivedQuantity: received.remaining,
                memo: appendAuditMemo(item.memo, audit),
            },
        });
        await tx.orderItem.create({
            data: {
                orderId: item.orderId,
                productId: item.productId,
                salesEntityId: item.salesEntityId,
                purchaseEntityId: item.purchaseEntityId,
                purchaseSupplierId: targetSupplier.id,
                purchaseSupplierConfirmedAt: new Date(),
                fulfillmentType: item.fulfillmentType,
                hanwhaBagType: item.hanwhaBagType,
                requestedQuantity: splitQuantity,
                approvedQuantity: approved.split,
                shippedQuantity: shipped.split,
                receivedQuantity: received.split,
                unit: item.unit,
                salesUnitPrice: item.salesUnitPrice,
                purchaseUnitPrice: item.purchaseUnitPrice,
                salesLedgerDate: item.salesLedgerDate,
                purchaseLedgerDate: item.purchaseLedgerDate,
                expectedPrice: item.expectedPrice,
                confirmedPrice: item.confirmedPrice,
                estimatedUnitPrice: item.estimatedUnitPrice,
                priceStatus: item.priceStatus,
                priceMemo: item.priceMemo,
                memo: `[매입분리] ${currentSupplierName} 오더 ${item.order.orderNo}에서 이관${reason ? ` / ${reason}` : ''}`,
            },
        });
        await tx.ledgerEntry.updateMany({
            where: { orderItemId: item.id, ledgerType: 'PURCHASE' },
            data: {
                quantity: remainingQuantity,
                supplyAmount: remainingAmounts.supplyAmount,
                vatAmount: remainingAmounts.vatAmount,
                totalAmount: remainingAmounts.totalAmount,
                memo: appendAuditMemo(item.memo, audit),
            },
        });
        await tx.orderStatusHistory.create({
            data: {
                orderId: item.orderId,
                previousStatus: item.order.status,
                newStatus: item.order.status,
                changedByUserId: editor.userId,
                changeReason: audit,
            },
        });
    });

    revalidatePath('/admin');
    revalidatePath(`/admin/orders/${item.orderId}`);
    revalidatePath(`/admin/customers/${item.order.customerId}/ledger`);
    revalidatePath(`/admin/suppliers/${item.purchaseSupplierId}/ledger`);
    revalidatePath(`/admin/suppliers/${targetSupplier.id}/ledger`);
    revalidatePath('/portal');
    revalidatePath('/portal/ledger');
    return { ok: true };
}

