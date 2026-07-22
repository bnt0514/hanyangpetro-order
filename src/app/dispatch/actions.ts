'use server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { extractHanwhaDriverFields } from '@/lib/hanwha-dispatch';
import { isSameQuantity } from '@/lib/product-matching';
import { isDispatchDestinationMatch } from '@/lib/dispatch-destination-match';
import { revalidatePath } from 'next/cache';
import { execFile } from 'node:child_process';
import { syncOrderWarehouseStockMovements } from '@/lib/warehouse-stock-sync';
import {
    canManageHanwhaCredentials,
    setHanwhaPassword,
} from '@/lib/hanwha-credentials';
import { isYangHeeCheol } from '@/lib/staff-permissions';
import { ORDER_STATUS } from '@/lib/orders';
import { applyHanwhaDispatchMatch } from '@/lib/hanwha-dispatch-auto-match';
import { dispatchCompletedStatusForOrder } from '@/lib/shipment-status';
import {
    BACKGROUND_JOB_TYPES,
    enqueueBackgroundJob,
    toBackgroundJobView,
    type BackgroundJobView,
} from '@/lib/background-jobs';

export type DispatchRowVM = {
    id: string;
    indoChiIndex: number;
    indoChiName: string;
    materialName: string | null;
    materialNameRaw: string | null;
    quantityKg: number | null;
    rawCells: string[];
    matchedOrderId: string | null;
    matchedAt: string | null;
};

export type DispatchSnapshotVM = {
    fetchedAt: string;
    status: string;
    errorMessage: string | null;
    rowCount: number;
    rows: DispatchRowVM[];
};

export type DispatchFetchResult =
    | { ok: true; snapshotId: string; rowCount: number; cached: boolean; snapshot: DispatchSnapshotVM }
    | { ok: true; queued: true; job: BackgroundJobView; cached: false; snapshot: DispatchSnapshotVM | null; message: string }
    | { ok: false; error: string; errorCode?: string };

export type DispatchJobStatusResult =
    | { ok: true; job: BackgroundJobView; snapshot: DispatchSnapshotVM | null }
    | { ok: false; error: string };

async function getSnapshotById(snapshotId: string): Promise<DispatchSnapshotVM> {
    const snapshot = await prisma.hanwhaDispatchSnapshot.findUniqueOrThrow({
        where: { id: snapshotId },
        include: { rows: { orderBy: [{ indoChiIndex: 'asc' }, { id: 'asc' }] } },
    });

    return {
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
    };
}

async function getSnapshotByDate(dispatchDate: Date): Promise<DispatchSnapshotVM | null> {
    const snapshot = await prisma.hanwhaDispatchSnapshot.findUnique({
        where: { dispatchDate },
        select: { id: true },
    });
    return snapshot ? getSnapshotById(snapshot.id) : null;
}

/**
 * 한화 H-CRM에서 해당 일자 배차 정보를 가져온다.
 * - 캐시(DB)에 정상(OK) 스냅샷이 있으면 그것을 반환 (force=false)
 * - AUTH_FAILED/FAILED 스냅샷은 캐시 취급 안 함 → 항상 재시도
 * - force=true 면 무조건 다시 긁어온다
 */
export async function fetchHanwhaDispatch(
    isoDate: string,
    force = false,
): Promise<DispatchFetchResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff') {
        return { ok: false, error: '직원만 조회할 수 있습니다.' };
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
        return { ok: false, error: '날짜 형식이 잘못됐습니다 (YYYY-MM-DD).' };
    }

    const dispatchDate = new Date(isoDate + 'T00:00:00');

    // 캐시 확인 (정상 OK 스냅샷만 캐시 취급)
    if (!force) {
        const cached = await prisma.hanwhaDispatchSnapshot.findUnique({
            where: { dispatchDate },
            select: { id: true, rowCount: true, status: true },
        });
        if (cached && cached.status === 'OK') {
            return {
                ok: true,
                snapshotId: cached.id,
                rowCount: cached.rowCount,
                cached: true,
                snapshot: await getSnapshotById(cached.id),
            };
        }
    }

    const { job, created } = await enqueueBackgroundJob({
        type: BACKGROUND_JOB_TYPES.HANWHA_DISPATCH_FETCH,
        queueKey: `HANWHA_DISPATCH:${isoDate}`,
        entityType: 'HANWHA_DISPATCH_DATE',
        entityId: isoDate,
        title: `배차조회 ${isoDate}`,
        message: force ? '배차 재조회를 백그라운드에서 시작합니다.' : '배차조회를 백그라운드에서 시작합니다.',
        requestedByUserId: session.user.id,
        metadata: { isoDate, force },
    });

    return {
        ok: true,
        queued: true,
        job: toBackgroundJobView(job),
        cached: false,
        snapshot: await getSnapshotByDate(dispatchDate),
        message: created
            ? '배차조회 작업을 백그라운드에 등록했습니다. 완료되면 자동으로 결과가 표시됩니다.'
            : '같은 날짜 배차조회가 이미 진행 중입니다. 완료되면 같은 결과를 표시합니다.',
    };
}

