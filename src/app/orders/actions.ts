'use server';

import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { OrderStatus } from '@/shared/enums';
import { openHanwhaNewOrder } from '@/lib/hanwha-new-order';
import { getHanwhaPassword, getHanwhaUsername } from '@/lib/hanwha-credentials';

export type OrderItemInput = { productId: string; quantity: number };
export type CreateOrderInput = {
    customerId: string;          // 거래처 (customer 로그인 시 자동, staff는 폼에서)
    deliveryAddressId: string;
    /** deliveryAddressId가 비어있을 때 자동 생성할 도착지명 */
    deliveryAddressName?: string;
    orderDate: string;           // YYYY-MM-DD
    deliveryDate: string;        // YYYY-MM-DD
    items: OrderItemInput[];
    memo?: string;
    allowDuplicate?: boolean;
};

export type CreateOrderResult =
    | { ok: true; orderId: string; orderNo: string }
    | { ok: false; error: string; duplicate: true; duplicateOrderNos: string[] }
    | { ok: false; error: string };

function buildOrderNoPrefix(orderDate: string) {
    const date = new Date(orderDate + 'T00:00:00');
    const yymmdd =
        String(date.getFullYear()).slice(2) +
        String(date.getMonth() + 1).padStart(2, '0') +
        String(date.getDate()).padStart(2, '0');
    return `HY-${yymmdd}-`;
}

async function getNextOrderNo(tx: Prisma.TransactionClient, orderDate: string) {
    const prefix = buildOrderNoPrefix(orderDate);
    const lastOrder = await tx.order.findFirst({
        where: { orderNo: { startsWith: prefix } },
        select: { orderNo: true },
        orderBy: { orderNo: 'desc' },
    });
    const lastSeq = lastOrder?.orderNo.match(/-(\d{4})$/)?.[1];
    const nextSeq = lastSeq ? Number(lastSeq) + 1 : 1;
    return `${prefix}${String(nextSeq).padStart(4, '0')}`;
}

/**
 * 주문 생성 (거래처/직원 공통)
 * - 거래처 로그인: customerId가 본인과 일치해야 함
 * - 직원 로그인: 어떤 거래처든 가능
 * - 모든 필수값 검증
 */
