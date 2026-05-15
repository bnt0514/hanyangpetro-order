import { auth, signOut } from '@/lib/auth';
import { redirect, notFound } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import HanwhaDispatchDetails, { type HanwhaDispatchDetailRow } from '@/components/HanwhaDispatchDetails';
import { hanwhaDriverInfo, joinHanwhaDriverInfo, parseHanwhaMaterialFromMemo } from '@/lib/hanwha-dispatch';
import { statusLabel, statusColor, fmtDate, fmtDateTime, fmtNumber } from '@/lib/orders';
import { ArrowLeft, Building2, MapPin, Calendar, FileText, Clock } from 'lucide-react';
import StatusActions from './StatusActions';
import DeleteOrderButton from './DeleteOrderButton';
import StaffStatusOverride from './StaffStatusOverride';
import ItemQuantityEditor from './ItemQuantityEditor';
import DeliveryDateEditor from './DeliveryDateEditor';
import CreditSimulationPanel from '@/app/admin/credit/CreditSimulationPanel';
import BackButton from '@/components/BackButton';

export const dynamic = 'force-dynamic';

export default async function AdminOrderDetail({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal');

    const order = await prisma.order.findUnique({
        where: { id },
        include: {
            customer: true,
            deliveryAddress: true,
            items: { include: { product: true } },
            requestedByUser: { select: { name: true, role: true } },
            requestedByCustomerUser: { select: { name: true } },
            statusHistory: {
                orderBy: { createdAt: 'asc' },
                include: { changedByUser: { select: { name: true } } },
            },
        },
    });

    if (!order) notFound();

    const products = await prisma.product.findMany({
        where: { isActive: true },
        select: { id: true, productName: true, productCode: true },
        orderBy: { productName: 'asc' },
    });

    const hanwhaRows = await prisma.hanwhaDispatchRow.findMany({
        where: { matchedOrderId: order.id },
        orderBy: [{ createdAt: 'asc' }],
    });
    const hanwhaDispatches = hanwhaRows.length === 0
        ? await prisma.dispatch.findMany({
            where: { orderId: order.id, carrierName: '한화 H-CRM' },
            orderBy: [{ createdAt: 'asc' }],
        })
        : [];
    const dispatchDetails: HanwhaDispatchDetailRow[] = hanwhaRows.length > 0
        ? hanwhaRows.map((row) => ({
            id: row.id,
            materialNameRaw: row.materialNameRaw,
            materialName: row.materialName,
            quantityTon: row.quantityKg,
            driverInfo: hanwhaDriverInfo(row.rawCells),
        }))
        : hanwhaDispatches.map((dispatch) => ({
            id: dispatch.id,
            materialNameRaw: dispatch.hanwhaMaterialNameRaw ?? parseHanwhaMaterialFromMemo(dispatch.memo),
            materialName: dispatch.hanwhaMaterialName ?? parseHanwhaMaterialFromMemo(dispatch.memo),
            quantityTon: dispatch.hanwhaQuantityTon,
            driverInfo: joinHanwhaDriverInfo(dispatch.vehicleNumber, dispatch.driverName, dispatch.driverPhone),
        }));
    const orderQuantityTon = order.items.reduce((sum, item) => sum + item.requestedQuantity, 0);
    const canStartHanwhaOrder = session.user.name === '양희철';
    const requestedDeliveryDateValue = order.requestedDeliveryDate?.toISOString().slice(0, 10)
        ?? new Date().toISOString().slice(0, 10);

    return (
        <div className="min-h-screen">
            <header className="bg-white border-b border-slate-200">
                <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
                    <Link href="/admin" className="flex items-center gap-2">
                        <Image src="/hanyanglogo.png" alt="logo" width={32} height={32} className="h-8 w-auto" />
                        <span className="font-bold text-slate-800">한양유화 e-Business OS</span>
                    </Link>
                    <div className="flex items-center gap-4 text-sm">
                        <span className="text-slate-600">
                            {session.user.name}{' '}
                            <span className="text-xs text-slate-400">({session.user.role})</span>
                        </span>
                        <form
                            action={async () => {
                                'use server';
                                await signOut({ redirectTo: '/login' });
                            }}
                        >
                            <button className="text-slate-500 hover:text-red-600 transition">로그아웃</button>
                        </form>
                    </div>
                </div>
            </header>

            <main className="max-w-5xl mx-auto p-6 space-y-6">
                <Link
                    href="/admin"
                    className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
                >
                    <ArrowLeft size={14} /> 대시보드로
                </Link>

                {/* 헤더 카드 */}
                <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div>
                            <p className="text-xs text-slate-400 font-mono">{order.orderNo}</p>
                            <h1 className="mt-1 text-2xl font-bold text-slate-800">
                                {order.customer.companyName}
                            </h1>
                            <p className="mt-1 text-sm text-slate-500">
                                등록 {fmtDateTime(order.createdAt)} ·{' '}
                                {order.requestedByUser?.name ??
                                    order.requestedByCustomerUser?.name ??
                                    '-'}{' '}
                                접수
                            </p>
                        </div>
                        <span
                            className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${statusColor(order.status)}`}
                        >
                            {statusLabel(order.status)}
                        </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6 text-sm">
                        <Info icon={<Building2 size={14} />} label="거래처">
                            <span className="font-medium">{order.customer.companyName}</span>
                            <span className="block text-xs text-slate-400 font-mono">
                                {order.customer.customerCode}
                            </span>
                        </Info>
                        <Info icon={<MapPin size={14} />} label="도착지">
                            <span className="font-medium">{order.deliveryAddress.label}</span>
                            <span className="block text-xs text-slate-500">
                                {order.deliveryAddress.addressLine1}
                            </span>
                        </Info>
                        <Info icon={<Calendar size={14} />} label="요청 도착일">
                            <div className="space-y-1">
                                <span className="block text-xs text-slate-500">현재 {fmtDate(order.requestedDeliveryDate)}</span>
                                <DeliveryDateEditor orderId={order.id} currentDate={requestedDeliveryDateValue} />
                            </div>
                        </Info>
                        {order.memo && (
                            <Info icon={<FileText size={14} />} label="메모">
                                <span className="whitespace-pre-wrap">{order.memo}</span>
                            </Info>
                        )}
                    </div>
                </section>

                <HanwhaDispatchDetails rows={dispatchDetails} orderQuantityTon={orderQuantityTon} showDeleteAction />

                {/* 품목 */}
                <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100">
                        <h2 className="font-semibold text-slate-800">주문 품목</h2>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase">
                                    <th className="px-6 py-3">제품명</th>
                                    <th className="px-6 py-3">제품코드</th>
                                    <th className="px-6 py-3 text-right">요청수량</th>
                                    <th className="px-6 py-3 text-right">승인수량</th>
                                    <th className="px-6 py-3 text-right">출고수량</th>
                                    <th className="px-6 py-3 text-right">수량 수정</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {order.items.map((it) => (
                                    <tr key={it.id}>
                                        <td className="px-6 py-3 font-medium text-slate-800">
                                            {it.product.productName}
                                        </td>
                                        <td className="px-6 py-3 text-xs font-mono text-slate-500">
                                            {it.product.productCode}
                                        </td>
                                        <td className="px-6 py-3 text-right text-slate-700">
                                            {fmtNumber(it.requestedQuantity)} {it.unit}
                                        </td>
                                        <td className="px-6 py-3 text-right text-slate-500">
                                            {it.approvedQuantity != null
                                                ? `${fmtNumber(it.approvedQuantity)} ${it.unit}`
                                                : '-'}
                                        </td>
                                        <td className="px-6 py-3 text-right text-slate-500">
                                            {it.shippedQuantity != null
                                                ? `${fmtNumber(it.shippedQuantity)} ${it.unit}`
                                                : '-'}
                                        </td>
                                        <td className="px-6 py-3 text-right">
                                            <ItemQuantityEditor
                                                itemId={it.id}
                                                currentProductId={it.productId}
                                                currentQuantity={it.requestedQuantity}
                                                unit={it.unit}
                                                products={products}
                                            />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>

                {/* 여신 시뮬레이션 (수락 전 필수 확인) */}
                {['REQUESTED', 'PENDING_SALES_REVIEW', 'ON_HOLD'].includes(order.status) && (
                    <CreditSimulationPanel orderId={order.id} />
                )}

                {/* 액션 */}
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex-1">
                        <StatusActions
                            orderId={order.id}
                            currentStatus={order.status}
                            canStartHanwhaOrder={canStartHanwhaOrder}
                        />
                    </div>
                    <DeleteOrderButton orderId={order.id} />
                </div>

                {/* 이력 */}
                <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2">
                            <Clock size={16} className="text-slate-500" />
                            <h2 className="font-semibold text-slate-800">상태 이력</h2>
                        </div>
                        <StaffStatusOverride orderId={order.id} currentStatus={order.status} />
                    </div>
                    <ul className="divide-y divide-slate-100">
                        {order.statusHistory.map((h) => (
                            <li key={h.id} className="px-6 py-3 flex items-center gap-3 text-sm">
                                <span className="text-xs text-slate-400 w-32 shrink-0 font-mono">
                                    {fmtDateTime(h.createdAt)}
                                </span>
                                <span
                                    className={`inline-flex rounded-full px-2 py-0.5 text-xs ${statusColor(h.newStatus)}`}
                                >
                                    {statusLabel(h.newStatus)}
                                </span>
                                <span className="text-xs text-slate-400 ml-auto">
                                    {h.changedByUser?.name ?? '-'}
                                    {h.changeReason && (
                                        <span className="ml-2 text-slate-500">
                                            · {h.changeReason}
                                        </span>
                                    )}
                                </span>
                            </li>
                        ))}
                    </ul>
                </section>
            </main>
            <BackButton />
        </div>
    );
}

function Info({
    icon,
    label,
    children,
}: {
    icon: React.ReactNode;
    label: string;
    children: React.ReactNode;
}) {
    return (
        <div>
            <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">
                {icon} {label}
            </p>
            <div className="text-slate-700">{children}</div>
        </div>
    );
}