/** 캐시된 스냅샷을 비우고 강제 재조회 */
export async function refetchHanwhaDispatch(isoDate: string) {
    return fetchHanwhaDispatch(isoDate, true);
}

export async function getHanwhaDispatchJobStatus(jobId: string): Promise<DispatchJobStatusResult> {
    const session = await auth();
    if (!session?.user || session.user.userKind !== 'staff') return { ok: false, error: '권한이 없습니다.' };

    const job = await prisma.backgroundJob.findUnique({ where: { id: jobId } });
    if (!job) return { ok: false, error: '배차조회 작업을 찾을 수 없습니다.' };

    const metadata = JSON.parse(job.metadata || '{}') as { isoDate?: string };
    const dispatchDate = metadata.isoDate && /^\d{4}-\d{2}-\d{2}$/.test(metadata.isoDate)
        ? new Date(`${metadata.isoDate}T00:00:00`)
        : null;
    return {
        ok: true,
        job: toBackgroundJobView(job),
        snapshot: dispatchDate ? await getSnapshotByDate(dispatchDate) : null,
    };
}

/** 저장된 스냅샷 삭제 */
export async function clearHanwhaDispatch(isoDate: string) {
    const session = await auth();
    if (!session?.user || session.user.userKind !== 'staff') {
        return { ok: false as const, error: '권한이 없습니다.' };
    }
    const dispatchDate = new Date(isoDate + 'T00:00:00');
    await prisma.hanwhaDispatchSnapshot.deleteMany({ where: { dispatchDate } });
    revalidatePath('/admin/dispatch');
    return { ok: true as const };
}

