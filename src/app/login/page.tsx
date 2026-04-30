import LoginForm from './LoginForm';
import { prisma } from '@/lib/db';

export const metadata = {
    title: '로그인 · 한양유화 e-Business OS',
};

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
    const customers = await prisma.customer.findMany({
        where: { isActive: true },
        select: { companyName: true, customerCode: true },
        orderBy: { companyName: 'asc' },
    });

    const options = customers.map((c) => ({
        value: c.companyName,
        label: c.companyName,
        sublabel: c.customerCode,
    }));

    return (
        <main className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 flex items-center justify-center px-4 py-12">
            <LoginForm customers={options} />
        </main>
    );
}
