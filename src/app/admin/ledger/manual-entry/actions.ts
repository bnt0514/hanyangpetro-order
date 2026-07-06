'use server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { randomBytes } from 'crypto';
import { canViewAllStaffData } from '@/lib/staff-permissions';

export type ManualEntryResult = { ok: true; id: string } | { ok: false; error: string };
export type ManualEntriesResult = { ok: true; ids: string[] } | { ok: false; error: string };
export type DeleteEntryResult = { ok: true } | { ok: false; error: string };
export type CreateProductResult = { ok: true; product: { id: string; productName: string; productCode: string } } | { ok: false; error: string };

function parseDateOnly(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    return new Date(`${value}T00:00:00`);
}

async function requireAdmin() {
    const session = await auth();
    if (!session?.user) return null;
    if (session.user.userKind !== 'staff') return null;
    const dbUser = await prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true, role: true, isActive: true } });
    if (!dbUser?.isActive || !canViewAllStaffData({ ...session.user, name: dbUser.name, role: dbUser.role })) return null;
    return { ...session.user, name: dbUser.name };
}

async function generateNextProductCode(): Promise<string> {
    const products = await prisma.product.findMany({
        select: { productCode: true },
        where: { productCode: { startsWith: 'ITEM-' } },
    });
    const nums = products
        .map((p) => {
            const m = p.productCode.match(/^ITEM-([0-9]+)$/i);
            return m ? parseInt(m[1], 10) : 0;
        })
        .filter((n) => !Number.isNaN(n));
    const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
    return `ITEM-${next}`;
}

function calcAmounts(quantity: number, unitPrice: number | null | undefined) {
    if (unitPrice == null) return { supplyAmount: null, vatAmount: null, totalAmount: null };
    const supplyAmount = Math.round(quantity * unitPrice);
    const vatAmount = Math.round(supplyAmount * 0.1);
    return { supplyAmount, vatAmount, totalAmount: supplyAmount + vatAmount };
}

export async function createManualEntryProduct(productName: string): Promise<CreateProductResult> {
    const user = await requireAdmin();
    if (!user) return { ok: false, error: '권한이 없습니다.' };

    const name = productName.trim();
    if (!name) return { ok: false, error: '품목명을 입력해 주세요.' };

    const existing = await prisma.product.findFirst({
        where: { productName: { equals: name } },
        select: { id: true, productName: true, productCode: true },
    });
    if (existing) return { ok: true, product: existing };

    const product = await prisma.product.create({
        data: {
            productCode: await generateNextProductCode(),
            productName: name,
            isActive: true,
        },
        select: { id: true, productName: true, productCode: true },
    });

    revalidatePath('/admin/products');
    revalidatePath('/admin/ledger/manual-entry');
    return { ok: true, product };
}