async function legacyMatchHanwhaDispatchRow(rowId: string, orderId: string, matchMode: 'AUTO' | 'MANUAL' = 'MANUAL') {
    const session = await auth();
    if (!session?.user || session.user.userKind !== 'staff') {
        return { ok: false as const, error: '직원만 배차 매칭을 할 수 있습니다.' };
    }
    if (matchMode !== 'AUTO' && !isYangHeeCheol(session.user)) {
        return { ok: false as const, error: '양희철만 수동 배차 매칭을 할 수 있습니다.' };
    }

    const [row, order] = await Promise.all([
        prisma.hanwhaDispatchRow.findUnique({
            where: { id: rowId },
            include: { snapshot: { select: { dispatchDate: true } } },
        }),
        prisma.order.findUnique({
            where: { id: orderId },
            include: {
                items: true,
                customer: { select: { companyName: true } },
                deliveryAddress: { select: { label: true, addressLine1: true, addressLine2: true } },
                dispatches: {
                    where: { carrierName: '한화 H-CRM' },
                    select: { id: true, hanwhaQuantityTon: true, hanwhaDispatchRowId: true },
                },
            },
        }),
    ]);

    if (!row) return { ok: false as const, error: '배차 라인을 찾을 수 없습니다.' };
    if (!order || order.deletedAt) return { ok: false as const, error: '주문을 찾을 수 없습니다.' };

    if (matchMode === 'MANUAL' && !isDispatchDestinationMatch(row.indoChiName, {
        customerName: order.customer.companyName,
        addressLabel: order.deliveryAddress.label,
        addressLine1: order.deliveryAddress.addressLine1,
        addressLine2: order.deliveryAddress.addressLine2,
    })) {
        return { ok: false as const, error: '인도처와 도착지가 일치하는 주문만 수동 매칭할 수 있습니다.' };
    }

    const dispatchableStatuses: string[] = [
        ORDER_STATUS.DISPATCHING,
        ORDER_STATUS.DISPATCH_COMPLETED,
        ORDER_STATUS.SHIPPED,
    ];
    if (!dispatchableStatuses.includes(order.status)) {
        return {
            ok: false as const,
            error: `현재 주문 상태(${order.status})에서는 배차 매칭을 할 수 없습니다. 배차중/배차완료 상태여야 합니다.`,
        };
    }

    // 이미 DISPATCH_COMPLETED면 상태 변경 없이 배차 기록만 추가 (N:1 주문←→배차)
    const alreadyDispatched = order.status === ORDER_STATUS.DISPATCH_COMPLETED || order.status === ORDER_STATUS.SHIPPED;
    const driverFields = extractHanwhaDriverFields(row.rawCells);
    const orderQuantityTon = order.items.reduce((sum, item) => sum + item.requestedQuantity, 0);
    const matchedQuantityTon = order.dispatches.reduce((sum, dispatch) => {
        if (dispatch.hanwhaDispatchRowId === row.id) return sum;
        return sum + (dispatch.hanwhaQuantityTon ?? 0);
    }, 0);
    const nextDispatchQuantityTon = row.quantityKg;

    if (!Number.isFinite(nextDispatchQuantityTon)) {
        return { ok: false as const, error: '한화 배차 라인의 수량을 확인할 수 없어 매칭할 수 없습니다.' };
    }
    if (matchedQuantityTon >= orderQuantityTon || isSameQuantity(matchedQuantityTon, orderQuantityTon)) {
        return { ok: false as const, error: '이미 오더 전체 수량과 배차 전체 수량이 일치하여 추가 배차 매칭을 할 수 없습니다.' };
    }
    if (matchedQuantityTon + Number(nextDispatchQuantityTon) > orderQuantityTon + 0.0001) {
        return {
            ok: false as const,
            error: `배차 수량이 오더 수량을 초과합니다. 오더 ${orderQuantityTon}TON / 기매칭 ${matchedQuantityTon}TON / 추가 ${nextDispatchQuantityTon}TON`,
        };
    }
    const now = new Date();
    const nextMatchedQuantityTon = matchedQuantityTon + Number(nextDispatchQuantityTon);
    const nextStatus = nextMatchedQuantityTon + 0.0001 >= orderQuantityTon
        ? (order.status === ORDER_STATUS.SHIPPED ? ORDER_STATUS.SHIPPED : dispatchCompletedStatusForOrder(order, now))
        : order.status;

    await prisma.$transaction(async (tx) => {
        await tx.hanwhaDispatchRow.update({
            where: { id: rowId },
            data: {
                matchedOrderId: orderId,
                matchedAt: now,
                matchedByUserId: session.user.id,
            },
        });
        await tx.dispatch.create({
            data: {
                orderId,
                dispatchStatus: 'DISPATCH_COMPLETED',
                plannedDispatchDate: row.snapshot.dispatchDate,
                dispatchAttemptCount: 1,
                carrierName: '한화 H-CRM',
                hanwhaDispatchRowId: row.id,
                hanwhaMaterialNameRaw: row.materialNameRaw,
                hanwhaMaterialName: row.materialName,
                hanwhaQuantityTon: row.quantityKg,
                hanwhaRawCells: row.rawCells,
                vehicleNumber: driverFields.vehicleNumber,
                driverName: driverFields.driverName,
                driverPhone: driverFields.driverPhone,
                shareWithCustomer: true,
                memo: `한화 배차 라인 매칭: ${row.indoChiName} / ${row.materialName ?? row.materialNameRaw ?? '-'}`,
            },
        });
        if (!alreadyDispatched && nextStatus !== order.status) {
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
                    changeReason: nextStatus === ORDER_STATUS.DISPATCH_COMPLETED || nextStatus === ORDER_STATUS.SHIPPED
                        ? `한화 배차 조회 라인 매칭 완료 (${row.indoChiName})`
                        : `한화 배차 조회 라인 부분 매칭 (${row.indoChiName})`,
                },
            });
        } else {
            // 상태 변경 없이 배차 라인 매칭 이력만 남김
            await tx.orderStatusHistory.create({
                data: {
                    orderId,
                    previousStatus: order.status,
                    newStatus: order.status,
                    changedByUserId: session.user.id,
                    changeReason: `추가 배차 라인 매칭 (${row.indoChiName} / ${row.materialName ?? row.materialNameRaw ?? '-'})`,
                },
            });
        }
        await syncOrderWarehouseStockMovements(tx, orderId);
    });

    revalidatePath('/admin');
    revalidatePath('/admin/dispatch');
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true as const };
}

