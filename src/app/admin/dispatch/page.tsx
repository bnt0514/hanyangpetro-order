import { auth, signOut } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { canManageHanwhaCredentials } from '@/lib/hanwha-credentials';
import { matchProductToMaterial } from '@/lib/product-matching';
import DispatchClient from './DispatchClient';
import HomepageArchiveLink from '@/components/HomepageArchiveLink';

export const dynamic = 'force-dynamic';

export default async function AdminDispatchPage({
    searchParams,
}: {
    searchParams: Promise<{ date?: string }>;
}) {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal');

    const sp = await searchParams;
    const today = new Date();
    const defaultDate =
        sp.date ??
        `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // 캐시된 스냅샷 (있을 경우 표시)
    const dispatchDate = new Date(defaultDate + 'T00:00:00');
    const snapshot = await prisma.hanwhaDispatchSnapshot.findUnique({
        where: { dispatchDate },
        include: {
            rows: { orderBy: [{ indoChiIndex: 'asc' }, { id: 'asc' }] },
        },
    });

    const dispatchWaitingOrders = await prisma.order.findMany({
        where: { status: { in: ['APPROVED', 'DISPATCH_WAITING', 'DISPATCH_COMPLETED'] }, deletedAt: null },
        orderBy: [{ requestedDeliveryDate: 'asc' }, { createdAt: 'desc' }],
        include: {
            customer: { select: { companyName: true, customerCode: true } },
            deliveryAddress: { select: { label: true, addressLine1: true, addressLine2: true } },
            items: { include: { product: { select: { productName: true, productCode: true } } } },
            dispatches: {
                where: { carrierName: '한화 H-CRM' },
                select: {
                    hanwhaMaterialName: true,
                    hanwhaMaterialNameRaw: true,
                    hanwhaQuantityTon: true,
                },
            },
        },
    });

    const initial = snapshot
        ? {
            fetchedAt: snapshot.fetchedAt.toISOString(),
            status: snapshot.status,
            errorMessage: snapshot.errorMessage,
            rowCount: snapshot.rowCount,
            rows: snapshot.rows.map((r) => ({
                id: r.id,
                indoChiIndex: r.indoChiIndex,
                indoChiName: r.indoChiName,
                materialName: r.materialName,
                materialNameRaw: r.materialNameRaw,
                quantityKg: r.quantityKg,
                rawCells: JSON.parse(r.rawCells) as string[],
                matchedOrderId: r.matchedOrderId,
                matchedAt: r.matchedAt?.toISOString() ?? null,
            })),
        }
        : null;

    const matchCandidates = dispatchWaitingOrders.map((o) => ({
        id: o.id,
        orderNo: o.orderNo,
        customerName: o.customer.companyName,
        customerCode: o.customer.customerCode,
        addressLabel: o.deliveryAddress.label,
        addressLine1: o.deliveryAddress.addressLine1,
        addressLine2: o.deliveryAddress.addressLine2,
        requestedDeliveryDate: o.requestedDeliveryDate?.toISOString() ?? null,
        itemSummary: o.items
            .map((it) => `${it.product.productName} ${it.requestedQuantity}${it.unit}`)
            .join(', '),
        items: o.items.map((it) => {
            const dispatchedQuantityTon = o.dispatches.reduce((sum, dispatch) => {
                const matched = matchProductToMaterial(
                    { productName: it.product.productName, productCode: it.product.productCode },
                    { materialName: dispatch.hanwhaMaterialName, materialNameRaw: dispatch.hanwhaMaterialNameRaw },
                );
                return matched.matches ? sum + (dispatch.hanwhaQuantityTon ?? 0) : sum;
            }, 0);
            return {
                productId: it.productId,
                productName: it.product.productName,
                productCode: it.product.productCode,
                quantityTon: it.requestedQuantity,
                dispatchedQuantityTon,
                remainingQuantityTon: Math.max(0, it.requestedQuantity - dispatchedQuantityTon),
            };
        }),
    }));

    return (
        <div className="min-h-screen">
            <header className="bg-white border-b border-slate-200">
                <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Link href="/admin" className="flex items-center gap-2">
                            <Image src="/hanyanglogo.png" alt="logo" width={32} height={32} className="h-8 w-auto" />
                            <span className="font-bold text-slate-800">한양유화 e-Business OS</span>
                        </Link>
                        <HomepageArchiveLink />
                    </div>
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

            <main className="max-w-7xl mx-auto p-6 pb-28">
                <Link href="/admin" className="text-sm text-slate-500 hover:text-slate-800">
                    ← 대시보드로
                </Link>
                <h1 className="mt-2 text-2xl font-bold text-slate-800">한화 배차 조회</h1>
                <p className="mt-1 text-sm text-slate-500">
                    한화전산시스템(H-CRM) 주문진척현황을 자동으로 가져와 저장합니다.
                    같은 날짜는 한 번만 조회되며, 이후에는 저장된 데이터를 즉시 표시합니다.
                </p>

                <DispatchClient
                    defaultDate={defaultDate}
                    initial={initial}
                    canManageCredentials={canManageHanwhaCredentials(session.user.role)}
                    matchCandidates={matchCandidates}
                />
            </main>
        </div>
    );
}
