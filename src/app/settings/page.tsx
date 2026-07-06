import { auth, signOut } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import ChangePasswordForm from './ChangePasswordForm';
import AdminResetSection from './AdminResetSection';
import HomepageArchiveLink from '@/components/HomepageArchiveLink';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
    const session = await auth();
    if (!session?.user) redirect('/login');

    const isAdmin = session.user.userKind === 'staff' && session.user.name === '양희철';
    const backHref = session.user.userKind === 'customer' ? '/portal' : '/admin';

    let staffList: { id: string; name: string; role: string }[] = [];
    let customerList: { id: string; name: string; companyName: string }[] = [];

    if (isAdmin) {
        staffList = await prisma.user.findMany({
            where: { isActive: true },
            select: { id: true, name: true, role: true },
            orderBy: { name: 'asc' },
        });
        const cuList = await prisma.customerUser.findMany({
            where: { isActive: true },
            select: { id: true, name: true, customer: { select: { companyName: true } } },
            orderBy: { name: 'asc' },
        });
        customerList = cuList.map((cu) => ({
            id: cu.id,
            name: cu.name,
            companyName: cu.customer.companyName,
        }));
    }

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="bg-white border-b border-slate-200">
                <div className="max-w-3xl mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Link href={backHref} className="flex items-center gap-2">
                            <Image src="/hanyanglogo.png" alt="logo" width={32} height={32} className="h-8 w-auto" />
                            <span className="font-bold text-slate-800">한양유화</span>
                        </Link>
                        <HomepageArchiveLink />
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                        <Link href={backHref} className="text-slate-500 hover:text-blue-600 transition">← 돌아가기</Link>
                        <form action={async () => { 'use server'; await signOut({ redirectTo: '/login' }); }}>
                            <button className="text-slate-500 hover:text-red-600 transition">로그아웃</button>
                        </form>
                    </div>
                </div>
            </header>

            <main className="max-w-3xl mx-auto p-6 space-y-8">
                <h1 className="text-2xl font-bold text-slate-800">설정</h1>

                {/* 내 비밀번호 변경 */}
                <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                    <h2 className="text-lg font-semibold text-slate-800 mb-4">내 비밀번호 변경</h2>
                    <ChangePasswordForm />
                </section>

                {/* 양희철 전용: 사용자 비밀번호 초기화 */}
                {isAdmin && (
                    <AdminResetSection staffList={staffList} customerList={customerList} />
                )}
            </main>
        </div>
    );
}
