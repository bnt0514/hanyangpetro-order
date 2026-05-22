'use server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { hashPassword, verifyPassword, normalizeBusinessNumber } from '@/lib/password';

export async function changeMyPassword(formData: FormData) {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };

    const current = String(formData.get('current') ?? '');
    const next = String(formData.get('next') ?? '');
    const confirm = String(formData.get('confirm') ?? '');

    if (!current || !next || !confirm) return { ok: false, error: '모든 항목을 입력해 주세요.' };
    if (next !== confirm) return { ok: false, error: '새 비밀번호가 일치하지 않습니다.' };
    if (next.length < 4) return { ok: false, error: '비밀번호는 4자 이상이어야 합니다.' };

    if (session.user.userKind === 'staff') {
        const user = await prisma.user.findUnique({ where: { id: session.user.id } });
        if (!user?.passwordHash) return { ok: false, error: '사용자를 찾을 수 없습니다.' };
        const ok = await verifyPassword(current, user.passwordHash);
        if (!ok) return { ok: false, error: '현재 비밀번호가 올바르지 않습니다.' };
        await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } });
    } else {
        // customer
        const cu = await prisma.customerUser.findUnique({ where: { id: session.user.id } });
        if (!cu?.passwordHash) return { ok: false, error: '사용자를 찾을 수 없습니다.' };
        const ok = await verifyPassword(current, cu.passwordHash);
        if (!ok) return { ok: false, error: '현재 비밀번호가 올바르지 않습니다.' };
        await prisma.customerUser.update({ where: { id: cu.id }, data: { passwordHash: await hashPassword(next) } });
    }

    return { ok: true };
}

/** 양희철 전용: 직원 비밀번호 초기화 (이름으로 초기화) */
export async function resetStaffPassword(formData: FormData) {
    const session = await auth();
    if (!session?.user || session.user.name !== '양희철') return { ok: false, error: '권한이 없습니다.' };

    const userId = String(formData.get('userId') ?? '');
    if (!userId) return { ok: false, error: '사용자 ID가 없습니다.' };

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return { ok: false, error: '사용자를 찾을 수 없습니다.' };

    await prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await hashPassword(user.name) },
    });

    return { ok: true, message: `${user.name} 비밀번호가 이름(${user.name})으로 초기화됐습니다.` };
}

/** 양희철 전용: 거래처 비밀번호 초기화 (사업자번호로 초기화) */
export async function resetCustomerPassword(formData: FormData) {
    const session = await auth();
    if (!session?.user || session.user.name !== '양희철') return { ok: false, error: '권한이 없습니다.' };

    const customerUserId = String(formData.get('customerUserId') ?? '');
    if (!customerUserId) return { ok: false, error: '사용자 ID가 없습니다.' };

    const cu = await prisma.customerUser.findUnique({
        where: { id: customerUserId },
        include: { customer: { select: { businessNumber: true, companyName: true } } },
    });
    if (!cu) return { ok: false, error: '거래처 사용자를 찾을 수 없습니다.' };

    const bn = cu.customer?.businessNumber ?? '';
    const defaultPw = normalizeBusinessNumber(bn);
    if (!defaultPw) return { ok: false, error: '사업자번호가 없어 초기화할 수 없습니다.' };

    await prisma.customerUser.update({
        where: { id: customerUserId },
        data: { passwordHash: await hashPassword(defaultPw) },
    });

    return { ok: true, message: `${cu.customer?.companyName ?? cu.name} 비밀번호가 사업자번호(${defaultPw})로 초기화됐습니다.` };
}
