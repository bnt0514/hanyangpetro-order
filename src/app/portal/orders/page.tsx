import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { fmtDate, fmtNumber, statusColor, statusLabel } from '@/lib/orders';
import { ArrowLeft, ClipboardList } from 'lucide-react';

export const dynamic = 'force-dynamic';

function isoDate(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function rangeShortcut(days: number) {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - (days - 1));
    return { from: isoDate(from), to: isoDate(to) };
}

export default async function PortalOrdersPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'customer') redirect('/admin');
    if (!session.user.customerId) redirect('/login');

    const sp = await searchParams;
    const today = isoDate(new Date());
    const defaultRange = rangeShortcut(93);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? '') ? sp.from! : defaultRange.from;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? '') ? sp.to! : defaultRange.to;
    const fromDate = new Date(`${from}T00:00:00`);
    const toDate = new Date(`${to}T00:00:00`);
    toDate.setDate(toDate.getDate() + 1);

    const orders = await prisma.order.findMany({
        where: { customerId: session.user.customerId, deletedAt: null, requestedDeliveryDate: { gte: fromDate, lt: toDate } },
        orderBy: [{ createdAt: 'desc' }],
        take: 100,
        include: {
            items: { include: { product: { select: { productName: true } } } },
            deliveryDateChangeRequests: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true } },
        },
    });

    return (
        <main className="min-h-screen bg-slate-50 px-4 py-5 md:px-6">
            <div className="mx-auto max-w-3xl space-y-4">
                <Link href="/portal" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
                    <ArrowLeft size={14} /> 포털로
                </Link>
                <div className="flex items-center gap-2">
                    <ClipboardList size={24} className="text-blue-600" />
                    <h1 className="text-xl font-bold text-slate-800 md:text-2xl">주문내역</h1>
                </div>

                <form className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="grid grid-cols-2 gap-2">
                        <input type="date" name="from" defaultValue={from} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                        <input type="date" name="to" defaultValue={to} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                        <RangeButton label="당일" range={{ from: today, to: today }} />
                        <RangeButton label="최근 1주일" range={rangeShortcut(7)} />
                        <RangeButton label="최근 1개월" range={rangeShortcut(31)} />
                        <RangeButton label="최근 3개월" range={rangeShortcut(93)} />
                        <button className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-bold text-white">조회</button>
                    </div>
                </form>

                {orders.length === 0 ? (
                    <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
                        아직 등록된 주문이 없습니다.
                    </div>
                ) : (
                    <div className="space-y-3">
                        {orders.map((order) => (
                            <Link key={order.id} href={`/portal/orders/${order.id}`} className="block rounded-3xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-200 hover:bg-blue-50/40">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-base font-bold text-slate-900">
                                            {order.items.map((item) => item.product?.productName ?? '제품 정보 없음').join(', ')}
                                        </p>
                                        <p className="mt-1 text-sm text-slate-500">
                                            {order.items.map((item) => `${fmtNumber(item.requestedQuantity)}${item.unit}`).join(' · ')}
                                        </p>
                                    </div>
                                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${statusColor(order.status)}`}>
                                        {statusLabel(order.status)}
                                    </span>
                                </div>
                                {order.deliveryDateChangeRequests[0] && (
                                    <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${order.deliveryDateChangeRequests[0].status === 'PENDING' ? 'bg-amber-100 text-amber-800' : order.deliveryDateChangeRequests[0].status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                        도착일 변경 {order.deliveryDateChangeRequests[0].status === 'PENDING' ? '요청중' : order.deliveryDateChangeRequests[0].status === 'APPROVED' ? '승인됨' : '반려됨'}
                                    </span>
                                )}
                                <div className="mt-3 flex items-center justify-between text-sm">
                                    <span className="text-slate-500">도착일</span>
                                    <span className="font-semibold text-slate-800">{fmtDate(order.requestedDeliveryDate)}</span>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </div>
        </main>
    );
}

function RangeButton({ label, range }: { label: string; range: { from: string; to: string } }) {
    return <Link href={`/portal/orders?from=${range.from}&to=${range.to}`} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600">{label}</Link>;
}
