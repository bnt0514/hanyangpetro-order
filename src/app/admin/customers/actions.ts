'use server';

import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';

export type CreateCustomerResult =
    | { ok: true; customerId: string }
    | { ok: false; error: string };

export type AddressInput = {
    label: string;
    addressLine1: string;
    addressLine2?: string;
    postalCode?: string;
    contactName?: string;
    contactPhone?: string;
    isDefault?: boolean;
    memo?: string;
};

export type CustomerInput = {
    customerCode: string;
    companyName: string;
    businessNumber?: string;
    creditLimit?: number;
    paymentTerms?: string;
    memo?: string;
    isActive?: boolean;
};

async function getNextCustomerCode(tx: Prisma.TransactionClient) {
    const customers = await tx.customer.findMany({
        select: { customerCode: true },
    });

    let bestPrefix = '';
    let bestWidth = 3;
    let maxNumber = 0;

    for (const customer of customers) {
        const match = customer.customerCode.match(/^(.*?)(\d+)$/);
        if (!match) continue;

        const number = Number(match[2]);
        if (!Number.isFinite(number) || number <= maxNumber) continue;

        maxNumber = number;
        bestPrefix = match[1];
        bestWidth = match[2].length;
    }

    return `${bestPrefix}${String(maxNumber + 1).padStart(bestWidth, '0')}`;
}

export type AddressImportRow = {
    customerCode?: string;
    companyName?: string;
    label?: string;
    addressLine1?: string;
    addressLine2?: string;
    postalCode?: string;
    contactName?: string;
    contactPhone?: string;
    memo?: string;
};

export type AddressImportResult =
    | {
        ok: true;
        created: number;
        updated: number;
        unmatched: Array<AddressImportRow & { reason: string }>;
    }
    | { ok: false; error: string };

/** 업체만 등록 */
export async function createCustomer(input: {
    customerCode?: string;
    companyName: string;
    businessNumber?: string;
    creditLimit?: number;
    paymentTerms?: string;
    memo?: string;
    address?: AddressInput;
}): Promise<CreateCustomerResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff') return { ok: false, error: '직원만 업체를 등록할 수 있습니다.' };

    const requestedCode = input.customerCode?.trim();
    const name = input.companyName?.trim();
    if (!name) return { ok: false, error: '업체명을 입력해 주세요.' };

    if (requestedCode) {
        const existing = await prisma.customer.findUnique({ where: { customerCode: requestedCode } });
        if (existing) return { ok: false, error: `이미 사용 중인 거래처코드입니다: ${requestedCode}` };
    }

    if (input.address) {
        const addrLabel = input.address.label?.trim();
        const addrLine1 = input.address.addressLine1?.trim();
        if (!addrLabel) return { ok: false, error: '도착지 이름을 입력해 주세요.' };
        if (!addrLine1) return { ok: false, error: '도착지 주소를 입력해 주세요.' };
    }

    try {
        const customer = await prisma.$transaction(async (tx) => {
            const code = requestedCode || await getNextCustomerCode(tx);
            return tx.customer.create({
                data: {
                    customerCode: code,
                    companyName: name,
                    businessNumber: input.businessNumber?.trim() || null,
                    creditLimit: Number.isFinite(input.creditLimit) ? input.creditLimit! : 0,
                    paymentTerms: input.paymentTerms?.trim() || null,
                    memo: input.memo?.trim() || null,
                    ...(input.address && {
                        addresses: {
                            create: {
                                label: input.address.label.trim(),
                                addressLine1: input.address.addressLine1.trim(),
                                addressLine2: input.address.addressLine2?.trim() || null,
                                postalCode: input.address.postalCode?.trim() || null,
                                contactName: input.address.contactName?.trim() || null,
                                contactPhone: input.address.contactPhone?.trim() || null,
                                isDefault: true,
                                memo: input.address.memo?.trim() || null,
                            },
                        },
                    }),
                },
            });
        });
        revalidatePath('/admin');
        revalidatePath('/admin/customers');
        return { ok: true, customerId: customer.id };
    } catch (e) {
        console.error('createCustomer failed:', e);
        return { ok: false, error: '업체 등록 중 오류가 발생했습니다.' };
    }
}

