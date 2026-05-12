'use server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { extractHanwhaDriverFields } from '@/lib/hanwha-dispatch';
import { revalidatePath } from 'next/cache';
import { scrapeHanwhaDispatch } from '@/lib/hanwha-scraper';
import {
    canManageHanwhaCredentials,
    getHanwhaPassword,
    getHanwhaUsername,
    setHanwhaPassword,
} from '@/lib/hanwha-credentials';
import { OrderStatus } from '@/shared/enums';

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
    | { ok: false; error: string; errorCode?: string };

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

    // DB 우선 자격증명 로드
    const username = await getHanwhaUsername();
    const password = await getHanwhaPassword();

    // 스크래핑 (시간 오래 걸림)
    const result = await scrapeHanwhaDispatch(isoDate, { username, password });

    if (!result.ok) {
        const friendly =
            result.errorCode === 'AUTH_FAILED'
                ? '한화 H-CRM 자동 로그인에 실패했습니다. 한화 사이트의 비밀번호가 변경된 것으로 보입니다. 담당자(양희철 대표 / 차성식 관리자)에게 비밀번호 갱신을 요청해주세요.'
                : result.errorCode === 'NO_CREDENTIALS'
                    ? '한화 계정 정보가 등록되지 않았습니다. 담당자(양희철 대표 / 차성식 관리자)에게 문의해주세요.'
                    : (result.error ?? '알 수 없는 오류가 발생했습니다.');

        await prisma.hanwhaDispatchSnapshot.upsert({
            where: { dispatchDate },
            update: {
                fetchedAt: new Date(),
                fetchedByUserId: session.user.id,
                status: result.errorCode === 'AUTH_FAILED' ? 'AUTH_FAILED' : 'FAILED',
                errorMessage: friendly,
                rowCount: 0,
            },
            create: {
                dispatchDate,
                fetchedByUserId: session.user.id,
                status: result.errorCode === 'AUTH_FAILED' ? 'AUTH_FAILED' : 'FAILED',
                errorMessage: friendly,
            },
        });
        revalidatePath('/admin/dispatch');
        return { ok: false, error: friendly, errorCode: result.errorCode };
    }

    // 성공 → 트랜잭션으로 기존 스냅샷 삭제 후 재생성
    const totalRows = result.rows.reduce((sum, ic) => sum + ic.lines.length, 0);

    const snapshot = await prisma.$transaction(async (tx) => {
        await tx.hanwhaDispatchSnapshot.deleteMany({ where: { dispatchDate } });
        const snap = await tx.hanwhaDispatchSnapshot.create({
            data: {
                dispatchDate,
                fetchedAt: new Date(),
                fetchedByUserId: session.user.id,
                status: 'OK',
                rowCount: totalRows,
            },
        });
        for (const ic of result.rows) {
            for (const line of ic.lines) {
                await tx.hanwhaDispatchRow.create({
                    data: {
                        snapshotId: snap.id,
                        indoChiIndex: ic.indoChiIndex,
                        indoChiName: ic.indoChiName,
                        materialNameRaw: line.materialNameRaw,
                        materialName: line.materialName,
                        quantityKg: line.quantityKg,
                        rawCells: JSON.stringify(line.rawCells),
                    },
                });
            }
        }
        return snap;
    });

    revalidatePath('/admin/dispatch');
    return {
        ok: true,
        snapshotId: snapshot.id,
        rowCount: totalRows,
        cached: false,
        snapshot: await getSnapshotById(snapshot.id),
    };
}

/** 캐시된 스냅샷을 비우고 강제 재조회 */
export async function refetchHanwhaDispatch(isoDate: string) {
    return fetchHanwhaDispatch(isoDate, true);
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

export async function matchHanwhaDispatchRow(rowId: string, orderId: string) {
    const session = await auth();
    if (!session?.user || session.user.userKind !== 'staff') {
        return { ok: false as const, error: '직원만 배차 매칭을 할 수 있습니다.' };
    }

    const [row, order] = await Promise.all([
        prisma.hanwhaDispatchRow.findUnique({
            where: { id: rowId },
            include: { snapshot: { select: { dispatchDate: true } } },
        }),
        prisma.order.findUnique({ where: { id: orderId }, include: { items: true } }),
    ]);

    if (!row) return { ok: false as const, error: '배차 라인을 찾을 수 없습니다.' };
    if (!order || order.deletedAt) return { ok: false as const, error: '주문을 찾을 수 없습니다.' };

    const dispatchableStatuses: string[] = [
        OrderStatus.DISPATCH_WAITING,
        OrderStatus.DISPATCH_COMPLETED,
        OrderStatus.APPROVED,
    ];
    if (!dispatchableStatuses.includes(order.status)) {
        return {
            ok: false as const,
            error: `현재 주문 상태(${order.status})에서는 배차 매칭을 할 수 없습니다. 배차 대기/완료 상태여야 합니다.`,
        };
    }

    // 이미 DISPATCH_COMPLETED면 상태 변경 없이 배차 기록만 추가 (N:1 주문←→배차)
    const alreadyDispatched = order.status === OrderStatus.DISPATCH_COMPLETED;
    const driverFields = extractHanwhaDriverFields(row.rawCells);

    const now = new Date();
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
        if (!alreadyDispatched) {
            await tx.order.update({
                where: { id: orderId },
                data: { status: OrderStatus.DISPATCH_COMPLETED },
            });
            await tx.orderStatusHistory.create({
                data: {
                    orderId,
                    previousStatus: order.status,
                    newStatus: OrderStatus.DISPATCH_COMPLETED,
                    changedByUserId: session.user.id,
                    changeReason: `한화 배차 조회 라인 매칭 (${row.indoChiName})`,
                },
            });
        } else {
            // 추가 배차 라인 매칭 이력만 남김
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
    });

    revalidatePath('/admin');
    revalidatePath('/admin/dispatch');
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true as const };
}

export async function confirmOrderReceipt(orderId: string, reason?: string) {
    const session = await auth();
    if (!session?.user || session.user.userKind !== 'staff') {
        return { ok: false as const, error: '직원만 입고 완료 처리할 수 있습니다.' };
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.deletedAt) return { ok: false as const, error: '주문을 찾을 수 없습니다.' };

    await prisma.$transaction(async (tx) => {
        await tx.deliveryReceipt.create({
            data: {
                orderId,
                receiptStatus: 'CONFIRMED',
                confirmedByUserId: session.user.id,
                confirmedAt: new Date(),
                memo: reason?.trim() || '직원 입고 완료 처리',
            },
        });
        await tx.order.update({
            where: { id: orderId },
            data: { status: OrderStatus.COMPLETED },
        });
        await tx.orderStatusHistory.create({
            data: {
                orderId,
                previousStatus: order.status,
                newStatus: OrderStatus.COMPLETED,
                changedByUserId: session.user.id,
                changeReason: reason?.trim() || '입고 완료 처리',
            },
        });
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
