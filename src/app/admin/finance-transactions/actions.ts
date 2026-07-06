'use server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { randomBytes } from 'crypto';
import { revalidatePath } from 'next/cache';
import { canViewAllStaffData } from '@/lib/staff-permissions';

type ActionResult = { ok: true } | { ok: false; error: string };
const TX_TYPES = ['IN', 'PAYMENT', 'NOTE_IN', 'NOTE_TRANSFER', 'NOTE_DECREASE'] as const;
const NOTE_TRANSFER_SUPPLIER_NAMES = ['한화솔루션', '에코텍', '율촌화학'];

const NOTE_TRANSFER_HS_POLYMER_NAME = '\uD76C\uC131\uD3F4\uB9AC\uBA38';

async function requireYangHeeCheol() {
    const session = await auth();
    if (!session?.user || session.user.userKind !== 'staff' || !canViewAllStaffData(session.user)) return null;
    return session.user;
}

function parseDateOnly(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    return new Date(`${value}T00:00:00`);
}

function parseAmount(value: FormDataEntryValue | null) {
    const amount = Number(String(value ?? '').replace(/,/g, '').trim());
    return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function normalizeName(value: string) {
    return value
        .replace(/주식\s*회사/g, '')
        .replace(/\(주\)|㈜|\s|[()]/g, '')
        .trim()
        .toLowerCase();
}

async function findCustomerIdByName(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const customers = await prisma.customer.findMany({
        where: { isActive: true },
        select: { id: true, companyName: true },
        take: 1000,
    });
    const target = normalizeName(trimmed);
    return customers.find((customer) => normalizeName(customer.companyName) === target)?.id
        ?? customers.find((customer) => {
            const current = normalizeName(customer.companyName);
            return current.includes(target) || target.includes(current);
        })?.id
        ?? null;
}

async function findSupplierIdByName(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const suppliers = await prisma.supplier.findMany({
        where: { isActive: true },
        select: { id: true, supplierName: true },
        take: 1000,
    });
    const target = normalizeName(trimmed);
    return suppliers.find((supplier) => normalizeName(supplier.supplierName) === target)?.id
        ?? suppliers.find((supplier) => {
            const current = normalizeName(supplier.supplierName);
            return current.includes(target) || target.includes(current);
        })?.id
        ?? null;
}

export async function createFinanceTransaction(formData: FormData): Promise<ActionResult> {
    const user = await requireYangHeeCheol();
    if (!user) return { ok: false, error: '권한이 없습니다.' };

    const txType = String(formData.get('txType') ?? '');
    const txDate = parseDateOnly(String(formData.get('txDate') ?? ''));
    const amount = parseAmount(formData.get('amount'));
    const customerIdRaw = String(formData.get('customerId') ?? '');
    const supplierIdRaw = String(formData.get('supplierId') ?? '');
    const customerName = String(formData.get('customerName') ?? '').trim();
    const supplierName = String(formData.get('supplierName') ?? '').trim();
    const memo = String(formData.get('memo') ?? '').trim();

    const noteNumber = String(formData.get('noteNumber') ?? '').trim();
    const noteMaturityDate = parseDateOnly(String(formData.get('noteMaturityDate') ?? ''));
    const noteIssuer = String(formData.get('noteIssuer') ?? '').trim();
    const noteDescription = String(formData.get('noteDescription') ?? '').trim();

    if (!TX_TYPES.includes(txType as typeof TX_TYPES[number])) return { ok: false, error: '구분을 확인해주세요.' };
    if (!txDate) return { ok: false, error: '일자를 확인해주세요.' };
    if (!amount) return { ok: false, error: '금액을 확인해주세요.' };
    if (txType === 'NOTE_TRANSFER') {
        const normalizedSupplier = normalizeName(supplierName);
        const allowed = [...NOTE_TRANSFER_SUPPLIER_NAMES, NOTE_TRANSFER_HS_POLYMER_NAME].some((name) => {
            const normalizedName = normalizeName(name);
            return normalizedSupplier.includes(normalizedName) || normalizedName.includes(normalizedSupplier);
        });
        if (!allowed) return { ok: false, error: '어음지급 업체는 한화솔루션, 에코텍, 율촌화학만 선택할 수 있습니다.' };
    }
    const customerId = customerIdRaw || await findCustomerIdByName(customerName);
    const supplierId = supplierIdRaw || await findSupplierIdByName(supplierName);
    if (txType === 'NOTE_DECREASE' && !customerId) return { ok: false, error: '거래처를 선택해주세요.' };
    if (txType === 'NOTE_DECREASE' && !noteNumber) return { ok: false, error: '어음번호를 입력해주세요.' };
    if (txType === 'NOTE_DECREASE' && !noteMaturityDate) return { ok: false, error: '어음 만기일을 입력해주세요.' };
    if ((txType === 'IN' || txType === 'NOTE_IN') && !customerId) return { ok: false, error: '입금 거래처를 선택해주세요.' };
    if ((txType === 'PAYMENT' || txType === 'NOTE_TRANSFER') && !supplierId) return { ok: false, error: '지급 거래처를 선택해주세요.' };
    if ((txType === 'NOTE_IN' || txType === 'NOTE_TRANSFER') && !noteNumber) return { ok: false, error: '어음번호를 입력해주세요.' };
    if ((txType === 'NOTE_IN' || txType === 'NOTE_TRANSFER') && !noteMaturityDate) return { ok: false, error: '어음 만기일을 입력해주세요.' };
    if (txType === 'NOTE_IN') {
        const duplicate = await prisma.creditTransaction.findFirst({
            where: { txType: 'NOTE_IN', noteNumber },
            select: { id: true },
        });
        if (duplicate) return { ok: false, error: '같은 어음번호로 등록된 어음이 있습니다. 중복 건입니다. 어음번호를 더 정확히 입력해주세요.' };
    }
    if (txType === 'NOTE_TRANSFER') {
        const [received, transferred] = await Promise.all([
            prisma.creditTransaction.aggregate({
                where: { txType: 'NOTE_IN', noteNumber },
                _sum: { amount: true },
            }),
            prisma.creditTransaction.aggregate({
                where: { txType: { in: ['NOTE_TRANSFER', 'NOTE_DECREASE'] }, noteNumber },
                _sum: { amount: true },
            }),
        ]);
        const receivedAmount = received._sum.amount ?? 0;
        const transferredAmount = transferred._sum.amount ?? 0;
        const remainingAmount = receivedAmount - transferredAmount;
        if (receivedAmount <= 0) return { ok: false, error: '등록된 어음에서 선택해주세요. 없는 어음은 지급 등록할 수 없습니다.' };
        if (amount > remainingAmount) return { ok: false, error: `지급 가능 잔액은 ${remainingAmount.toLocaleString('ko-KR')}원입니다.` };
    }

    await prisma.creditTransaction.create({
        data: {
            txType,
            txDate,
            amount,
            customerId: txType === 'IN' || txType === 'NOTE_IN' || txType === 'NOTE_DECREASE' ? customerId : null,
            supplierId: txType === 'PAYMENT' || txType === 'NOTE_TRANSFER' ? supplierId : null,
            source: 'MANUAL',
            sourceRef: `MANUAL_FINANCE:${randomBytes(16).toString('hex')}:${Date.now()}`,
            memo: memo || null,
            noteNumber: noteNumber || null,
            noteMaturityDate,
            noteIssuer: noteIssuer || null,
            noteDescription: noteDescription || null,
            createdById: user.id,
        },
    });

    revalidatePath('/admin/finance-transactions');
    revalidatePath('/admin/ledger');
    return { ok: true };
}

export async function updateFinanceTransaction(formData: FormData): Promise<ActionResult> {
    const user = await requireYangHeeCheol();
    if (!user) return { ok: false, error: '권한이 없습니다.' };

    const id = String(formData.get('id') ?? '');
    const txDate = parseDateOnly(String(formData.get('txDate') ?? ''));
    const amount = parseAmount(formData.get('amount'));
    const memo = String(formData.get('memo') ?? '').trim();
    const customerIdRaw = String(formData.get('customerId') ?? '').trim();
    const supplierIdRaw = String(formData.get('supplierId') ?? '').trim();
    const customerName = String(formData.get('customerName') ?? '').trim();
    const supplierName = String(formData.get('supplierName') ?? '').trim();
    const noteNumber = String(formData.get('noteNumber') ?? '').trim();
    const noteMaturityDate = parseDateOnly(String(formData.get('noteMaturityDate') ?? ''));
    const noteIssuer = String(formData.get('noteIssuer') ?? '').trim();
    const noteDescription = String(formData.get('noteDescription') ?? '').trim();

    if (!id) return { ok: false, error: '수정할 내역을 찾을 수 없습니다.' };
    if (!txDate) return { ok: false, error: '일자를 확인해주세요.' };
    if (!amount) return { ok: false, error: '금액을 확인해주세요.' };

    const existing = await prisma.creditTransaction.findUnique({ where: { id }, select: { txType: true } });
    if (!existing) return { ok: false, error: '?섏젙???댁뿭??李얠쓣 ???놁뒿?덈떎.' };
    const isNote = existing.txType === 'NOTE_IN' || existing.txType === 'NOTE_TRANSFER' || existing.txType === 'NOTE_DECREASE';
    if (isNote && !noteNumber) return { ok: false, error: '어음번호를 입력해주세요.' };
    if (isNote && !noteMaturityDate) return { ok: false, error: '어음 만기일을 입력해주세요.' };

    const customerId = existing.txType === 'IN' || existing.txType === 'NOTE_IN' || existing.txType === 'NOTE_DECREASE'
        ? (customerIdRaw || await findCustomerIdByName(customerName))
        : '';
    const supplierId = existing.txType === 'PAYMENT' || existing.txType === 'NOTE_TRANSFER'
        ? (supplierIdRaw || await findSupplierIdByName(supplierName))
        : '';
    if (existing.txType === 'NOTE_DECREASE' && !customerId) return { ok: false, error: '거래처를 선택해주세요.' };
    if ((existing.txType === 'IN' || existing.txType === 'NOTE_IN') && !customerId) return { ok: false, error: '거래처를 선택해주세요.' };
    if ((existing.txType === 'PAYMENT' || existing.txType === 'NOTE_TRANSFER') && !supplierId) return { ok: false, error: '매입처를 선택해주세요.' };

    const [customer, supplier] = await Promise.all([
        customerId ? prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, isActive: true } }) : null,
        supplierId ? prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true, isActive: true } }) : null,
    ]);
    if (customerId && !customer?.isActive) return { ok: false, error: '거래처를 찾을 수 없습니다.' };
    if (supplierId && !supplier?.isActive) return { ok: false, error: '매입처를 찾을 수 없습니다.' };

    await prisma.creditTransaction.update({
        where: { id },
        data: {
            txDate,
            amount,
            customerId: customerId || null,
            supplierId: supplierId || null,
            memo: memo || null,
            ...(isNote ? {
                noteNumber: noteNumber || null,
                noteMaturityDate,
                noteIssuer: noteIssuer || null,
                noteDescription: noteDescription || null,
            } : {}),
        },
    });

    revalidatePath('/admin/finance-transactions');
    revalidatePath('/admin/ledger');
    return { ok: true };
}

export async function deleteFinanceTransaction(id: string): Promise<ActionResult> {
    const user = await requireYangHeeCheol();
    if (!user) return { ok: false, error: '권한이 없습니다.' };
    await prisma.creditTransaction.delete({ where: { id } });
    revalidatePath('/admin/finance-transactions');
    revalidatePath('/admin/ledger');
    return { ok: true };
}
