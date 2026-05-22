import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { prisma } from '@/lib/db';
import { ArrowLeft, TrendingUp } from 'lucide-react';
import PriceAdjustmentClient from './PriceAdjustmentClient';
import BackButton from '@/components/BackButton';
import BasePriceSection from './BasePriceSection';
import BulkCustomerPriceSection from './BulkCustomerPriceSection';

export const dynamic = 'force-dynamic';

export default async function PricesPage({
    searchParams,
}: {
    searchParams: Promise<{ month?: string; tab?: string }>;
}) {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal');
    if (!['EXECUTIVE', 'ADMIN'].includes(session.user.role ?? '')) {
        redirect('/admin?error=forbidden');
    }

    const sp = await searchParams;
    const currentMonth = sp.month ?? new Date().toISOString().slice(0, 7);
    const tab = sp.tab === 'edit' ? 'edit' : 'monthly';

    const [adjustments, products, customers, users, customerProductPrices] = await Promise.all([
        prisma.priceAdjustment.findMany({
            where: { effectiveMonth: currentMonth },
            select: { brand: true, productGroup: true, delta: true },
        }),
        prisma.product.findMany({
            where: { isActive: true },
            include: { productPrice: true },
            orderBy: [{ category: 'asc' }, { manufacturer: 'asc' }, { productName: 'asc' }],
        }),
        prisma.customer.findMany({
            where: { isActive: true },
            select: {
                id: true,
                customerCode: true,
                companyName: true,
                defaultSalesRepId: true,
                defaultSalesRep: { select: { name: true } },
            },
            orderBy: { companyName: 'asc' },
        }),
        prisma.user.findMany({
            where: { isActive: true },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
        }),
        prisma.customerProductPrice.findMany({
            where: { companyEntityId: null },
            select: { customerId: true, productId: true, priceType: true, unitPrice: true, lastUsedAt: true },
            orderBy: { lastUsedAt: 'desc' },
            take: 5000,
        }),
    ]);

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="bg-white border-b border-slate-200">
                <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
                    <Link href="/admin" className="flex items-center gap-2">
                        <Image src="/hanyanglogo.png" alt="logo" width={32} height={32} className="h-8 w-auto" />
                        <span className="font-bold text-slate-800">한양유화 e-Business OS</span>
                    </Link>
                    <span className="text-sm text-slate-600">{session.user.name} ({session.user.role})</span>
                </div>
            </header>

            <main className="max-w-5xl mx-auto p-6 space-y-8">
                <div className="flex items-center gap-3">
                    <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
                        <ArrowLeft size={14} /> 대시보드로
                    </Link>
                </div>

                <div className="flex items-center gap-3">
                    <TrendingUp size={24} className="text-blue-600" />
                    <h1 className="text-2xl font-bold text-slate-800">단가 관리</h1>
                </div>

                <div className="flex rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
                    <Link
                        href={`/admin/prices?tab=monthly&month=${currentMonth}`}
                        className={`flex-1 rounded-xl px-4 py-2.5 text-center text-sm font-semibold transition ${tab === 'monthly' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                    >
                        월별단가조정
                    </Link>
                    <Link
                        href={`/admin/prices?tab=edit&month=${currentMonth}`}
                        className={`flex-1 rounded-xl px-4 py-2.5 text-center text-sm font-semibold transition ${tab === 'edit' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                    >
                        단가 수정
                    </Link>
                </div>

                {tab === 'monthly' ? (
                    <>
                        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
                            <div className="flex items-center justify-between flex-wrap gap-3">
                                <h2 className="text-lg font-semibold text-slate-800">월별 단가 조정</h2>
                                <form className="flex items-center gap-2">
                                    <input type="hidden" name="tab" value="monthly" />
                                    <label className="text-sm text-slate-600">기준 월:</label>
                                    <input
                                        type="month"
                                        name="month"
                                        defaultValue={currentMonth}
                                        className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                                    />
                                    <button
                                        type="submit"
                                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm rounded-lg"
                                    >
                                        이동
                                    </button>
                                </form>
                            </div>
                            <p className="text-xs text-slate-500">
                                {currentMonth} 기준 브랜드별 · 제품군별 인상/인하액을 입력합니다. (원/TON)
                            </p>
                            <PriceAdjustmentClient
                                month={currentMonth}
                                initial={adjustments}
                            />
                        </section>

                        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
                            <h2 className="text-lg font-semibold text-slate-800">제품별 기준 단가</h2>
                            <p className="text-xs text-slate-500">
                                기준가 + 해당 월까지 누적 조정액 = 실효 단가. 여신 시뮬레이션에 사용됩니다.
                            </p>
                            <BasePriceSection products={products} />
                        </section>
                    </>
                ) : (
                    <BulkCustomerPriceSection
                        customers={customers}
                        products={products.map((product) => ({
                            id: product.id,
                            productCode: product.productCode,
                            productName: product.productName,
                            manufacturer: product.manufacturer,
                            category: product.category,
                        }))}
                        users={users}
                        prices={customerProductPrices}
                    />
                )}
            </main>

        </div>
    );
}