export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };

    // ── 입력 검증 ───────────────────────────────────────────────
    if (!input.customerId) return { ok: false, error: '거래처를 선택해주세요.' };
    if (!input.deliveryAddressId && !input.deliveryAddressName?.trim())
        return { ok: false, error: '도착지를 선택해주세요.' };
    if (!input.orderDate) return { ok: false, error: '주문일자를 입력해주세요.' };
    if (!input.deliveryDate) return { ok: false, error: '도착일자를 입력해주세요.' };
    if (!input.items || input.items.length === 0)
        return { ok: false, error: '제품을 1개 이상 선택해주세요.' };

    for (const it of input.items) {
        if (!it.productId) return { ok: false, error: '모든 제품을 선택해주세요.' };
        if (!Number.isFinite(it.quantity) || it.quantity <= 0)
            return { ok: false, error: '모든 제품의 수량을 입력해주세요.' };
    }

    // ── 권한 검증 ───────────────────────────────────────────────
    if (session.user.userKind === 'customer') {
        if (session.user.customerId !== input.customerId) {
            return { ok: false, error: '본인 거래처의 주문만 생성할 수 있습니다.' };
        }
    }

    // ── 도착지 검증: ID가 있으면 기존 도착지 검증, 없으면 주문 생성 시 자동 생성 ──
    let resolvedAddressId = input.deliveryAddressId;
    const deliveryAddressName = input.deliveryAddressName?.trim();
    if (resolvedAddressId) {
        // ── 도착지 검증 ─────────────────────────────────────────────
        const addr = await prisma.deliveryAddress.findUnique({
            where: { id: resolvedAddressId },
            select: { id: true, customerId: true, isActive: true },
        });
        if (!addr || addr.customerId !== input.customerId || !addr.isActive) {
            return { ok: false, error: '도착지가 거래처와 일치하지 않습니다.' };
        }
    }

    if (!input.allowDuplicate) {
        const deliveryDate = new Date(input.deliveryDate + 'T00:00:00');
        const nextDeliveryDate = new Date(deliveryDate);
        nextDeliveryDate.setDate(nextDeliveryDate.getDate() + 1);
        const productIds = Array.from(new Set(input.items.map((it) => it.productId)));
        const existingOrders = await prisma.order.findMany({
            where: {
                customerId: input.customerId,
                requestedDeliveryDate: { gte: deliveryDate, lt: nextDeliveryDate },
                deletedAt: null,
                status: { notIn: ['CANCELLED', 'REJECTED'] },
                items: { some: { productId: { in: productIds } } },
            },
            select: {
                orderNo: true,
                items: {
                    select: {
                        productId: true,
                        requestedQuantity: true,
                        product: { select: { productName: true, productCode: true } },
                    },
                },
            },
        });

        const duplicateOrderNos = existingOrders
            .filter((order) => order.items.some((existingItem) => input.items.some(
                (newItem) => existingItem.productId === newItem.productId && Math.abs(existingItem.requestedQuantity - newItem.quantity) < 0.0001,
            )))
            .map((order) => order.orderNo);

        if (duplicateOrderNos.length > 0) {
            return {
                ok: false,
                duplicate: true,
                duplicateOrderNos,
                error: `동일 도착일로 동품목, 동수량 기오더가 존재합니다. (${duplicateOrderNos.join(', ')}) 그래도 추가 오더로 저장하시겠습니까?`,
            };
        }
    }

    // ── 트랜잭션으로 주문 생성 ──────────────────────────────────
    try {
        const order = await prisma.$transaction(async (tx) => {
            if (!resolvedAddressId) {
                const newAddr = await tx.deliveryAddress.create({
                    data: {
                        customerId: input.customerId,
                        label: deliveryAddressName!,
                        addressLine1: deliveryAddressName!,
                        isDefault: false,
                        isActive: true,
                        memo: '주문 등록 시 자동 생성',
                    },
                });
                resolvedAddressId = newAddr.id;
            }

            const orderNo = await getNextOrderNo(tx, input.orderDate);
            const created = await tx.order.create({
                data: {
                    orderNo,
                    customerId: input.customerId,
                    deliveryAddressId: resolvedAddressId,
                    requestedByUserId:
                        session.user.userKind === 'staff' ? session.user.id : undefined,
                    requestedByCustomerUserId:
                        session.user.userKind === 'customer' ? session.user.id : undefined,
                    orderSource:
                        session.user.userKind === 'customer' ? 'CUSTOMER_PORTAL' : 'SALES_MANUAL',
                    status: 'REQUESTED',
                    requestedDeliveryDate: new Date(input.deliveryDate + 'T00:00:00'),
                    memo: input.memo,
                    items: {
                        create: input.items.map((it) => ({
                            productId: it.productId,
                            requestedQuantity: it.quantity,
                            unit: 'TON',
                        })),
                    },
                    statusHistory: {
                        create: {
                            previousStatus: null,
                            newStatus: 'REQUESTED',
                            changedByUserId:
                                session.user.userKind === 'staff' ? session.user.id : undefined,
                            changeReason: '주문 등록',
                        },
                    },
                },
            });
            return created;
        });

        // 화이트리스트 자동 추가 (거래처별 자주 주문하는 제품 학습)
        for (const it of input.items) {
            await prisma.customerProductWhitelist.upsert({
                where: {
                    customerId_productId: {
                        customerId: input.customerId,
                        productId: it.productId,
                    },
                },
                update: {
                    lastOrderedAt: new Date(),
                    totalOrderCount: { increment: 1 },
                },
                create: {
                    customerId: input.customerId,
                    productId: it.productId,
                    firstOrderedAt: new Date(),
                    lastOrderedAt: new Date(),
                    totalOrderCount: 1,
                    isVisibleInPortal: true,
                },
            });
        }

        revalidatePath('/admin');
        revalidatePath('/portal');

        return { ok: true, orderId: order.id, orderNo: order.orderNo };
    } catch (e) {
        console.error('createOrder failed:', e);
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            return { ok: false, error: '주문번호가 중복되었습니다. 다시 한 번 저장해 주세요.' };
        }
        return { ok: false, error: '주문 저장 중 오류가 발생했습니다.' };
    }
}

// ─────────────────────────────────────────────────────────────
// 주문 상태 변경 (직원 전용): 승인 / 보류 / 반려 / 취소
// ─────────────────────────────────────────────────────────────
export type ChangeStatusResult = { ok: true } | { ok: false; error: string };

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
    REQUESTED: ['APPROVED', 'ON_HOLD', 'REJECTED', 'PENDING_SALES_REVIEW'],
    PENDING_SALES_REVIEW: ['APPROVED', 'ON_HOLD', 'REJECTED'],
    ON_HOLD: ['APPROVED', 'REJECTED', 'REQUESTED'],
    APPROVED: ['DISPATCH_WAITING', 'CANCELLED'],
};

