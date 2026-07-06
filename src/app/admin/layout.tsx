import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth, signOut } from '@/lib/auth';
import InternalWorkspaceShell from './InternalWorkspaceShell';
import AdminNav from './AdminNav';
import MobileDrawerNav from './MobileDrawerNav';
import StaffViewModeToggle from './StaffViewModeToggle';
import { canViewAllStaffData, isYangHeeCheol } from '@/lib/staff-permissions';
import HomepageArchiveLink from '@/components/HomepageArchiveLink';

export default async function AdminLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal');
    const isHanwhaManager = session.user.role === 'EXECUTIVE' || session.user.role === 'ADMIN';
    const canViewAll = canViewAllStaffData(session.user);
    const canManageCreditLimits = isYangHeeCheol(session.user);

    return (
        <InternalWorkspaceShell
            storageKey={`hanyangpetro.internal-tabs.${session.user.id}`}
            rightSlot={(
                <div className="ml-2 flex shrink-0 items-center gap-2">
                    <span className="staff-mobile-toggle">
                        <StaffViewModeToggle short />
                    </span>
                    <HomepageArchiveLink />
                    <Link
                        href="/settings"
                        className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:border-orange-200 hover:text-orange-700"
                    >
                        비밀번호 변경
                    </Link>
                    <form action={async () => {
                        'use server';
                        await signOut({ redirectTo: '/login' });
                    }}>
                        <button className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-500 hover:border-red-200 hover:text-red-600">
                            로그아웃
                        </button>
                    </form>
                </div>
            )}
        >
            <div className="admin-shell-layout bg-[#fff7ed]">
                <div className="staff-mobile-view">
                    <MobileDrawerNav
                        isHanwhaManager={isHanwhaManager}
                        canManageCreditLimits={canManageCreditLimits}
                        canViewAllStaffData={canViewAll}
                    />
                </div>
                <aside
                    className="admin-shell-sidebar staff-desktop-view border-r border-orange-100 bg-orange-50 px-5 py-5"
                >
                    <AdminNav
                        isHanwhaManager={isHanwhaManager}
                        canManageCreditLimits={canManageCreditLimits}
                        canViewAllStaffData={canViewAll}
                    />
                </aside>
                <main className="admin-shell-main">
                    {children}
                </main>
            </div>
        </InternalWorkspaceShell>
    );
}