export async function matchHanwhaDispatchRow(rowId: string, orderId: string, matchMode: 'AUTO' | 'MANUAL' = 'MANUAL') {
    const session = await auth();
    if (!session?.user || session.user.userKind !== 'staff') {
        return { ok: false as const, error: '직원만 배차 매칭할 수 있습니다.' };
    }
    if (matchMode !== 'AUTO' && !isYangHeeCheol(session.user)) {
        return { ok: false as const, error: '양희철만 수동 배차 매칭을 할 수 있습니다.' };
    }

    const result = await applyHanwhaDispatchMatch({
        rowId,
        orderId,
        matchMode,
        matchedByUserId: session.user.id,
    });
    if (!result.ok) return result;

    revalidatePath('/admin');
    revalidatePath('/admin/dispatch');
    revalidatePath(`/admin/orders/${orderId}`);
    return result;
}

export async function deleteHanwhaDispatchMatch(matchId: string) {
    const session = await auth();
    if (!session?.user || session.user.userKind !== 'staff') {
        return { ok: false as const, error: '직원만 배차 매칭을 삭제할 수 있습니다.' };
    }

    const row = await prisma.hanwhaDispatchRow.findUnique({ where: { id: matchId } });
    const dispatch = row
        ? await prisma.dispatch.findFirst({ where: { hanwhaDispatchRowId: row.id, carrierName: '한화 H-CRM' } })
        : await prisma.dispatch.findUnique({ where: { id: matchId } });

    if (!row && !dispatch) return { ok: false as const, error: '삭제할 배차 매칭을 찾을 수 없습니다.' };

    const orderId = row?.matchedOrderId ?? dispatch?.orderId;
    if (!orderId) return { ok: false as const, error: '연결된 주문을 찾을 수 없습니다.' };

    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true, deletedAt: true, hanwhaOrderedAt: true } });
    if (!order || order.deletedAt) return { ok: false as const, error: '주문을 찾을 수 없습니다.' };
    const deleteLabel = dispatch?.carrierName === '수기 배차' ? '수기 배차내역' : '한화 배차 매칭';

    await prisma.$transaction(async (tx) => {
        if (dispatch) {
            await tx.dispatch.delete({ where: { id: dispatch.id } });
        }
        const rowId = row?.id ?? dispatch?.hanwhaDispatchRowId;
        if (rowId) {
            await tx.hanwhaDispatchRow.updateMany({
                where: { id: rowId },
                data: { matchedOrderId: null, matchedAt: null, matchedByUserId: null },
            });
        }
        const remainingOrder = await tx.order.findUnique({
            where: { id: orderId },
            select: {
                items: { select: { requestedQuantity: true } },
                dispatches: { select: { hanwhaQuantityTon: true } },
            },
        });
        const remainingOrderQuantityTon = remainingOrder?.items.reduce((sum, item) => sum + item.requestedQuantity, 0) ?? 0;
        const remainingDispatchQuantityTon = remainingOrder?.dispatches.reduce((sum, item) => sum + (item.hanwhaQuantityTon ?? 0), 0) ?? 0;
        const dispatchStillComplete = remainingDispatchQuantityTon + 0.0001 >= remainingOrderQuantityTon && remainingOrderQuantityTon > 0;
        const canRollbackDispatchStatus =
            order.status === ORDER_STATUS.DISPATCHING ||
            order.status === ORDER_STATUS.DISPATCH_COMPLETED ||
            order.status === ORDER_STATUS.SHIPPED;
        const nextStatus = canRollbackDispatchStatus && !dispatchStillComplete
            ? (remainingDispatchQuantityTon > 0 || order.hanwhaOrderedAt ? ORDER_STATUS.DISPATCHING : ORDER_STATUS.APPROVED)
            : order.status;
        if (nextStatus !== order.status) {
            await tx.order.update({ where: { id: orderId }, data: { status: nextStatus } });
        }
        await tx.orderStatusHistory.create({
            data: {
                orderId,
                previousStatus: order.status,
                newStatus: nextStatus,
                changedByUserId: session.user.id,
                changeReason: `[배차 삭제] ${deleteLabel}을 삭제했습니다.`,
            },
        });
        await syncOrderWarehouseStockMovements(tx, orderId);
    });

    revalidatePath('/admin');
    revalidatePath('/admin/dispatch');
    revalidatePath(`/admin/orders/${orderId}`);
    revalidatePath(`/portal/orders/${orderId}`);
    return { ok: true as const };
}