export async function changeOrderStatus(
    orderId: string,
    nextStatus: string,
    reason?: string,
): Promise<ChangeStatusResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff') {
        return { ok: false, error: '직원만 상태를 변경할 수 있습니다.' };
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return { ok: false, error: '주문을 찾을 수 없습니다.' };

    const allowed = ALLOWED_TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(nextStatus)) {
        return {
            ok: false,
            error: `'${order.status}' 상태에서 '${nextStatus}' 로 변경할 수 없습니다.`,
        };
    }

    try {
        await prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id: orderId },
                data: { status: nextStatus },
            });
            await tx.orderStatusHistory.create({
                data: {
                    orderId,
                    previousStatus: order.status,
                    newStatus: nextStatus,
                    changedByUserId: session.user.id,
                    changeReason: reason ?? null,
                },
            });
        });
        revalidatePath('/admin');
        revalidatePath(`/admin/orders/${orderId}`);
        revalidatePath('/portal');
        return { ok: true };
    } catch (e) {
        console.error('changeOrderStatus failed:', e);
        return { ok: false, error: '상태 변경 중 오류가 발생했습니다.' };
    }
}

export async function manualChangeOrderStatus(
    orderId: string,
    nextStatus: string,
    reason: string,
): Promise<ChangeStatusResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff') {
        return { ok: false, error: '직원만 상태를 변경할 수 있습니다.' };
    }
    if (!reason?.trim()) return { ok: false, error: '상태 변경 사유를 입력해주세요.' };

    const allowedStatuses = Object.values(OrderStatus) as string[];
    if (!allowedStatuses.includes(nextStatus)) {
        return { ok: false, error: '존재하지 않는 주문 상태입니다.' };
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.deletedAt) return { ok: false, error: '주문을 찾을 수 없습니다.' };
    if (order.status === nextStatus) return { ok: false, error: '이미 같은 상태입니다.' };

    try {
        await prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id: orderId },
                data: { status: nextStatus },
            });
            await tx.orderStatusHistory.create({
                data: {
                    orderId,
                    previousStatus: order.status,
                    newStatus: nextStatus,
                    changedByUserId: session.user.id,
                    changeReason: `[직원 수동변경] ${reason.trim()}`,
                },
            });
        });
        revalidatePath('/admin');
        revalidatePath(`/admin/orders/${orderId}`);
        revalidatePath('/portal');
        return { ok: true };
    } catch (e) {
        console.error('manualChangeOrderStatus failed:', e);
        return { ok: false, error: '상태 변경 중 오류가 발생했습니다.' };
    }
}

export async function updateOrderDeliveryDate(
    orderId: string,
    nextDeliveryDate: string,
    reason: string,
): Promise<ChangeStatusResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff') {
        return { ok: false, error: '직원만 도착일을 수정할 수 있습니다.' };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDeliveryDate)) {
        return { ok: false, error: '도착일 형식이 잘못되었습니다.' };
    }
    if (!reason?.trim()) return { ok: false, error: '도착일 수정 사유를 입력해주세요.' };

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.deletedAt) return { ok: false, error: '주문을 찾을 수 없습니다.' };

    const nextDate = new Date(nextDeliveryDate + 'T00:00:00');
    if (Number.isNaN(nextDate.getTime())) return { ok: false, error: '도착일이 올바르지 않습니다.' };

    const currentDateValue = order.requestedDeliveryDate?.toISOString().slice(0, 10) ?? '미지정';
    if (currentDateValue === nextDeliveryDate) return { ok: false, error: '이미 같은 도착일입니다.' };

    try {
        await prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id: orderId },
                data: { requestedDeliveryDate: nextDate },
            });
            await tx.orderStatusHistory.create({
                data: {
                    orderId,
                    previousStatus: order.status,
                    newStatus: order.status,
                    changedByUserId: session.user.id,
                    changeReason: `[도착일 수정] ${currentDateValue} → ${nextDeliveryDate} / ${reason.trim()}`,
                },
            });
        });
        revalidatePath('/admin');
        revalidatePath(`/admin/orders/${orderId}`);
        revalidatePath('/portal');
        revalidatePath(`/portal/orders/${orderId}`);
        return { ok: true };
    } catch (e) {
        console.error('updateOrderDeliveryDate failed:', e);
        return { ok: false, error: '도착일 수정 중 오류가 발생했습니다.' };
    }
}

