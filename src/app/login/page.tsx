import { redirect } from 'next/navigation';
import type { Session } from 'next-auth';
import { auth } from '@/lib/auth';
import LoginForm from './LoginForm';

export const metadata = {
    title: '로그인 · 한양유화 BNT OS',
};

export const dynamic = 'force-dynamic';

function safeRedirectPath(value: string | string[] | undefined, userKind: 'staff' | 'customer') {
    const raw = Array.isArray(value) ? value[0] : value;
    const fallback = userKind === 'customer' ? '/portal' : '/admin';
    if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return fallback;
    if (userKind === 'customer') return raw.startsWith('/portal') ? raw : '/portal';
    return raw.startsWith('/admin') ? raw : '/admin';
}

export default async function LoginPage({
    searchParams,
}: {
    searchParams: Promise<{ redirect?: string | string[] }>;
}) {
    let session: Session | null = null;
    try {
        session = await auth();
    } catch {
        session = null;
    }

    if (session?.user) {
        const sp = await searchParams;
        redirect(safeRedirectPath(sp.redirect, session.user.userKind));
    }

    return (
        <main className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 flex items-center justify-center px-4 py-12">
            <LoginForm />
        </main>
    );
}
