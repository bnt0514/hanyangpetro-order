import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { prisma } from '@/lib/db';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { OverrideRow } from './OverrideList';
import BackButton from '@/components/BackButton';
import HomepageArchiveLink from '@/components/HomepageArchiveLink';

export const dynamic = 'force-dynamic';

export default async function CreditOverridesPage() {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal');

    const isExecutive = session.user.role === 'EXECUTIVE';

    const overrides = await prisma.creditOverrideRequest.findMany({
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        include: {
            requestedBy: { select: { name: true } },
            order: { include: { customer: { select: { companyName: true } } } },
        },
    });

    const pending = overrides.filter((o) => o.status === 'PENDING');
    const done = overrides.filter((o) => o.status !== 'PENDING');

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="bg-white border-b border-slate-200">
                <div className="max-w-3xl mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Link href="/admin" className="flex items-center gap-2">
                            <Image src="/hanyanglogo.png" alt="logo" width={32} height={32} className="h-8 w-auto" />
                            <span className="font-bold text-slate-800">한양유화 e-Business OS</span>
                        </Link>
                        <HomepageArchiveLink />
                    </div>
                    <span className="text-sm text-slate-600">{session.user.name}</span>
                </div>
            </header>

            <main className="max-w-3xl mx-auto p-6 space-y-6">
                <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
                    <ArrowLeft size={14} /> 대시보드로
                </Link>

                <div className="flex items-center gap-3">
                    <ShieldAlert size={24} className="text-red-500" />
                    <h1 className="text-2xl font-bold text-slate-800">여신 한도초과 승인</h1>
                    {pending.length > 0 && (
                        <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full font-bold">
                            {pending.length}건 대기
                        </span>
                    )}
                </div>

                {!isExecutive && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
                        ⚠️ 한도초과 승인은 양희철 대표(EXECUTIVE)만 처리할 수 있습니다. 현재 조회만 가능합니다.
                    </div>
                )}

                {/* 대기 중 */}
                <section>
                    <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
                        승인 대기 ({pending.length}건)
                    </h2>
                    {pending.length === 0 ? (
                        <p className="text-slate-400 text-sm text-center py-8 bg-white rounded-2xl border border-slate-200">
                            대기 중인 요청이 없습니다 ✓
                        </p>
                    ) : (
                        <div className="space-y-3">
                            {pending.map((o) => (
                                <OverrideRow key={o.id} override={o} isExecutive={isExecutive} />
                            ))}
                        </div>
                    )}
                </section>

                {/* 처리 완료 */}
                {done.length > 0 && (
                    <section>
                        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
                            처리 완료 ({done.length}건)
                        </h2>
                        <div className="space-y-3">
                            {done.map((o) => (
                                <OverrideRow key={o.id} override={o} isExecutive={isExecutive} />
                            ))}
                        </div>
                    </section>
                )}
            </main>
        </div>
    );
}