/** 기존 업체에 도착지만 추가 */
export async function addDeliveryAddress(input: {
    customerId: string;
    address: AddressInput;
}): Promise<CreateCustomerResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff') return { ok: false, error: '직원만 도착지를 등록할 수 있습니다.' };

    const addrLabel = input.address.label?.trim();
    const addrLine1 = input.address.addressLine1?.trim();
    if (!input.customerId) return { ok: false, error: '업체를 선택해 주세요.' };
    if (!addrLabel) return { ok: false, error: '도착지 이름을 입력해 주세요.' };
    if (!addrLine1) return { ok: false, error: '도착지 주소를 입력해 주세요.' };

    const customer = await prisma.customer.findUnique({ where: { id: input.customerId } });
    if (!customer) return { ok: false, error: '업체를 찾을 수 없습니다.' };

    try {
        const isFirst = (await prisma.deliveryAddress.count({ where: { customerId: input.customerId } })) === 0;
        await prisma.deliveryAddress.create({
            data: {
                customerId: input.customerId,
                label: addrLabel,
                addressLine1: addrLine1,
                addressLine2: input.address.addressLine2?.trim() || null,
                postalCode: input.address.postalCode?.trim() || null,
                contactName: input.address.contactName?.trim() || null,
                contactPhone: input.address.contactPhone?.trim() || null,
                isDefault: isFirst || (input.address.isDefault ?? false),
                memo: input.address.memo?.trim() || null,
            },
        });
        revalidatePath('/admin');
        revalidatePath('/admin/customers');
        return { ok: true, customerId: input.customerId };
    } catch (e) {
        console.error('addDeliveryAddress failed:', e);
        return { ok: false, error: '도착지 등록 중 오류가 발생했습니다.' };
    }
}

export async function updateCustomer(
    customerId: string,
    input: CustomerInput,
): Promise<CreateCustomerResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff') return { ok: false, error: '직원만 업체를 수정할 수 있습니다.' };

    const code = input.customerCode?.trim();
    const name = input.companyName?.trim();
    if (!customerId) return { ok: false, error: '업체 ID가 없습니다.' };
    if (!code) return { ok: false, error: '거래처코드를 입력해 주세요.' };
    if (!name) return { ok: false, error: '업체명을 입력해 주세요.' };

    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) return { ok: false, error: '업체를 찾을 수 없습니다.' };

    const duplicate = await prisma.customer.findFirst({
        where: { customerCode: code, id: { not: customerId } },
        select: { id: true },
    });
    if (duplicate) return { ok: false, error: `이미 사용 중인 거래처코드입니다: ${code}` };

    try {
        await prisma.customer.update({
            where: { id: customerId },
            data: {
                customerCode: code,
                companyName: name,
                businessNumber: input.businessNumber?.trim() || null,
                creditLimit: Number.isFinite(input.creditLimit) ? input.creditLimit! : 0,
                paymentTerms: input.paymentTerms?.trim() || null,
                memo: input.memo?.trim() || null,
                isActive: input.isActive ?? true,
            },
        });
        revalidatePath('/admin');
        revalidatePath('/admin/customers');
        revalidatePath(`/admin/customers/${customerId}`);
        return { ok: true, customerId };
    } catch (e) {
        console.error('updateCustomer failed:', e);
        return { ok: false, error: '업체 수정 중 오류가 발생했습니다.' };
    }
}