export async function updateOrderItemQuantity(
    itemId: string,
    nextQuantity: number,
    reason: string,
): Promise<ChangeStatusResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff') {
        return { ok: false, error: '직원만 수량을 수정할 수 있습니다.' };
    }
    if (!Number.isFinite(nextQuantity) || nextQuantity <= 0) {
        return { ok: false, error: '수량은 0보다 커야 합니다.' };
    }
    if (!reason?.trim()) return { ok: false, error: '수량 수정 사유를 입력해주세요.' };

    const item = await prisma.orderItem.findUnique({
        where: { id: itemId },
        include: { order: true, product: { select: { productName: true } } },
    });
    if (!item || item.order.deletedAt) return { ok: false, error: '주문 품목을 찾을 수 없습니다.' };
    if (item.requestedQuantity === nextQuantity) return { ok: false, error: '이미 같은 수량입니다.' };

    const previousQuantity = item.requestedQuantity;
    const approvedQuantity = item.approvedQuantity === previousQuantity ? nextQuantity : item.approvedQuantity;

    try {
        await prisma.$transaction(async (tx) => {
            await tx.orderItem.update({
                where: { id: itemId },
                data: {
                    requestedQuantity: nextQuantity,
                    approvedQuantity,
                },
            });
            await tx.orderStatusHistory.create({
                data: {
                    orderId: item.orderId,
                    previousStatus: item.order.status,
                    newStatus: item.order.status,
                    changedByUserId: session.user.id,
                    changeReason: `[수량 수정] ${item.product.productName}: ${previousQuantity}${item.unit} → ${nextQuantity}${item.unit} / ${reason.trim()}`,
                },
            });
        });
        revalidatePath('/admin');
        revalidatePath(`/admin/orders/${item.orderId}`);
        revalidatePath('/portal');
        revalidatePath(`/portal/orders/${item.orderId}`);
        return { ok: true };
    } catch (e) {
        console.error('updateOrderItemQuantity failed:', e);
        return { ok: false, error: '수량 수정 중 오류가 발생했습니다.' };
    }
}

// 거래처 본인 주문 취소 (REQUESTED 상태일 때만)
export async function cancelOwnOrder(orderId: string): Promise<ChangeStatusResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'customer') {
        return { ok: false, error: '거래처 계정만 가능합니다.' };
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return { ok: false, error: '주문을 찾을 수 없습니다.' };
    if (order.customerId !== session.user.customerId) {
        return { ok: false, error: '본인 주문만 취소할 수 있습니다.' };
    }
    if (order.status !== 'REQUESTED') {
        return {
            ok: false,
            error: '이미 영업팀에서 처리 중이라 취소할 수 없습니다. 담당자에게 연락해주세요.',
        };
    }

    try {
        await prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id: orderId },
                data: { status: 'CANCELLED' },
            });
            await tx.orderStatusHistory.create({
                data: {
                    orderId,
                    previousStatus: order.status,
                    newStatus: 'CANCELLED',
                    changeReason: `거래처 자가 취소 (${session.user.name ?? session.user.id})`,
                },
            });
        });
        revalidatePath('/portal');
        revalidatePath(`/portal/orders/${orderId}`);
        revalidatePath('/admin');
        return { ok: true };
    } catch (e) {
        console.error('cancelOwnOrder failed:', e);
        return { ok: false, error: '취소 중 오류가 발생했습니다.' };
    }
}

// ─────────────────────────────────────────────────────────────
// 주문 소프트 삭제 (직원 전용)
// 삭제 후에도 /admin/orders/deleted 에서 조회 가능
// ─────────────────────────────────────────────────────────────
export async function softDeleteOrder(
    orderId: string,
    reason: string,
): Promise<ChangeStatusResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff') {
        return { ok: false, error: '직원만 주문을 삭제할 수 있습니다.' };
    }
    if (!reason?.trim()) return { ok: false, error: '삭제 사유를 입력해주세요.' };

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return { ok: false, error: '주문을 찾을 수 없습니다.' };
    if (order.deletedAt) return { ok: false, error: '이미 삭제된 주문입니다.' };

    try {
        await prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id: orderId },
                data: {
                    deletedAt: new Date(),
                    deletedById: session.user.id,
                    deleteReason: reason.trim(),
                },
            });
            await tx.orderStatusHistory.create({
                data: {
                    orderId,
                    previousStatus: order.status,
                    newStatus: 'DELETED',
                    changedByUserId: session.user.id,
                    changeReason: `[삭제] ${reason.trim()}`,
                },
            });
        });
        revalidatePath('/admin');
        revalidatePath(`/admin/orders/${orderId}`);
        revalidatePath('/admin/orders/deleted');
        return { ok: true };
    } catch (e) {
        console.error('softDeleteOrder failed:', e);
        return { ok: false, error: '삭제 중 오류가 발생했습니다.' };
    }
}

