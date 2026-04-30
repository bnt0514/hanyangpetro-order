import { auth, signOut } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { canManageHanwhaCredentials, getHanwhaPasswordMeta, getHanwhaUsername } from '@/lib/hanwha-credentials';
import { prisma } from '@/lib/db';
import HanwhaCredentialClient from './HanwhaCredentialClient';

export const dynamic = 'force-dynamic';

export default async function HanwhaSettingsPage() {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal');
    if (!canManageHanwhaCredentials(session.user.role)) {
        redirect('/admin?error=forbidden');
    }

    const username = await getHanwhaUsername();
    const meta = await getHanwhaPasswordMeta();

    let lastUpdaterName: string | null = null;
    if (meta.updatedById) {
        const u = await prisma.user.findUnique({
            where: { id: meta.updatedById },
            select: { name: true },
        });
        lastUpdaterName = u?.name ?? null;
    }

    return (
        <div className="min-h-screen">
            <header className="bg-white border-b border-slate-200">
                <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
                    <Link href="/admin" className="flex items-center gap-2">
                        <Image src="/hanyanglogo.png" alt="logo" width={32} height={32} className="h-8 w-auto" />
                        <span className="font-bold text-slate-800">한양유화 e-Business OS</span>
                    </Link>
                    <div className="flex items-center gap-4 text-sm">
                        <span className="text-slate-600">
                            {session.user.name}{' '}
                            <span className="text-xs text-slate-400">({session.user.role})</span>
                        </span>
                        <form
                            action={async () => {
                                'use server';
                                await signOut({ redirectTo: '/login' });
                            }}
                        >
                            <button className="text-slate-500 hover:text-red-600 transition">로그아웃</button>
                        </form>
                    </div>
                </div>
            </header>

            <main className="max-w-3xl mx-auto p-6">
                <Link href="/admin/dispatch" className="text-sm text-slate-500 hover:text-slate-800">
                    ← 배차 조회로
                </Link>
                <h1 className="mt-2 text-2xl font-bold text-slate-800">한화 H-CRM 자격증명 관리</h1>
                <p className="mt-1 text-sm text-slate-500">
                    한화전산시스템(H-CRM)은 비밀번호가 주기적으로 변경됩니다. 변경 시 여기에 새 비밀번호를 입력하면
                    이후 배차 조회가 정상 작동합니다.
                </p>

                <HanwhaCredentialClient
                    username={username}
                    masked={meta.masked}
                    source={meta.source}
                    updatedAt={meta.updatedAt?.toISOString() ?? null}
                    updatedByName={lastUpdaterName}
                />
            </main>
        </div>
    );
}