export async function createManualDispatch(formData: FormData) {
    const session = await auth();
    if (!session?.user || session.user.userKind !== 'staff') {
        return { ok: false as const, error: '직원만 수기 배차를 입력할 수 있습니다.' };
    }

    const orderId = String(formData.get('orderId') ?? '');
    const materialName = String(formData.get('materialName') ?? '').trim();
    const driverInfo = String(formData.get('driverInfo') ?? '').trim();
    const quantityTon = Number(formData.get('quantityTon'));

    if (!orderId) return { ok: false as const, error: '주문 정보가 없습니다.' };
    if (!materialName) return { ok: false as const, error: '품목을 입력해주세요.' };
    if (!Number.isFinite(quantityTon) || quantityTon <= 0) return { ok: false as const, error: '수량을 올바르게 입력해주세요.' };
    if (!driverInfo) return { ok: false as const, error: '기사정보를 입력해주세요.' };

    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
            items: { select: { requestedQuantity: true } },
            dispatches: { select: { hanwhaQuantityTon: true } },
        },
    });
    if (!order || order.deletedAt) return { ok: false as const, error: '주문을 찾을 수 없습니다.' };

    const dispatchableStatuses: string[] = [ORDER_STATUS.DISPATCHING, ORDER_STATUS.DISPATCH_COMPLETED, ORDER_STATUS.SHIPPED];
    if (!dispatchableStatuses.includes(order.status)) {
        return { ok: false as const, error: `현재 주문 상태(${order.status})에서는 배차를 입력할 수 없습니다.` };
    }

    const orderQuantityTon = order.items.reduce((sum, item) => sum + item.requestedQuantity, 0);
    const alreadyDispatchedTon = order.dispatches.reduce((sum, dispatch) => sum + (dispatch.hanwhaQuantityTon ?? 0), 0);
    if (alreadyDispatchedTon + quantityTon > orderQuantityTon + 0.0001) {
        return { ok: false as const, error: `배차 수량이 주문 수량을 초과합니다. 주문 ${orderQuantityTon}TON / 기입력 ${alreadyDispatchedTon}TON / 추가 ${quantityTon}TON` };
    }

    const dispatchDate = order.requestedDeliveryDate ?? new Date();
    const alreadyCompleted = order.status === ORDER_STATUS.DISPATCH_COMPLETED || order.status === ORDER_STATUS.SHIPPED;
    const nextTotal = alreadyDispatchedTon + quantityTon;
    const now = new Date();
    const nextStatus = nextTotal + 0.0001 >= orderQuantityTon
        ? (order.status === ORDER_STATUS.SHIPPED ? ORDER_STATUS.SHIPPED : dispatchCompletedStatusForOrder(order, now))
        : order.status;

    await prisma.$transaction(async (tx) => {
        await tx.dispatch.create({
            data: {
                orderId,
                dispatchStatus: 'DISPATCH_COMPLETED',
                plannedDispatchDate: dispatchDate,
                dispatchAttemptCount: 1,
                carrierName: '수기 배차',
                hanwhaMaterialNameRaw: materialName,
                hanwhaMaterialName: materialName,
                hanwhaQuantityTon: quantityTon,
                hanwhaRawCells: JSON.stringify(['MANUAL', materialName, String(quantityTon), driverInfo]),
                vehicleNumber: driverInfo,
                shareWithCustomer: true,
                memo: `[수기 배차] ${materialName} ${quantityTon}TON / ${driverInfo}`,
            },
        });
        if (!alreadyCompleted && nextStatus !== order.status) {
            await tx.order.update({ where: { id: orderId }, data: { status: nextStatus } });
        }
        await tx.orderStatusHistory.create({
            data: {
                orderId,
                previousStatus: order.status,
                newStatus: nextStatus,
                changedByUserId: session.user.id,
                changeReason: `[수기 배차 입력] ${materialName} ${quantityTon}TON`,
            },
        });
        await syncOrderWarehouseStockMovements(tx, orderId);
    });

    revalidatePath('/admin');
    revalidatePath(`/admin/orders/${orderId}`);
    revalidatePath(`/portal/orders/${orderId}`);
    return { ok: true as const };
}