export async function createManualLedgerEntries(input: {
    ledgerType: 'SALES' | 'PURCHASE';
    transactionDate: string;
    customerId?: string;
    companyEntityId?: string;
    supplierId?: string;
    items: {
        productId: string;
        quantity: number;
        unit: string;
        unitPrice?: number | null;
        memo?: string;
    }[];
    memo?: string;
}): Promise<ManualEntriesResult> {
    const user = await requireAdmin();
    if (!user) return { ok: false, error: '권한이 없습니다. (관리자 또는 양희철만 가능)' };

    const txDate = parseDateOnly(input.transactionDate);
    if (!txDate) return { ok: false, error: '거래일자를 확인해 주세요.' };
    if (!input.items.length) return { ok: false, error: '품목을 1개 이상 입력해 주세요.' };
    if (input.ledgerType === 'SALES' && !input.customerId) return { ok: false, error: '매출 거래처를 선택해 주세요.' };
    if (input.ledgerType === 'PURCHASE' && !input.supplierId) return { ok: false, error: '매입처를 선택해 주세요.' };

    let counterpartyName = '';
    let counterpartyCode: string | undefined;

    if (input.ledgerType === 'SALES' && input.customerId) {
        const customer = await prisma.customer.findUnique({
            where: { id: input.customerId },
            select: { companyName: true, customerCode: true },
        });
        if (!customer) return { ok: false, error: '거래처를 찾을 수 없습니다.' };
        counterpartyName = customer.companyName;
        counterpartyCode = customer.customerCode ?? undefined;
    }

    if (input.ledgerType === 'PURCHASE' && input.supplierId) {
        const supplier = await prisma.supplier.findUnique({
            where: { id: input.supplierId },
            select: { supplierName: true },
        });
        if (!supplier) return { ok: false, error: '매입처를 찾을 수 없습니다.' };
        counterpartyName = supplier.supplierName;
    }

    const productIds = input.items.map((item) => item.productId).filter(Boolean);
    const products = await prisma.product.findMany({
        where: { id: { in: productIds }, isActive: true },
        select: { id: true, productName: true, productCode: true },
    });
    const productMap = new Map(products.map((product) => [product.id, product]));

    for (const [index, item] of input.items.entries()) {
        if (!item.productId || !productMap.has(item.productId)) return { ok: false, error: `${index + 1}번째 품목을 정확히 매칭해 주세요.` };
        if (!Number.isFinite(item.quantity) || item.quantity === 0) return { ok: false, error: `${index + 1}번째 수량을 확인해 주세요.` };
        if (item.unitPrice != null && (!Number.isFinite(item.unitPrice) || item.unitPrice < 0)) return { ok: false, error: `${index + 1}번째 단가를 확인해 주세요.` };
    }

    const entries = await prisma.$transaction(input.items.map((item, index) => {
        const product = productMap.get(item.productId)!;
        const amounts = calcAmounts(item.quantity, item.unitPrice);
        const memoParts = [input.memo?.trim(), item.memo?.trim()].filter(Boolean).join(' / ');
        return prisma.ledgerEntry.create({
            data: {
                ledgerType: input.ledgerType,
                transactionDate: txDate,
                customerId: input.ledgerType === 'SALES' ? input.customerId : null,
                companyEntityId: input.ledgerType === 'SALES' ? (input.companyEntityId ?? null) : null,
                supplierId: input.ledgerType === 'PURCHASE' ? input.supplierId : null,
                counterpartyName,
                counterpartyCode: counterpartyCode ?? null,
                productId: product.id,
                productName: product.productName,
                productCode: product.productCode,
                quantity: item.quantity,
                unit: item.unit || 'TON',
                unitPrice: item.unitPrice ?? null,
                supplyAmount: amounts.supplyAmount,
                vatAmount: amounts.vatAmount,
                totalAmount: amounts.totalAmount,
                memo: memoParts ? `[수동입력] ${memoParts} (입력: ${user.name})` : `[수동입력] 입력: ${user.name}`,
                sourceType: 'MANUAL',
                sourceHash: `MANUAL:${randomBytes(16).toString('hex')}:${Date.now()}:${index}`,
            },
            select: { id: true },
        });
    }));

    revalidatePath('/admin/ledger');
    revalidatePath('/admin/ledger/manual-entry');
    if (input.customerId) revalidatePath(`/admin/customers/${input.customerId}/ledger`);
    if (input.supplierId) revalidatePath(`/admin/suppliers/${input.supplierId}/ledger`);

    return { ok: true, ids: entries.map((entry) => entry.id) };
}

