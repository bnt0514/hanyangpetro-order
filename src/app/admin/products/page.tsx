import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, PackagePlus } from 'lucide-react';
import { createProductAction } from './actions';
import ProductsListClient from './ProductsListClient';

export const dynamic = 'force-dynamic';

type Search = { tab?: string };

function Field({ name, defaultValue, placeholder, className = '' }: { name: string; defaultValue?: string | null; placeholder?: string; className?: string }) {
    return <input name={name} defaultValue={defaultValue ?? ''} placeholder={placeholder} className={`rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-blue-500 ${className}`} />;
}

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Search> }) {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal');

    const sp = await searchParams;
    const tab = sp.tab === 'new' ? 'new' : 'list';

    const products = await prisma.product.findMany({
        orderBy: [{ isActive: 'desc' }, { productName: 'asc' }],
        take: 500,
    });

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="border-b border-slate-200 bg-white">
                <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
                    <Link href="/admin" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
                        <ArrowLeft size={14} /> 대시보드
                    </Link>
                    <span className="text-sm font-semibold text-slate-700">품목 추가 및 수정</span>
                </div>
            </header>

            <main className="mx-auto max-w-7xl space-y-5 p-6">
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-800"><PackagePlus size={24} /> 품목 추가 및 수정</h1>
                        <p className="mt-1 text-sm text-slate-500">등록된 전체 품목을 수정·비활성화하고 새 품목을 추가합니다.</p>
                    </div>
                    <div className="flex rounded-xl border border-slate-200 bg-white p-1 text-sm font-semibold">
                        <Link href="/admin/products" className={`rounded-lg px-4 py-2 ${tab === 'list' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>전체 품목/수정</Link>
                        <Link href="/admin/products?tab=new" className={`rounded-lg px-4 py-2 ${tab === 'new' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>신규 품목 추가</Link>
                    </div>
                </div>

                {tab === 'new' ? (
                    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                        <p className="mb-3 text-xs text-slate-500">품목명만 입력하면 품목코드(ITEM-N)는 자동으로 부여됩니다.</p>
                        <form action={createProductAction} className="flex gap-2">
                            <Field name="productName" placeholder="품목명 *" className="flex-1 text-sm" />
                            <button className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 whitespace-nowrap">신규 품목 저장</button>
                        </form>
                    </section>
                ) : (
                    <ProductsListClient products={products} />
                )}
            </main>
        </div>
    );
}