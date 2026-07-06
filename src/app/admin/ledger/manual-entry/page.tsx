import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, PenLine } from 'lucide-react';
import { prisma } from '@/lib/db';
import ManualEntryForm from './ManualEntryForm';
import { getRecentManualEntries } from './actions';
import { canViewAllStaffData } from '@/lib/staff-permissions';

export const dynamic = 'force-dynamic';

export default async function ManualEntryPage() {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/admin');

    if (!canViewAllStaffData(session.user)) redirect('/admin');

    const [customers, suppliers, companyEntities, products, recentEntries] = await Promise.all([
        prisma.customer.findMany({
            where: { isActive: true },
            select: { id: true, companyName: true, customerCode: true },
            orderBy: { companyName: 'asc' },
        }),
        prisma.supplier.findMany({
            where: { isActive: true },
            select: { id: true, supplierName: true },
            orderBy: { supplierName: 'asc' },
        }),
        prisma.companyEntity.findMany({
            where: { isActive: true },
            select: { id: true, displayName: true, code: true },
            orderBy: { displayName: 'asc' },
        }),
        prisma.product.findMany({
            where: { isActive: true },
            select: { id: true, productName: true, productCode: true },
            orderBy: [{ productName: 'asc' }],
        }),
        getRecentManualEntries(),
    ]);

    // Date 직렬화
    const serializedEntries = recentEntries.map((e) => ({
        ...e,
        transactionDate: e.transactionDate,
        createdAt: e.createdAt,
    }));

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="bg-white border-b border-slate-200">
                <div className="max-w-5xl mx-auto px-6 h-14 flex items-center gap-3">
                    <Link href="/admin/ledger" className="flex items-center gap-1.5 text-slate-500 hover:text-slate-800 text-sm">
                        <ArrowLeft size={16} /> 원장 조회
                    </Link>
                    <span className="text-slate-300">/</span>
                    <span className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                        <PenLine size={16} className="text-orange-500" /> 수동 원장 입력
                    </span>
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-6 py-8">
                <div className="mb-6">
                    <h1 className="text-2xl font-black text-slate-900">수동 원장 입력</h1>
                    <p className="mt-1 text-sm text-slate-500">
                        오더를 거치지 않고 매출·매입 원장을 직접 입력합니다.
                        입력된 항목은 거래처원장·공급사원장·집계에 즉시 반영됩니다.
                    </p>
                    <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
                        <strong>💡 사용 예시 (대진화성산업 대여 처리):</strong>
                        <ol className="mt-1 ml-4 list-decimal space-y-0.5 text-xs">
                            <li>B 거래처에 <strong>매출 10TON</strong> 수동 입력 (메모: A→B 대여분)</li>
                            <li>대진화성산업 <strong>매입 10TON</strong> 수동 입력 (메모: A→B 대여 가상매입)</li>
                            <li>[나중에 갚을 때] 실제 매입매출 오더 정상 처리</li>
                            <li>대진화성산업 <strong>매입 −10TON</strong> 수동 입력으로 상계 완료</li>
                        </ol>
                    </div>
                </div>

                <ManualEntryForm
                    customers={customers}
                    suppliers={suppliers}
                    companyEntities={companyEntities}
                    products={products}
                    recentEntries={serializedEntries as any}
                />
            </main>
        </div>
    );
}
