'use server';

import { signIn } from '@/lib/auth';
import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';

export type LoginResult = { ok: false; error: string } | { ok: true };

export async function loginCustomer(formData: FormData): Promise<LoginResult> {
    const companyName = String(formData.get('companyName') ?? '').trim();
    const businessNumber = String(formData.get('businessNumber') ?? '').trim();

    if (!companyName || !businessNumber) {
        return { ok: false, error: '회사명과 사업자등록번호를 모두 입력해주세요.' };
    }

    try {
        await signIn('customer', {
            companyName,
            businessNumber,
            redirect: false,
        });
    } catch (e) {
        if (e instanceof AuthError) {
            return { ok: false, error: '회사명 또는 사업자등록번호가 올바르지 않습니다.' };
        }
        // NEXT_REDIRECT errors should bubble through
        throw e;
    }
    redirect('/portal');
}

export async function loginStaff(formData: FormData): Promise<LoginResult> {
    const loginId = String(formData.get('loginId') ?? '').trim();
    const password = String(formData.get('password') ?? '');

    if (!loginId || !password) {
        return { ok: false, error: '아이디와 비밀번호를 모두 입력해주세요.' };
    }

    try {
        await signIn('staff', {
            loginId,
            password,
            redirect: false,
        });
    } catch (e) {
        if (e instanceof AuthError) {
            return { ok: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' };
        }
        throw e;
    }
    redirect('/admin');
}