export async function saveDeliveryAddress(input: {
    customerId: string;
    addressId?: string;
    address: AddressInput & { isActive?: boolean };
}): Promise<CreateCustomerResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff') return { ok: false, error: '직원만 도착지를 수정할 수 있습니다.' };

    const addrLabel = input.address.label?.trim();
    const addrLine1 = input.address.addressLine1?.trim();
    if (!input.customerId) return { ok: false, error: '업체를 선택해 주세요.' };
    if (!addrLabel) return { ok: false, error: '도착지 이름을 입력해 주세요.' };
    if (!addrLine1) return { ok: false, error: '도착지 주소를 입력해 주세요.' };

    const customer = await prisma.customer.findUnique({ where: { id: input.customerId } });
    if (!customer) return { ok: false, error: '업체를 찾을 수 없습니다.' };

    try {
        await prisma.$transaction(async (tx) => {
            const isFirst = (await tx.deliveryAddress.count({ where: { customerId: input.customerId } })) === 0;
            const shouldBeDefault = isFirst || (input.address.isDefault ?? false);

            if (shouldBeDefault) {
                await tx.deliveryAddress.updateMany({
                    where: { customerId: input.customerId },
                    data: { isDefault: false },
                });
            }

            const data = {
                label: addrLabel,
                addressLine1: addrLine1,
                addressLine2: input.address.addressLine2?.trim() || null,
                postalCode: input.address.postalCode?.trim() || null,
                contactName: input.address.contactName?.trim() || null,
                contactPhone: input.address.contactPhone?.trim() || null,
                isDefault: shouldBeDefault,
                isActive: input.address.isActive ?? true,
                memo: input.address.memo?.trim() || null,
            };

            if (input.addressId) {
                await tx.deliveryAddress.update({
                    where: { id: input.addressId, customerId: input.customerId },
                    data,
                });
            } else {
                await tx.deliveryAddress.create({
                    data: { customerId: input.customerId, ...data },
                });
            }
        });

        revalidatePath('/admin');
        revalidatePath('/admin/customers');
        revalidatePath(`/admin/customers/${input.customerId}`);
        return { ok: true, customerId: input.customerId };
    } catch (e) {
        console.error('saveDeliveryAddress failed:', e);
        return { ok: false, error: '도착지 저장 중 오류가 발생했습니다.' };
    }
}

export async function bulkImportDeliveryAddresses(rows: AddressImportRow[]): Promise<AddressImportResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff') return { ok: false, error: '직원만 도착지를 가져올 수 있습니다.' };
    if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: '가져올 자료가 없습니다.' };

    const customers = await prisma.customer.findMany({
        select: { id: true, customerCode: true, companyName: true },
    });
    const byCode = new Map(customers.map((customer) => [customer.customerCode.trim(), customer]));
    const byName = new Map(customers.map((customer) => [customer.companyName.trim(), customer]));
    const unmatched: Array<AddressImportRow & { reason: string }> = [];
    let created = 0;
    let updated = 0;

    for (const row of rows) {
        const customerCode = row.customerCode?.trim();
        const companyName = row.companyName?.trim();
        const label = row.label?.trim() || row.addressLine1?.trim() || '도착지';
        const addressLine1 = row.addressLine1?.trim();
        const customer = (customerCode ? byCode.get(customerCode) : undefined) ?? (companyName ? byName.get(companyName) : undefined);

        if (!customer) {
            unmatched.push({ ...row, reason: '업체 매칭 실패' });
            continue;
        }
        if (!addressLine1) {
            unmatched.push({ ...row, reason: '주소 없음' });
            continue;
        }

        const existing = await prisma.deliveryAddress.findFirst({
            where: { customerId: customer.id, label },
            select: { id: true },
        });
        const data = {
            label,
            addressLine1,
            addressLine2: row.addressLine2?.trim() || null,
            postalCode: row.postalCode?.trim() || null,
            contactName: row.contactName?.trim() || null,
            contactPhone: row.contactPhone?.trim() || null,
            memo: row.memo?.trim() || null,
            isActive: true,
        };

        if (existing) {
            await prisma.deliveryAddress.update({ where: { id: existing.id }, data });
            updated += 1;
        } else {
            const isFirst = (await prisma.deliveryAddress.count({ where: { customerId: customer.id } })) === 0;
            await prisma.deliveryAddress.create({ data: { customerId: customer.id, ...data, isDefault: isFirst } });
            created += 1;
        }
    }

    revalidatePath('/admin');
    revalidatePath('/admin/customers');
    return { ok: true, created, updated, unmatched };
}
