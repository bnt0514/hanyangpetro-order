'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { canManageCreditLimits, getCreditLimitReport, normalizeCreditLimitMonths, type CreditLimitSortDir, type CreditLimitSortKey } from '@/lib/credit-limits';

function requireCreditLimitManager(user: { id?: string; name?: string | null; userKind?: string } | undefined) {
    if (!user) redirect('/login');
    if (!canManageCreditLimits(user)) redirect('/admin');
}

function amountFromForm(value: FormDataEntryValue | null, fieldName: string) {
    const text = String(value ?? '').replace(/,/g, '').trim();
    if (!text) return 0;
    const number = Number(text);
    if (!Number.isFinite(number) || number < 0) throw new Error(`${fieldName}은 0 이상의 숫자여야 합니다.`);
    return Math.round(number);
}

function queryFromForm(formData: FormData) {
    const params = new URLSearchParams();
    const asOf = String(formData.get('asOf') || '');
    const months = String(formData.get('months') || '3');
    const sort = String(formData.get('sort') || 'calculatedLimit');
    const dir = String(formData.get('dir') || 'desc');
    const q = String(formData.get('q') || '');
    if (asOf) params.set('asOf', asOf);
    params.set('months', String(normalizeCreditLimitMonths(months)));
    if (sort) params.set('sort', sort);
    if (dir) params.set('dir', dir);
    if (q) params.set('q', q);
    return params.toString();
}

export async function updateCustomerCreditLimit(formData: FormData) {
    const session = await auth();
    requireCreditLimitManager(session?.user);

    const customerId = String(formData.get('customerId') || '');
    if (!customerId) throw new Error('거래처 정보가 없습니다.');

    const rawGrade = String(formData.get('creditGrade') || 'B').toUpperCase();
    const creditGrade = ['A', 'B', 'C'].includes(rawGrade) ? rawGrade : 'B';

    await prisma.customer.update({
        where: { id: customerId },
        data: {
            creditLimit: amountFromForm(formData.get('creditLimit'), '여신한도'),
            creditInsuranceAmount: amountFromForm(formData.get('creditInsuranceAmount'), '매출채권보험 금액'),
            mortgageAmount: amountFromForm(formData.get('mortgageAmount'), '근저당설정 금액'),
            creditGrade,
        },
    });

    revalidatePath('/admin/credit-limits');
    redirect(`/admin/credit-limits?${queryFromForm(formData)}`);
}

export async function bulkUpdateCreditLimits(
    updates: { customerId: string; creditLimit: string; creditGrade: string; creditInsuranceAmount: string; mortgageAmount: string }[],
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
    const session = await auth();
    requireCreditLimitManager(session?.user);

    if (!updates.length) return { ok: true, count: 0 };

    try {
        const parsed = updates.map((u) => {
            const rawGrade = (u.creditGrade || 'B').toUpperCase();
            return {
                customerId: u.customerId,
                creditLimit: amountFromForm(u.creditLimit, '여신한도'),
                creditGrade: ['A', 'B', 'C'].includes(rawGrade) ? rawGrade : 'B',
                creditInsuranceAmount: amountFromForm(u.creditInsuranceAmount, '매출채권보험'),
                mortgageAmount: amountFromForm(u.mortgageAmount, '근저당설정'),
            };
        });

        await prisma.$transaction(
            parsed.map((u) =>
                prisma.customer.update({
                    where: { id: u.customerId },
                    data: {
                        creditLimit: u.creditLimit,
                        creditGrade: u.creditGrade,
                        creditInsuranceAmount: u.creditInsuranceAmount,
                        mortgageAmount: u.mortgageAmount,
                    },
                }),
            ),
        );

        revalidatePath('/admin/credit-limits');
        return { ok: true, count: parsed.length };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

export async function applyCalculatedCreditLimits(formData: FormData) {
    const session = await auth();
    requireCreditLimitManager(session?.user);

    const report = await getCreditLimitReport({
        asOf: String(formData.get('asOf') || ''),
        months: String(formData.get('months') || '3'),
        sort: String(formData.get('sort') || 'calculatedLimit') as CreditLimitSortKey,
        dir: String(formData.get('dir') || 'desc') as CreditLimitSortDir,
        q: String(formData.get('q') || ''),
    });

    await prisma.$transaction(
        report.rows.map((row) => prisma.customer.update({
            where: { id: row.customerId },
            data: { creditLimit: row.calculatedLimit },
        })),
    );

    revalidatePath('/admin/credit-limits');
    redirect(`/admin/credit-limits?${queryFromForm(formData)}`);
}