export async function confirmOrderReceipt(orderId: string, reason?: string) {
    const session = await auth();
    if (!session?.user || session.user.userKind !== 'staff') {
        return { ok: false as const, error: '직원만 출고완료 처리할 수 있습니다.' };
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.deletedAt) return { ok: false as const, error: '주문을 찾을 수 없습니다.' };

    await prisma.$transaction(async (tx) => {
        await tx.order.update({
            where: { id: orderId },
            data: { status: ORDER_STATUS.SHIPPED },
        });
        await tx.orderStatusHistory.create({
            data: {
                orderId,
                previousStatus: order.status,
                newStatus: ORDER_STATUS.SHIPPED,
                changedByUserId: session.user.id,
                changeReason: reason?.trim() || '출고완료 처리',
            },
        });
        await syncOrderWarehouseStockMovements(tx, orderId);
    });

    revalidatePath('/admin');
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true as const };
}

// =====================================================================
// 한화 자격증명 관리 (대표/관리자 전용)
// =====================================================================

export type CredentialUpdateResult =
    | { ok: true; message: string }
    | { ok: false; error: string };

export async function runHanwhaKeepAliveOnce(): Promise<CredentialUpdateResult> {
    const session = await auth();
    if (!session?.user || session.user.userKind !== 'staff' || session.user.name !== '양희철') {
        return { ok: false, error: '양희철만 한화 e-Sales 연결유지를 수동 실행할 수 있습니다.' };
    }

    return new Promise((resolve) => {
        execFile(
            process.execPath,
            ['scripts/hanwha-esales-keepalive.cjs', '--once'],
            {
                cwd: process.cwd(),
                windowsHide: true,
                timeout: 120_000,
            },
            (error, stdout, stderr) => {
                if (error) {
                    resolve({
                        ok: false,
                        error: `한화 e-Sales 연결유지 실행 실패: ${stderr.trim() || error.message}`,
                    });
                    return;
                }

                const lastLine = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
                resolve({
                    ok: true,
                    message: lastLine || '한화 e-Sales 연결유지를 실행했습니다.',
                });
            },
        );
    });
}

/**
 * 한화 H-CRM 비밀번호 갱신.
 * - EXECUTIVE / ADMIN 만 호출 가능.
 * - 갱신 후 모든 AUTH_FAILED 스냅샷을 비워 재조회 가능 상태로 만든다.
 */
export async function updateHanwhaPassword(newPassword: string): Promise<CredentialUpdateResult> {
    const session = await auth();
    if (!session?.user || session.user.userKind !== 'staff') {
        return { ok: false, error: '로그인이 필요합니다.' };
    }
    if (!canManageHanwhaCredentials(session.user.role)) {
        return { ok: false, error: '대표 또는 관리자만 변경할 수 있습니다.' };
    }
    const trimmed = newPassword.trim();
    if (trimmed.length < 4) {
        return { ok: false, error: '비밀번호가 너무 짧습니다 (4자 이상).' };
    }

    await setHanwhaPassword(trimmed, session.user.id);

    // 인증 실패로 저장된 스냅샷 정리 → 다음 조회 시 새로 시도
    await prisma.hanwhaDispatchSnapshot.deleteMany({ where: { status: 'AUTH_FAILED' } });

    revalidatePath('/admin/settings/hanwha');
    revalidatePath('/admin/dispatch');
    return { ok: true, message: '비밀번호가 갱신되었습니다. 이제 배차 조회를 다시 시도할 수 있습니다.' };
}