// ===============================================================
// 주문 품목 수정 (직원 전용): 품목 및 수량 동시 변경
// ===============================================================
export async function updateOrderItem(
    itemId: string,
    nextProductId: string,
    nextQuantity: number,
    reason: string,
): Promise<ChangeStatusResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff') {
        return { ok: false, error: '직원만 품목을 수정할 수 있습니다.' };
    }
    if (!nextProductId) return { ok: false, error: '품목을 선택해 주세요.' };
    if (!Number.isFinite(nextQuantity) || nextQuantity <= 0) {
        return { ok: false, error: '수량은 0보다 커야 합니다.' };
    }
    if (!reason?.trim()) return { ok: false, error: '수정 사유를 입력해 주세요.' };

    const item = await prisma.orderItem.findUnique({
        where: { id: itemId },
        include: { order: true, product: { select: { productName: true } } },
    });
    if (!item || item.order.deletedAt) return { ok: false, error: '주문 항목을 찾을 수 없습니다.' };

    const nextProduct = await prisma.product.findUnique({
        where: { id: nextProductId },
        select: { productName: true },
    });
    if (!nextProduct) return { ok: false, error: '선택한 품목을 찾을 수 없습니다.' };

    const unchanged = item.productId === nextProductId && item.requestedQuantity === nextQuantity;
    if (unchanged) return { ok: false, error: '변경된 내용이 없습니다.' };

    const previousQuantity = item.requestedQuantity;
    const approvedQuantity = item.productId === nextProductId && item.approvedQuantity === previousQuantity
        ? nextQuantity
        : null;

    try {
        await prisma.$transaction(async (tx) => {
            await tx.orderItem.update({
                where: { id: itemId },
                data: {
                    productId: nextProductId,
                    requestedQuantity: nextQuantity,
                    approvedQuantity,
                },
            });
            const changeDesc: string[] = [];
            if (item.productId !== nextProductId)
                changeDesc.push(`품목: ${item.product.productName} → ${nextProduct.productName}`);
            if (previousQuantity !== nextQuantity)
                changeDesc.push(`수량: ${previousQuantity}${item.unit} → ${nextQuantity}${item.unit}`);
            await tx.orderStatusHistory.create({
                data: {
                    orderId: item.orderId,
                    previousStatus: item.order.status,
                    newStatus: item.order.status,
                    changedByUserId: session.user.id,
                    changeReason: `[품목 수정] ${changeDesc.join(', ')} / ${reason.trim()}`,
                },
            });
        });
        revalidatePath('/admin');
        revalidatePath(`/admin/orders/${item.orderId}`);
        revalidatePath('/portal');
        revalidatePath(`/portal/orders/${item.orderId}`);
        return { ok: true };
    } catch (e) {
        console.error('updateOrderItem failed:', e);
        return { ok: false, error: '품목 수정 중 오류가 발생했습니다.' };
    }
}

export async function startHanwhaNewOrder(orderId: string) {
    const session = await auth();
    if (!session?.user) return { ok: false as const, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff' || session.user.name !== '양희철') {
        return { ok: false as const, error: '양희철 대표만 한화오더를 실행할 수 있습니다.' };
    }

    const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
            id: true,
            status: true,
            deletedAt: true,
            deliveryAddress: { select: { label: true } },
        },
    });

    if (!order || order.deletedAt) {
        return { ok: false as const, error: '주문을 찾을 수 없습니다.' };
    }
    if (order.status !== OrderStatus.APPROVED) {
        return { ok: false as const, error: '승인 완료된 주문에서만 한화오더를 실행할 수 있습니다.' };
    }

    const username = await getHanwhaUsername();
    const password = await getHanwhaPassword();
    const result = await openHanwhaNewOrder({
        username,
        password,
        deliveryAddressName: order.deliveryAddress.label,
    });

    if (!result.ok) {
        return { ok: false as const, error: result.error, errorCode: result.errorCode };
    }

    await prisma.orderStatusHistory.create({
        data: {
            orderId,
            previousStatus: order.status,
            newStatus: order.status,
            changedByUserId: session.user.id,
            changeReason: '[한화오더] 한화 H-CRM 새 주문 화면을 자동 준비했습니다.',
        },
    });

    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true as const, message: result.message };
}