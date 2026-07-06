import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft } from 'lucide-react';
import OrderForm from '@/components/OrderForm';
import HomepageArchiveLink from '@/components/HomepageArchiveLink';

export default async function CustomerNewOrderPage() {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'customer') redirect('/admin/orders/new');
    if (!session.user.customerId) redirect('/login');

    return (
        <div className="min-h-screen">
            <header className="bg-white border-b border-slate-200">
                <div className="max-w-3xl mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Link href="/portal" className="flex items-center gap-2">
                            <Image src="/hanyanglogo.png" alt="logo" width={32} height={32} className="h-8 w-auto" />
                            <span className="font-bold text-slate-800">한양유화 거래처 포털</span>
                        </Link>
                        <HomepageArchiveLink />
                    </div>
                    <Link
                        href="/portal"
                        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
                    >
                        <ArrowLeft size={14} /> 돌아가기
                    </Link>
                </div>
            </header>

            <main className="max-w-3xl mx-auto p-6">
                <h1 className="text-2xl font-bold text-slate-800 mb-1">주문 등록</h1>
                <p className="text-sm text-slate-500 mb-6">
                    필수 항목(*)을 모두 입력하면 저장 버튼이 활성화됩니다.
                </p>

                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <OrderForm
                        mode="customer"
                        fixedCustomer={{
                            id: session.user.customerId,
                            name: session.user.customerName ?? '거래처',
                        }}
                    />
                </div>
            </main>
        </div>
    );
}
