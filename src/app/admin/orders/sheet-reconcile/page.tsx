import { redirect } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { auth, signOut } from '@/lib/auth';
import { getOrderSheetStaffUsers, isYangHeeCheol, todayIso } from '@/lib/order-sheet-reconcile';
import OrderSheetReconcileClient from './OrderSheetReconcileClient';
import HomepageArchiveLink from '@/components/HomepageArchiveLink';

export const dynamic = 'force-dynamic';

export default async function OrderSheetReconcilePage({
    searchParams,
}: {
    searchParams: Promise<{ date?: string; repId?: string }>;
}) {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal');

    const sp = await searchParams;
    const date = sp.date || todayIso();
    const canViewAll = isYangHeeCheol(session.user);
    const selectedRepId = canViewAll ? (sp.repId || 'all') : session.user.id;
    const staffUsers = canViewAll ? await getOrderSheetStaffUsers() : [];

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="border-b border-slate-200 bg-white">
                <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
                    <div className="flex items-center gap-2">
                        <Link href="/admin" className="flex items-center gap-2">
                            <Image src="/hanyanglogo.png" alt="logo" width={32} height={32} className="h-8 w-auto" />
                            <span className="font-bold text-slate-800">한양유화 BNT OS</span>
                        </Link>
                        <HomepageArchiveLink />
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                        <span className="text-slate-600">{session.user.name}</span>
                        <form
                            action={async () => {
                                'use server';
                                await signOut({ redirectTo: '/login' });
                            }}
                        >
                            <button className="text-slate-500 transition hover:text-red-600">로그아웃</button>
                        </form>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-7xl space-y-6 p-6 pb-16">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
                            <ArrowLeft size={16} /> 대시보드
                        </Link>
                        <h1 className="mt-2 text-2xl font-black text-slate-900">매입매출 오더 대조</h1>
                    </div>
                </div>

                <OrderSheetReconcileClient
                    defaultDate={date}
                    canViewAll={canViewAll}
                    initialRepId={selectedRepId}
                    staffUsers={staffUsers}
                />
            </main>
        </div>
    );
}
