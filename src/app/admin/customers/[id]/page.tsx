import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import CustomerEditor from './CustomerEditor';

export const dynamic = 'force-dynamic';

export default async function CustomerEditPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal');

    const { id } = await params;
    const customer = await prisma.customer.findUnique({
        where: { id },
        include: {
            addresses: {
                orderBy: [{ isDefault: 'desc' }, { isActive: 'desc' }, { label: 'asc' }],
            },
        },
    });

    if (!customer) notFound();

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="bg-white border-b border-slate-200">
                <div className="max-w-5xl mx-auto px-6 h-16 flex items-center">
                    <Link href="/admin/customers" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
                        <ArrowLeft size={14} /> 업체 목록
                    </Link>
                </div>
            </header>
            <main className="max-w-5xl mx-auto p-6">
                <CustomerEditor customer={customer} addresses={customer.addresses} />
            </main>
        </div>
    );
}