export async function createManualLedgerEntry(input: {
    ledgerType: 'SALES' | 'PURCHASE';
    transactionDate: string;
    // 매출
    customerId?: string;
    companyEntityId?: string;
    // 매입
    supplierId?: string;
    // 공통
    productId?: string;
    productName: string;
    productCode?: string;
    quantity: number;
    unit: string;
    unitPrice?: number | null;
    supplyAmount?: number | null;
    vatAmount?: number | null;
    totalAmount?: number | null;
    memo?: string;
}): Promise<ManualEntryResult> {
    const user = await requireAdmin();
    if (!user) return { ok: false, error: '권한이 없습니다. (관리자 또는 양희철만 가능)' };

    const txDate = parseDateOnly(input.transactionDate);
    if (!txDate) return { ok: false, error: '거래일자를 확인해 주세요.' };

    if (!input.productName.trim()) return { ok: false, error: '품목명을 입력해 주세요.' };
    if (!Number.isFinite(input.quantity)) return { ok: false, error: '수량을 확인해 주세요.' };
    if (input.quantity === 0) return { ok: false, error: '수량은 0이 될 수 없습니다.' };

    if (input.ledgerType === 'SALES' && !input.customerId) {
        return { ok: false, error: '매출 거래처를 선택해 주세요.' };
    }
    if (input.ledgerType === 'PURCHASE' && !input.supplierId) {
        return { ok: false, error: '매입처를 선택해 주세요.' };
    }

    // 거래처/공급사 이름 가져오기
    let counterpartyName = '';
    let counterpartyCode: string | undefined;

    if (input.ledgerType === 'SALES' && input.customerId) {
        const customer = await prisma.customer.findUnique({
            where: { id: input.customerId },
            select: { companyName: true, customerCode: true },
        });
        if (!customer) return { ok: false, error: '거래처를 찾을 수 없습니다.' };
        counterpartyName = customer.companyName;
        counterpartyCode = customer.customerCode ?? undefined;
    }

    if (input.ledgerType === 'PURCHASE' && input.supplierId) {
        const supplier = await prisma.supplier.findUnique({
            where: { id: input.supplierId },
            select: { supplierName: true },
        });
        if (!supplier) return { ok: false, error: '매입처를 찾을 수 없습니다.' };
        counterpartyName = supplier.supplierName;
    }

    // 품목 이름 확인
    let finalProductName = input.productName.trim();
    let finalProductCode = input.productCode?.trim();
    if (input.productId) {
        const product = await prisma.product.findUnique({
            where: { id: input.productId },
            select: { productName: true, productCode: true },
        });
        if (product) {
            finalProductName = product.productName;
            finalProductCode = product.productCode;
        }
    }

    // unique hash
    const sourceHash = `MANUAL:${randomBytes(16).toString('hex')}:${Date.now()}`;

    const entry = await prisma.ledgerEntry.create({
        data: {
            ledgerType: input.ledgerType,
            transactionDate: txDate,
            customerId: input.ledgerType === 'SALES' ? input.customerId : null,
            companyEntityId: input.ledgerType === 'SALES' ? (input.companyEntityId ?? null) : null,
            supplierId: input.ledgerType === 'PURCHASE' ? input.supplierId : null,
            counterpartyName,
            counterpartyCode: counterpartyCode ?? null,
            productId: input.productId ?? null,
            productName: finalProductName,
            productCode: finalProductCode ?? null,
            quantity: input.quantity,
            unit: input.unit || 'TON',
            unitPrice: input.unitPrice ?? null,
            supplyAmount: input.supplyAmount ?? null,
            vatAmount: input.vatAmount ?? null,
            totalAmount: input.totalAmount ?? null,
            memo: input.memo?.trim()
                ? `[수동입력] ${input.memo.trim()} (입력: ${user.name})`
                : `[수동입력] 입력: ${user.name}`,
            sourceType: 'MANUAL',
            sourceHash,
        },
    });

    revalidatePath('/admin/ledger');
    revalidatePath('/admin/ledger/manual-entry');
    if (input.customerId) revalidatePath(`/admin/customers/${input.customerId}/ledger`);
    if (input.supplierId) revalidatePath(`/admin/suppliers/${input.supplierId}/ledger`);

    return { ok: true, id: entry.id };
}

export async function deleteManualLedgerEntry(id: string): Promise<DeleteEntryResult> {
    const user = await requireAdmin();
    if (!user) return { ok: false, error: '권한이 없습니다.' };

    const entry = await prisma.ledgerEntry.findUnique({
        where: { id },
        select: { id: true, sourceType: true, customerId: true, supplierId: true, ledgerType: true, productName: true, quantity: true, transactionDate: true },
    });

    if (!entry) return { ok: false, error: '항목을 찾을 수 없습니다.' };
    if (entry.sourceType !== 'MANUAL') return { ok: false, error: '수동 입력 항목만 삭제할 수 있습니다.' };

    await prisma.ledgerEntry.delete({ where: { id } });

    revalidatePath('/admin/ledger');
    revalidatePath('/admin/ledger/manual-entry');
    if (entry.customerId) revalidatePath(`/admin/customers/${entry.customerId}/ledger`);
    if (entry.supplierId) revalidatePath(`/admin/suppliers/${entry.supplierId}/ledger`);

    return { ok: true };
}

export async function getRecentManualEntries() {
    const user = await requireAdmin();
    if (!user) return [];

    return prisma.ledgerEntry.findMany({
        where: { sourceType: 'MANUAL' },
        include: {
            customer: { select: { companyName: true } },
            supplier: { select: { supplierName: true } },
            product: { select: { productName: true, productCode: true } },
            companyEntity: { select: { displayName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
    });
}
