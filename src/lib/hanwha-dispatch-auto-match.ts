import { prisma } from '@/lib/db';
import { isDispatchDestinationMatch, normalizeDispatchDestinationText } from '@/lib/dispatch-destination-match';
import {
    extractHanwhaDriverFields,
    hanwhaDispatchCompletionStatus,
    hasHanwhaDriverInfo,
} from '@/lib/hanwha-dispatch';
import { ORDER_STATUS } from '@/lib/orders';
import { isSameQuantity, matchProductToMaterial } from '@/lib/product-matching';
import { syncOrderWarehouseStockMovements } from '@/lib/warehouse-stock-sync';
import { dispatchCompletedStatusForOrder } from '@/lib/shipment-status';

type MatchMode = 'AUTO' | 'MANUAL';

type DispatchMatchInput = {
    rowId: string;
    orderId: string;
    matchMode: MatchMode;
    matchedByUserId: string | null;
};

type DispatchMatchResult =
    | { ok: true }
    | { ok: false; error: string };

type AutoMatchSummary = {
    eligible: number;
    matched: number;
    skipped: number;
};

function isChemcoPrecisionSecondFactory(value: string) {
    return normalizeDispatchDestinationText(value).includes('켐코정밀2공장');
}

function dateToKstIso(date: Date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function sameIsoDate(date: Date | null, isoDate: string) {
    return date?.toISOString().slice(0, 10) === isoDate;
}

export async function applyHanwhaDispatchMatch({
    rowId,
    orderId,
    matchMode,
    matchedByUserId,
}: DispatchMatchInput): Promise<DispatchMatchResult> {
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
                    select: { hanwhaQuantityTon: true, hanwhaDispatchRowId: true },
                },
            },
        }),
    ]);

    if (!row) return { ok: false, error: '배차 라인을 찾을 수 없습니다.' };
    if (!order || order.deletedAt) return { ok: false, error: '주문을 찾을 수 없습니다.' };

    if (matchMode === 'MANUAL' && !isDispatchDestinationMatch(row.indoChiName, {
        customerName: order.customer.companyName,
        addressLabel: order.deliveryAddress.label,
        addressLine1: order.deliveryAddress.addressLine1,
        addressLine2: order.deliveryAddress.addressLine2,
    })) {
        return { ok: false, error: '인도처와 도착지가 일치하는 주문만 수동 매칭할 수 있습니다.' };
    }

    const dispatchableStatuses: string[] = [
        ORDER_STATUS.DISPATCHING,
        ORDER_STATUS.DISPATCH_COMPLETED,
        ORDER_STATUS.SHIPPED,
    ];
    if (!dispatchableStatuses.includes(order.status)) {
        return { ok: false, error: `현재 주문 상태(${order.status})에서는 배차 매칭을 할 수 없습니다.` };
    }

    const nextDispatchQuantityTon = row.quantityKg;
    if (!Number.isFinite(nextDispatchQuantityTon)) {
        return { ok: false, error: '한화 배차 라인의 수량을 확인할 수 없습니다.' };
    }

    const orderQuantityTon = order.items.reduce((sum, item) => sum + item.requestedQuantity, 0);
    const matchedQuantityTon = order.dispatches.reduce((sum, dispatch) => {
        if (dispatch.hanwhaDispatchRowId === row.id) return sum;
        return sum + (dispatch.hanwhaQuantityTon ?? 0);
    }, 0);
    if (matchedQuantityTon >= orderQuantityTon || isSameQuantity(matchedQuantityTon, orderQuantityTon)) {
        return { ok: false, error: '주문 수량이 이미 모두 배차 매칭되었습니다.' };
    }
    if (matchedQuantityTon + Number(nextDispatchQuantityTon) > orderQuantityTon + 0.0001) {
        return { ok: false, error: '배차 수량이 주문 수량을 초과합니다.' };
    }

    const now = new Date();
    const alreadyDispatched = order.status === ORDER_STATUS.DISPATCH_COMPLETED || order.status === ORDER_STATUS.SHIPPED;
    const nextMatchedQuantityTon = matchedQuantityTon + Number(nextDispatchQuantityTon);
    const nextStatus = nextMatchedQuantityTon + 0.0001 >= orderQuantityTon
        ? (order.status === ORDER_STATUS.SHIPPED ? ORDER_STATUS.SHIPPED : dispatchCompletedStatusForOrder(order, now))
        : order.status;
    const driverFields = extractHanwhaDriverFields(row.rawCells);

    await prisma.$transaction(async (tx) => {
        await tx.hanwhaDispatchRow.update({
            where: { id: rowId },
            data: {
                matchedOrderId: orderId,
                matchedAt: now,
                matchedByUserId,
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
            await tx.order.update({ where: { id: orderId }, data: { status: nextStatus } });
        }
        await tx.orderStatusHistory.create({
            data: {
                orderId,
                previousStatus: order.status,
                newStatus: nextStatus,
                changedByUserId: matchedByUserId,
                changeReason: nextStatus !== order.status
                    ? `한화 배차 조회 라인 매칭 완료 (${row.indoChiName})`
                    : `추가 배차 라인 매칭 (${row.indoChiName} / ${row.materialName ?? row.materialNameRaw ?? '-'})`,
            },
        });
        await syncOrderWarehouseStockMovements(tx, orderId);
    });

    return { ok: true };
}

function scoreAutoMatch(
    order: {
        customer: { companyName: string };
        deliveryAddress: { label: string; addressLine1: string; addressLine2: string | null };
        requestedDeliveryDate: Date | null;
        items: Array<{ requestedQuantity: number; product: { productName: string; productCode: string } }>;
        dispatches: Array<{ hanwhaMaterialName: string | null; hanwhaMaterialNameRaw: string | null; hanwhaQuantityTon: number | null }>;
    },
    row: { indoChiName: string; materialName: string | null; materialNameRaw: string | null; quantityKg: number | null },
    dispatchDate: string,
) {
    if (!sameIsoDate(order.requestedDeliveryDate, dispatchDate)) return null;

    const keywords = row.indoChiName
        .split(/[\s,./()\[\]]/)
        .filter((value) => value.length >= 2)
        .map((value) => value.toLowerCase());
    const hay = [order.customer.companyName, order.deliveryAddress.label, order.deliveryAddress.addressLine1]
        .join(' ')
        .toLowerCase();
    const normalizedHay = normalizeDispatchDestinationText(hay);
    const normalizedIndoChiName = normalizeDispatchDestinationText(row.indoChiName);
    const addressHits = keywords.filter((keyword) => hay.includes(keyword));
    const normalizedAddressHit = Boolean(normalizedIndoChiName) && normalizedHay.includes(normalizedIndoChiName);
    const chemcoSecondFactoryNameHit =
        isChemcoPrecisionSecondFactory(row.indoChiName) &&
        isChemcoPrecisionSecondFactory([order.customer.companyName, order.deliveryAddress.label].join(' '));
    if (addressHits.length === 0 && !normalizedAddressHit && !chemcoSecondFactoryNameHit) return null;

    const materialExists = Boolean(row.materialName || row.materialNameRaw);
    const itemScores = order.items
        .map((item) => {
            const productMatch = matchProductToMaterial(
                { productName: item.product.productName, productCode: item.product.productCode },
                { materialName: row.materialName, materialNameRaw: row.materialNameRaw },
            );
            if (materialExists && !productMatch.matches) return null;

            const dispatchedQuantityTon = order.dispatches.reduce((sum, dispatch) => {
                const dispatchedProductMatch = matchProductToMaterial(
                    { productName: item.product.productName, productCode: item.product.productCode },
                    { materialName: dispatch.hanwhaMaterialName, materialNameRaw: dispatch.hanwhaMaterialNameRaw },
                );
                return dispatchedProductMatch.matches ? sum + (dispatch.hanwhaQuantityTon ?? 0) : sum;
            }, 0);
            const remainingQuantityTon = Math.max(0, item.requestedQuantity - dispatchedQuantityTon);
            if (Number.isFinite(row.quantityKg) && remainingQuantityTon <= 0) return null;

            let quantityScore = 0;
            if (Number.isFinite(row.quantityKg)) {
                if (isSameQuantity(remainingQuantityTon, row.quantityKg)) quantityScore += 40;
                else if (remainingQuantityTon >= Number(row.quantityKg)) quantityScore += 25;
                if (isSameQuantity(item.requestedQuantity, row.quantityKg)) quantityScore += 20;
                else if (item.requestedQuantity > Number(row.quantityKg)) quantityScore += 10;
            }
            return productMatch.score + quantityScore;
        })
        .filter((score): score is number => score !== null)
        .sort((a, b) => b - a);
    if (itemScores.length === 0) return null;

    const addressScore = chemcoSecondFactoryNameHit
        ? 80
        : Math.max(addressHits.length * 15, normalizedAddressHit ? 30 : 0);
    const score = addressScore + 35 + itemScores[0];
    return score >= 70 ? score : null;
}

export async function autoMatchHanwhaDispatchSnapshot(
    snapshotId: string,
    matchedByUserId: string | null,
): Promise<AutoMatchSummary> {
    const snapshot = await prisma.hanwhaDispatchSnapshot.findUnique({
        where: { id: snapshotId },
        select: { dispatchDate: true },
    });
    if (!snapshot) return { eligible: 0, matched: 0, skipped: 0 };

    const dispatchDate = dateToKstIso(snapshot.dispatchDate);
    const rows = await prisma.hanwhaDispatchRow.findMany({
        where: { snapshotId, matchedOrderId: null },
        orderBy: [{ indoChiIndex: 'asc' }, { id: 'asc' }],
        select: {
            id: true,
            indoChiName: true,
            materialName: true,
            materialNameRaw: true,
            quantityKg: true,
            rawCells: true,
        },
    });

    let eligible = 0;
    let matched = 0;
    for (const row of rows) {
        if (!hasHanwhaDriverInfo(row.rawCells)) continue;
        if (hanwhaDispatchCompletionStatus(row.rawCells) !== '출고완료') continue;
        eligible += 1;

        const candidates = await prisma.order.findMany({
            where: {
                deletedAt: null,
                status: { in: [ORDER_STATUS.DISPATCHING, ORDER_STATUS.DISPATCH_COMPLETED, ORDER_STATUS.SHIPPED] },
            },
            include: {
                customer: { select: { companyName: true } },
                deliveryAddress: { select: { label: true, addressLine1: true, addressLine2: true } },
                items: { include: { product: { select: { productName: true, productCode: true } } } },
                dispatches: {
                    where: { carrierName: '한화 H-CRM' },
                    select: { hanwhaMaterialName: true, hanwhaMaterialNameRaw: true, hanwhaQuantityTon: true },
                },
            },
        });
        const scored = candidates
            .map((order) => ({ order, score: scoreAutoMatch(order, row, dispatchDate) }))
            .filter((candidate): candidate is { order: (typeof candidates)[number]; score: number } => candidate.score !== null)
            .sort((a, b) => b.score - a.score);
        const best = scored[0];
        if (!best) continue;
        const tied = scored.filter((candidate) => best.score - candidate.score <= 10);
        if (tied.length !== 1 || best.score < 100) continue;

        const result = await applyHanwhaDispatchMatch({
            rowId: row.id,
            orderId: best.order.id,
            matchMode: 'AUTO',
            matchedByUserId,
        });
        if (result.ok) matched += 1;
    }

    return { eligible, matched, skipped: eligible - matched };
}
