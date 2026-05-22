import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { fmtDate, fmtNumber } from '@/lib/orders';
import { ArrowLeft, Truck } from 'lucide-react';

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

function driverText(dispatch: { vehicleNumber: string | null; driverName: string | null; driverPhone: string | null }) {
    return [dispatch.vehicleNumber, dispatch.driverName, dispatch.driverPhone].filter(Boolean).join(' · ') || '-';
}

export default async function PortalDispatchPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'customer') redirect('/admin');
    if (!session.user.customerId) redirect('/login');

    const sp = await searchParams;
    const today = isoDate(new Date());
    const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? '') ? sp.from! : today;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? '') ? sp.to! : today;
    const fromDate = new Date(`${from}T00:00:00`);
    const toDate = new Date(`${to}T00:00:00`);
    toDate.setDate(toDate.getDate() + 1);

    const dispatches = await prisma.dispatch.findMany({
        where: { plannedDispatchDate: { gte: fromDate, lt: toDate }, order: { customerId: session.user.customerId, deletedAt: null } },
        orderBy: [{ plannedDispatchDate: 'desc' }, { createdAt: 'desc' }],
        take: 100,
        include: {
            order: {
                select: {
                    id: true,
                    orderNo: true,
                    requestedDeliveryDate: true,
                    items: { include: { product: { select: { productName: true } } } },
                },
            },
        },
    });

    return (
        <main className="min-h-screen bg-slate-50 px-4 py-5 md:px-6">
            <div className="mx-auto max-w-3xl space-y-4">
                <Link href="/portal" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
                    <ArrowLeft size={14} /> 포털로
                </Link>
                <div className="flex items-center gap-2">
                    <Truck size={24} className="text-emerald-600" />
                    <h1 className="text-xl font-bold text-slate-800 md:text-2xl">배차조회</h1>
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

                {dispatches.length === 0 ? (
                    <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
                        아직 확인 가능한 배차내역이 없습니다.
                    </div>
                ) : (
                    <div className="space-y-3">
                        {dispatches.map((dispatch) => (
                            <Link key={dispatch.id} href={`/portal/orders/${dispatch.order.id}`} className="block rounded-3xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/40">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="font-mono text-xs text-slate-400">{dispatch.order.orderNo}</p>
                                        <p className="mt-1 truncate text-base font-bold text-slate-900">
                                            {dispatch.order.items.map((item) => item.product.productName).join(', ')}
                                        </p>
                                    </div>
                                    <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700">
                                        배차내역
                                    </span>
                                </div>
                                <dl className="mt-3 grid grid-cols-1 gap-2 text-sm">
                                    <div className="flex justify-between gap-3"><dt className="text-slate-500">도착일</dt><dd className="font-semibold text-slate-800">{fmtDate(dispatch.order.requestedDeliveryDate)}</dd></div>
                                    <div className="flex justify-between gap-3"><dt className="text-slate-500">배차일</dt><dd className="font-semibold text-slate-800">{fmtDate(dispatch.plannedDispatchDate)}</dd></div>
                                    <div className="flex justify-between gap-3"><dt className="text-slate-500">차량/기사</dt><dd className="text-right font-semibold text-slate-800">{driverText(dispatch)}</dd></div>
                                    {dispatch.hanwhaQuantityTon != null && (
                                        <div className="flex justify-between gap-3"><dt className="text-slate-500">수량</dt><dd className="font-semibold text-slate-800">{fmtNumber(dispatch.hanwhaQuantityTon)} TON</dd></div>
                                    )}
                                </dl>
                            </Link>
                        ))}
                    </div>
                )}
            </div>
        </main>
    );
}

function RangeButton({ label, range }: { label: string; range: { from: string; to: string } }) {
    return <Link href={`/portal/dispatch?from=${range.from}&to=${range.to}`} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600">{label}</Link>;
}
