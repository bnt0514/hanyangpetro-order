import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft } from 'lucide-react';
import { prisma } from '@/lib/db';
import OrderForm from '@/components/OrderForm';
import BackButton from '@/components/BackButton';

export default async function StaffNewOrderPage() {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal/orders/new');

    const customers = await prisma.customer.findMany({
        where: { isActive: true },
        select: { id: true, companyName: true, customerCode: true },
        orderBy: { companyName: 'asc' },
    });

    const deliveryAddresses = await prisma.deliveryAddress.findMany({
        where: { isActive: true, customer: { isActive: true } },
        select: {
            id: true,
            label: true,
            addressLine1: true,
            addressLine2: true,
            contactPhone: true,
            isDefault: true,
            customerId: true,
            customer: { select: { companyName: true, customerCode: true } },
        },
        orderBy: [{ customer: { companyName: 'asc' } }, { isDefault: 'desc' }, { label: 'asc' }],
    });

    const customerOptions = customers.map((c) => ({
        value: c.id,
        label: c.companyName,
        sublabel: c.customerCode,
    }));

    const addressOptions = deliveryAddresses.map((address) => ({
        value: address.id,
        label: address.label,
        sublabel: `${address.customer.companyName} · ${address.addressLine1}`,
        customerId: address.customerId,
        customerName: address.customer.companyName,
        customerCode: address.customer.customerCode,
        addressLine1: address.addressLine1,
        addressLine2: address.addressLine2,
        contactPhone: address.contactPhone,
        isDefault: address.isDefault,
    }));

    const customersWithAddress = new Set(deliveryAddresses.map((address) => address.customerId));
    const autoAddressOptions = customers
        .filter((customer) => !customersWithAddress.has(customer.id))
        .map((customer) => ({
            value: `__auto_address__:${customer.id}`,
            label: customer.companyName,
            sublabel: `${customer.customerCode} · 도착지 자동 생성`,
            customerId: customer.id,
            customerName: customer.companyName,
            customerCode: customer.customerCode,
        }));

    const allAddressOptions = [...addressOptions, ...autoAddressOptions];

    const isYangHuiCheol = session.user.name === '양희철';
    const hanyangEntity = await prisma.companyEntity.findFirst({
        where: {
            isActive: true,
            OR: [
                { code: 'HANYANG_PETRO' },
                { displayName: '한양유화' },
                { legalName: { contains: '한양유화' } },
            ],
        },
        select: { id: true },
    });
    const defaultEntityId = hanyangEntity?.id ?? null;

    return (
        <div className="min-h-screen">
            <header className="bg-white border-b border-slate-200">
                <div className="max-w-3xl mx-auto px-6 h-16 flex items-center justify-between">
                    <Link href="/admin" className="flex items-center gap-2">
                        <Image src="/hanyanglogo.png" alt="logo" width={32} height={32} className="h-8 w-auto" />
                        <span className="font-bold text-slate-800">한양유화 e-Business OS</span>
                    </Link>
                    <Link
                        href="/admin"
                        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
                    >
                        <ArrowLeft size={14} /> 대시보드
                    </Link>
                </div>
            </header>

            <main className="max-w-3xl mx-auto p-6">
                <h1 className="text-2xl font-bold text-slate-800 mb-1">신규 주문 등록</h1>
                <p className="text-sm text-slate-500 mb-6">
                    거래처 또는 도착지를 입력하면 연결된 도착지·제품 목록이 자동으로 로드됩니다.
                </p>

                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <OrderForm mode="staff" customerOptions={customerOptions} allAddressOptions={allAddressOptions} isYangHuiCheol={isYangHuiCheol} defaultSalesEntityId={defaultEntityId} defaultPurchaseEntityId={defaultEntityId} />
                </div>
            </main>

        </div>
    );
}
