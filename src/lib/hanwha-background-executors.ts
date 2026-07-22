import type { BackgroundJob } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
    BACKGROUND_JOB_TYPES,
    createJobNotification,
    parseJobJsonAs,
    updateBackgroundJobResult,
} from '@/lib/background-jobs';
import { getHanwhaPassword, getHanwhaUsername } from '@/lib/hanwha-credentials';
import { runHanwhaAutomationQueued } from '@/lib/hanwha-automation-gate';
import { scrapeHanwhaDispatch } from '@/lib/hanwha-scraper';
import {
    checkHanwhaESalesOrderStatus,
    hanwhaOrderStatusItemsMatch,
    scrapeHanwhaESalesShipmentStatusesByOrderDateRange,
    type HanwhaESalesOrderDetailLine,
    type HanwhaESalesOrderStatusItem,
} from '@/lib/hanwha-esales-login';
import { resolveHanwhaMaterialName } from '@/lib/hanwha-material-map';
import { autoMatchHanwhaDispatchSnapshot } from '@/lib/hanwha-dispatch-auto-match';
import { nextBusinessDate } from '@/lib/korean-holidays';
import { purchaseRequestDateFromOrderNo } from '@/lib/ledger-policy';
import {
    executeHanwhaNewOrderJob,
    HanwhaProductSelectionRequiredError,
    type HanwhaNewOrderJobMetadata,
} from '@/lib/hanwha-new-order-job';

type DispatchFetchMetadata = {
    isoDate: string;
    force?: boolean;
};

type OrderStatusMetadata = {
    orderId: string;
};

type TodayShipmentMetadata = {
    orderDateIso: string;
    force?: boolean;
};

type TodayShipmentSnapshotRowForMatch = {
    id: string;
    rowIndex: number;
    orderNo: string | null;
    shipToName: string | null;
    statusText: string;
    deliveryDateYmd: string | null;
    rawCells: string[];
    rowText: string | null;
    detailLines: HanwhaESalesOrderDetailLine[];
};

type TodayShipmentSnapshotForMatch = {
    id: string;
    fetchedAt: Date;
    status: string;
    errorMessage: string | null;
    rowCount: number;
    rows: TodayShipmentSnapshotRowForMatch[];
};

function normalizeCompanyName(value: string | null | undefined) {
    return (value ?? '')
        .replace(/주식회사|\(주\)|㈜/g, '')
        .replace(/\s|[()]/g, '')
        .trim();
}

function isHanwhaSupplierName(value: string | null | undefined) {
    const normalized = normalizeCompanyName(value);
    return normalized === '한화솔루션' || normalized.includes('한화솔루션');
}

function normalizeHanwhaBagType(value: string | null | undefined) {
    const bagType = value?.trim().toUpperCase();
    return bagType && ['FFS', 'FB500', 'FB700', 'FB750'].includes(bagType) ? bagType : null;
}

function normalizeProductForDefaultBag(value: string | null | undefined) {
    return (value ?? '').replace(/\s+/g, '').toUpperCase();
}

function defaultHanwhaBagTypeForProduct(productName: string | null | undefined) {
    return normalizeProductForDefaultBag(productName) === 'MLLDPE<M1605EN>' ? 'FB700' : null;
}

function resolveHanwhaBagType(value: string | null | undefined, productName: string | null | undefined) {
    return normalizeHanwhaBagType(value) ?? defaultHanwhaBagTypeForProduct(productName);
}

function isHanwhaOrderItem(item: {
    hanwhaBagType?: string | null;
    purchaseSupplier?: { supplierName: string | null } | null;
    product?: { productName?: string | null; hanwhaItemCode?: string | null; hanwhaMaterialName?: string | null } | null;
}) {
    const supplierName = item.purchaseSupplier?.supplierName?.trim();
    if (supplierName) return isHanwhaSupplierName(supplierName);

    const productName = normalizeProductForDefaultBag(item.product?.productName);
    const bagType = resolveHanwhaBagType(item.hanwhaBagType, item.product?.productName);
    return productName === 'MLLDPE<M1605EN>'
        && bagType === 'FFS'
        && Boolean(item.product?.hanwhaItemCode?.trim() || item.product?.hanwhaMaterialName?.trim());
}

function quantityToMetricTon(quantity: number, unit: string | null | undefined) {
    const normalizedUnit = (unit ?? '').trim().toUpperCase();
    return normalizedUnit === 'KG' ? quantity / 1000 : quantity;
}

function dateOnly(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseIsoDate(value: string | null | undefined) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return dateOnly(new Date());
    return new Date(`${value}T00:00:00`);
}

function addDays(date: Date, days: number) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function todayShipmentDeliveryWindow(orderDate: Date) {
    const start = dateOnly(addDays(orderDate, 1));
    const nextBusiness = dateOnly(nextBusinessDate(orderDate) ?? start);
    return {
        start,
        end: addDays(nextBusiness, 1),
        snapshotDate: start,
    };
}

function dateToIso(date: Date | null | undefined) {
    if (!date) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateToYmd(date: Date | null | undefined) {
    return dateToIso(date).replace(/\D/g, '');
}

function isApprovedHanwhaStatus(value: string | null | undefined) {
    return (value ?? '').trim() === '승인';
}

function normalizeOrderMatchText(value: string | null | undefined) {
    return (value ?? '')
        .replace(/[\s()[\]{}.,/\\_-]/g, '')
        .toUpperCase();
}

function dispatchRowKey(row: {
    indoChiIndex: number;
    indoChiName: string;
    materialNameRaw: string | null;
    materialName: string | null;
    quantityKg: number | null;
}) {
    return [
        row.indoChiIndex,
        row.indoChiName,
        row.materialNameRaw ?? '',
        row.materialName ?? '',
        row.quantityKg ?? '',
    ].join('|');
}

function safeJsonArray(value: string | null | undefined): string[] {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
        return [];
    }
}

function safeDetailLines(value: string | null | undefined): HanwhaESalesOrderDetailLine[] {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed)) return [];
        return parsed.map((line) => ({
            itemCode: typeof line?.itemCode === 'string' ? line.itemCode : '',
            materialName: typeof line?.materialName === 'string' ? line.materialName : '',
            quantity: typeof line?.quantity === 'number' && Number.isFinite(line.quantity) ? line.quantity : null,
            deliveryDate: typeof line?.deliveryDate === 'string' ? line.deliveryDate : '',
            cells: Array.isArray(line?.cells) ? line.cells.filter((cell: unknown): cell is string => typeof cell === 'string') : [],
        }));
    } catch {
        return [];
    }
}

function rowMatchesShipTo(row: TodayShipmentSnapshotRowForMatch, shipToName: string) {
    const target = normalizeOrderMatchText(shipToName);
    if (!target) return false;

    const cellHits = row.rawCells
        .map(normalizeOrderMatchText)
        .filter(Boolean)
        .some((cell) => cell === target || (cell.length >= 4 && (cell.includes(target) || target.includes(cell))));
    if (cellHits) return true;

    return normalizeOrderMatchText(row.rowText).includes(target);
}

function matchStatusForOrder(
    snapshot: TodayShipmentSnapshotForMatch | null,
    shipToName: string,
    expectedItems: HanwhaESalesOrderStatusItem[],
    targetDeliveryDateYmd: string,
) {
    if (!snapshot || snapshot.status !== 'OK') return null;

    const shipToRows = snapshot.rows.filter((row) => rowMatchesShipTo(row, shipToName));
    const matchedRows = shipToRows.filter((row) =>
        hanwhaOrderStatusItemsMatch(row.detailLines, expectedItems, targetDeliveryDateYmd)
    );

    if (matchedRows.length !== 1) return null;
    const matched = matchedRows[0];
    return {
        statusText: matched.statusText || '상태 없음',
        rowText: matched.rowText ?? null,
        matchedRowId: matched.id,
    };
}

async function loadTodayShipmentSnapshot(orderDate: Date, targetDeliveryDate: Date): Promise<TodayShipmentSnapshotForMatch | null> {
    const snapshot = await prisma.hanwhaTodayShipmentSnapshot.findUnique({
        where: { orderDate_targetDeliveryDate: { orderDate, targetDeliveryDate } },
        include: { rows: { orderBy: [{ rowIndex: 'asc' }, { id: 'asc' }] } },
    });
    if (!snapshot) return null;

    return {
        id: snapshot.id,
        fetchedAt: snapshot.fetchedAt,
        status: snapshot.status,
        errorMessage: snapshot.errorMessage,
        rowCount: snapshot.rowCount,
        rows: snapshot.rows.map((row) => ({
            id: row.id,
            rowIndex: row.rowIndex,
            orderNo: row.orderNo,
            shipToName: row.shipToName,
            statusText: row.statusText,
            deliveryDateYmd: row.deliveryDateYmd,
            rawCells: safeJsonArray(row.rawCells),
            rowText: row.rowText,
            detailLines: safeDetailLines(row.detailLines),
        })),
    };
}

function hanwhaStatusItemsFromOrderItems(items: Array<{
    requestedQuantity: number;
    approvedQuantity: number | null;
    unit: string | null;
    hanwhaBagType: string | null;
    product: {
        productName: string;
        productCode: string;
        hanwhaMaterialName: string | null;
        hanwhaItemCode: string | null;
    };
}>): HanwhaESalesOrderStatusItem[] {
    return items.map((item) => ({
        materialName: resolveHanwhaMaterialName({
            productName: item.product.productName,
            productCode: item.product.productCode,
            explicitMaterialName: item.product.hanwhaMaterialName,
            bagType: resolveHanwhaBagType(item.hanwhaBagType, item.product.productName),
        }),
        itemCode: item.product.hanwhaItemCode,
        quantity: quantityToMetricTon(item.approvedQuantity ?? item.requestedQuantity, item.unit),
    }));
}

export async function executeBackgroundJob(job: BackgroundJob) {
    if (job.type === BACKGROUND_JOB_TYPES.HANWHA_NEW_ORDER) {
        await executeHanwhaNewOrderJobInBackground(job);
        return;
    }
    if (job.type === BACKGROUND_JOB_TYPES.HANWHA_DISPATCH_FETCH) {
        await executeHanwhaDispatchFetchJob(job);
        return;
    }
    if (job.type === BACKGROUND_JOB_TYPES.HANWHA_ORDER_STATUS_CHECK) {
        await executeHanwhaOrderStatusJob(job);
        return;
    }
    if (job.type === BACKGROUND_JOB_TYPES.HANWHA_TODAY_SHIPMENT_FETCH) {
        await executeHanwhaTodayShipmentFetchJob(job);
        return;
    }
    throw new Error(`Unsupported background job type: ${job.type}`);
}

async function executeHanwhaNewOrderJobInBackground(job: BackgroundJob) {
    const metadata = parseJobJsonAs<HanwhaNewOrderJobMetadata>(job.metadata);
    if (!metadata?.orderId) throw new Error('Order id is required.');

    await prisma.backgroundJob.update({
        where: { id: job.id },
        data: {
            message: '\uD55C\uD654 e-Sales \uC8FC\uBB38 \uC785\uB825\uC744 \uC9C4\uD589 \uC911\uC785\uB2C8\uB2E4.',
            heartbeatAt: new Date(),
            progress: 20,
        },
    });

    try {
        const result = await runHanwhaAutomationQueued(
            `\uD55C\uD654\uC624\uB354 ${job.title}`,
            () => executeHanwhaNewOrderJob({ ...metadata, requestedByUserId: job.requestedByUserId }),
        );
        await updateBackgroundJobResult(job.id, 'DONE', {
            message: result.message,
            result: { orderId: metadata.orderId },
        });
        await createJobNotification(job.id, {
            requestedByUserId: job.requestedByUserId,
            title: '\uD55C\uD654\uC624\uB354 \uC644\uB8CC',
            message: result.message,
            notificationType: 'BACKGROUND_JOB_DONE',
            metadata: { jobType: job.type, orderId: metadata.orderId },
        });
    } catch (error) {
        if (error instanceof HanwhaProductSelectionRequiredError) {
            const waitingMetadata: HanwhaNewOrderJobMetadata = {
                ...metadata,
                resumeInput: error.resumeInput,
                resumeRowIndex: error.resumeRowIndex,
                manualAction: 'PRODUCT_SELECTION',
                manualTitle: error.manualTitle,
                manualButtonLabel: error.manualButtonLabel,
            };
            await prisma.backgroundJob.update({
                where: { id: job.id },
                data: {
                    status: 'WAITING_MANUAL_ACTION',
                    message: error.message,
                    error: null,
                    metadata: JSON.stringify(waitingMetadata),
                    heartbeatAt: new Date(),
                    lockedAt: null,
                    lockedBy: null,
                },
            });
            await createJobNotification(job.id, {
                requestedByUserId: job.requestedByUserId,
                title: '\uD55C\uD654\uC624\uB354 \uD488\uBAA9 \uC120\uD0DD \uD544\uC694',
                message: error.message,
                notificationType: 'BACKGROUND_JOB_WAITING_MANUAL_ACTION',
                metadata: { jobType: job.type, orderId: metadata.orderId },
            });
            return;
        }
        throw error;
    }
}

async function executeHanwhaDispatchFetchJob(job: BackgroundJob) {
    const metadata = parseJobJsonAs<DispatchFetchMetadata>(job.metadata);
    const isoDate = metadata?.isoDate;
    if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
        throw new Error('Invalid dispatch date.');
    }

    const dispatchDate = new Date(`${isoDate}T00:00:00`);
    const username = await getHanwhaUsername();
    const password = await getHanwhaPassword();

    await prisma.backgroundJob.update({
        where: { id: job.id },
        data: { message: '한화 H-CRM 배차 조회를 실행 중입니다.', heartbeatAt: new Date(), progress: 30 },
    });

    const result = await runHanwhaAutomationQueued(
        `배차 조회 ${isoDate}`,
        () => scrapeHanwhaDispatch(isoDate, { username, password }),
    );

    if (!result.ok) {
        const friendly =
            result.errorCode === 'AUTH_FAILED'
                ? '한화 H-CRM 자동 로그인에 실패했습니다. 한화 사이트 비밀번호 확인이 필요합니다.'
                : result.errorCode === 'NO_CREDENTIALS'
                    ? '한화 계정 정보가 등록되어 있지 않습니다.'
                    : (result.error ?? '알 수 없는 오류가 발생했습니다.');

        const failedSnapshot = await prisma.hanwhaDispatchSnapshot.upsert({
            where: { dispatchDate },
            update: {
                fetchedAt: new Date(),
                fetchedByUserId: job.requestedByUserId,
                status: result.errorCode === 'AUTH_FAILED' ? 'AUTH_FAILED' : 'FAILED',
                errorMessage: friendly,
                rowCount: 0,
            },
            create: {
                dispatchDate,
                fetchedByUserId: job.requestedByUserId,
                status: result.errorCode === 'AUTH_FAILED' ? 'AUTH_FAILED' : 'FAILED',
                errorMessage: friendly,
            },
        });

        await updateBackgroundJobResult(job.id, 'FAILED', {
            error: friendly,
            result: { snapshotId: failedSnapshot.id, errorCode: result.errorCode },
        });
        await createJobNotification(job.id, {
            requestedByUserId: job.requestedByUserId,
            title: '배차조회 실패',
            message: friendly,
            notificationType: 'BACKGROUND_JOB_FAILED',
            metadata: { jobType: job.type, isoDate },
        });
        return;
    }

    const totalRows = result.rows.reduce((sum, indoChi) => sum + indoChi.lines.length, 0);
    const previousRows = await prisma.hanwhaDispatchRow.findMany({
        where: { snapshot: { dispatchDate } },
        select: {
            indoChiIndex: true,
            indoChiName: true,
            materialNameRaw: true,
            materialName: true,
            quantityKg: true,
            matchedOrderId: true,
            matchedAt: true,
            matchedByUserId: true,
        },
    });
    const previousMatches = new Map(
        previousRows
            .filter((row) => row.matchedOrderId)
            .map((row) => [dispatchRowKey(row), row]),
    );

    const snapshot = await prisma.$transaction(async (tx) => {
        await tx.hanwhaDispatchSnapshot.deleteMany({ where: { dispatchDate } });
        const snap = await tx.hanwhaDispatchSnapshot.create({
            data: {
                dispatchDate,
                fetchedAt: new Date(),
                fetchedByUserId: job.requestedByUserId,
                status: 'OK',
                rowCount: totalRows,
            },
        });

        for (const indoChi of result.rows) {
            for (const line of indoChi.lines) {
                const match = previousMatches.get(dispatchRowKey({
                    indoChiIndex: indoChi.indoChiIndex,
                    indoChiName: indoChi.indoChiName,
                    materialNameRaw: line.materialNameRaw,
                    materialName: line.materialName,
                    quantityKg: line.quantityKg,
                }));

                await tx.hanwhaDispatchRow.create({
                    data: {
                        snapshotId: snap.id,
                        indoChiIndex: indoChi.indoChiIndex,
                        indoChiName: indoChi.indoChiName,
                        materialNameRaw: line.materialNameRaw,
                        materialName: line.materialName,
                        quantityKg: line.quantityKg,
                        rawCells: JSON.stringify(line.rawCells),
                        matchedOrderId: match?.matchedOrderId ?? null,
                        matchedAt: match?.matchedAt ?? null,
                        matchedByUserId: match?.matchedByUserId ?? null,
                    },
                });
            }
        }
        return snap;
    });

    await prisma.backgroundJob.update({
        where: { id: job.id },
        data: {
            message: '기사정보와 출고완료 상태가 모두 확인된 미매칭 배차 행을 자동 매칭 중입니다.',
            heartbeatAt: new Date(),
            progress: 85,
        },
    });
    const autoMatch = await autoMatchHanwhaDispatchSnapshot(snapshot.id, job.requestedByUserId);

    await updateBackgroundJobResult(job.id, 'DONE', {
        message: `배차조회가 완료되었습니다. ${totalRows}건을 저장했고, 기사정보와 출고완료 조건 ${autoMatch.eligible}건 중 ${autoMatch.matched}건을 자동 매칭했습니다.`,
        result: { snapshotId: snapshot.id, rowCount: totalRows, isoDate, autoMatch },
    });
    await createJobNotification(job.id, {
        requestedByUserId: job.requestedByUserId,
        title: '배차조회 완료',
        message: `${isoDate} 배차조회 ${totalRows}건 완료 · 자동매칭 대상 ${autoMatch.eligible}건 / 완료 ${autoMatch.matched}건`,
        notificationType: 'BACKGROUND_JOB_DONE',
        metadata: { jobType: job.type, snapshotId: snapshot.id, isoDate, autoMatch },
    });
}

async function executeHanwhaOrderStatusJob(job: BackgroundJob) {
    const metadata = parseJobJsonAs<OrderStatusMetadata>(job.metadata);
    const orderId = metadata?.orderId ?? job.entityId;
    if (!orderId) throw new Error('Order id is required.');

    const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
            id: true,
            orderNo: true,
            createdAt: true,
            requestedDeliveryDate: true,
            hanwhaStatusText: true,
            hanwhaStatusRowText: true,
            deletedAt: true,
            customer: { select: { companyName: true } },
            deliveryAddress: { select: { label: true } },
            items: {
                select: {
                    requestedQuantity: true,
                    approvedQuantity: true,
                    unit: true,
                    hanwhaBagType: true,
                    purchaseLedgerDate: true,
                    purchaseSupplier: { select: { supplierName: true } },
                    product: {
                        select: {
                            productName: true,
                            productCode: true,
                            hanwhaMaterialName: true,
                            hanwhaItemCode: true,
                        },
                    },
                },
            },
        },
    });

    if (!order || order.deletedAt) throw new Error('주문을 찾을 수 없습니다.');
    if (!order.requestedDeliveryDate) throw new Error('도착일자가 없어 한화 주문상태를 확인할 수 없습니다.');

    if (isApprovedHanwhaStatus(order.hanwhaStatusText)) {
        await updateBackgroundJobResult(job.id, 'DONE', {
            message: '한화 e-Sales 주문상태를 확인했습니다. 현재 상태: 승인',
            result: { orderId: order.id, status: '승인', rowText: order.hanwhaStatusRowText ?? '' },
        });
        return;
    }

    const hanwhaItems = order.items.filter(isHanwhaOrderItem);
    if (hanwhaItems.length === 0) {
        throw new Error('한화 주문상태를 확인할 한화 품목이 없습니다.');
    }

    await prisma.backgroundJob.update({
        where: { id: job.id },
        data: { message: `${order.orderNo} 한화 주문상태를 조회 중입니다.`, heartbeatAt: new Date(), progress: 40 },
    });

    const purchaseDateCandidates = hanwhaItems
        .map((item) => item.purchaseLedgerDate ?? purchaseRequestDateFromOrderNo(order.orderNo) ?? order.createdAt)
        .filter((date): date is Date => !!date);
    const startDateCandidates = [order.createdAt, ...purchaseDateCandidates];
    const orderDateFrom = startDateCandidates
        .reduce((earliest, candidate) => candidate.getTime() < earliest.getTime() ? candidate : earliest, startDateCandidates[0]);
    const orderDateTo = order.requestedDeliveryDate;
    const shipToName = order.deliveryAddress.label || order.customer.companyName;

    const result = await runHanwhaAutomationQueued(
        `주문상태조회 ${order.orderNo}`,
        async () => checkHanwhaESalesOrderStatus({
            username: await getHanwhaUsername(),
            password: await getHanwhaPassword(),
            orderDateFromYmd: dateToYmd(orderDateFrom),
            orderDateToYmd: dateToYmd(orderDateTo),
            shipToName,
            deliveryDateYmd: dateToYmd(order.requestedDeliveryDate),
            items: hanwhaStatusItemsFromOrderItems(hanwhaItems),
        }),
    );

    if (!result.ok) throw new Error(result.error);

    await prisma.order.update({
        where: { id: order.id },
        data: {
            hanwhaStatusText: result.status,
            hanwhaStatusRowText: result.rowText,
            hanwhaStatusCheckedAt: new Date(),
            hanwhaStatusSource: 'ORDER_DETAIL_CHECK',
        },
    });

    await updateBackgroundJobResult(job.id, 'DONE', {
        message: result.message,
        result: {
            orderId: order.id,
            orderNo: order.orderNo,
            status: result.status,
            rowText: result.rowText,
        },
    });
    await createJobNotification(job.id, {
        requestedByUserId: job.requestedByUserId,
        title: '주문상태확인 완료',
        message: `${order.orderNo} 한화 주문상태: ${result.status}`,
        notificationType: 'BACKGROUND_JOB_DONE',
        metadata: { jobType: job.type, orderId: order.id, orderNo: order.orderNo },
    });
}

async function executeHanwhaTodayShipmentFetchJob(job: BackgroundJob) {
    const metadata = parseJobJsonAs<TodayShipmentMetadata>(job.metadata);
    const orderDate = dateOnly(parseIsoDate(metadata?.orderDateIso));
    const orderDateIso = dateToIso(orderDate);
    const deliveryWindow = todayShipmentDeliveryWindow(orderDate);
    const targetStart = deliveryWindow.start;
    const targetEnd = deliveryWindow.end;
    const sameDayEnd = addDays(orderDate, 1);

    await prisma.backgroundJob.update({
        where: { id: job.id },
        data: { message: `${orderDateIso} 금일출고예정 상태를 조회 중입니다.`, heartbeatAt: new Date(), progress: 25 },
    });

    const statusTargetOrders = await prisma.order.findMany({
        where: {
            deletedAt: null,
            OR: [
                { requestedDeliveryDate: { gte: targetStart, lt: targetEnd } },
                {
                    sameDayDelivery: true,
                    requestedDeliveryDate: { gte: orderDate, lt: sameDayEnd },
                },
            ],
            status: { not: 'REJECTED' },
        },
        include: {
            customer: { select: { companyName: true } },
            deliveryAddress: { select: { label: true } },
            items: {
                include: {
                    purchaseSupplier: { select: { supplierName: true } },
                    product: {
                        select: {
                            productName: true,
                            productCode: true,
                            hanwhaMaterialName: true,
                            hanwhaItemCode: true,
                        },
                    },
                },
            },
        },
    });

    const hanwhaStatusOrders = statusTargetOrders.filter((order) =>
        Boolean(order.hanwhaOrderedAt) && order.items.some(isHanwhaOrderItem)
    );
    const hanwhaOrderDateYmds = Array.from(new Set(
        hanwhaStatusOrders
            .map((order) => dateToYmd(order.hanwhaOrderedAt))
            .filter(Boolean),
    )).sort();
    const orderDateFromYmd = hanwhaOrderDateYmds[0] ?? null;
    const orderDateToYmd = dateToYmd(orderDate);
    const targetDeliveryDateYmds = Array.from(new Set(
        hanwhaStatusOrders
            .map((order) => dateToYmd(order.requestedDeliveryDate))
            .filter(Boolean),
    )).sort();

    const result = orderDateFromYmd && targetDeliveryDateYmds.length > 0
        ? await runHanwhaAutomationQueued(
            `금일 출고예정 상태조회 ${orderDateIso}`,
            async () => scrapeHanwhaESalesShipmentStatusesByOrderDateRange({
                username: await getHanwhaUsername(),
                password: await getHanwhaPassword(),
                orderDateFromYmd,
                orderDateToYmd,
                targetDeliveryDateYmds,
            }),
        )
        : { ok: true as const, message: 'e-Sales 조회 대상 한화 오더가 없습니다.', rows: [] };

    if (!result.ok) {
        const status = result.errorCode === 'AUTH_FAILED' ? 'AUTH_FAILED' : 'FAILED';
        const failedSnapshot = await prisma.hanwhaTodayShipmentSnapshot.upsert({
            where: { orderDate_targetDeliveryDate: { orderDate, targetDeliveryDate: deliveryWindow.snapshotDate } },
            update: {
                fetchedAt: new Date(),
                fetchedByUserId: job.requestedByUserId,
                status,
                errorMessage: result.error,
                rowCount: 0,
            },
            create: {
                orderDate,
                targetDeliveryDate: deliveryWindow.snapshotDate,
                fetchedByUserId: job.requestedByUserId,
                status,
                errorMessage: result.error,
            },
        });
        await prisma.hanwhaTodayShipmentRow.deleteMany({ where: { snapshotId: failedSnapshot.id } });

        await updateBackgroundJobResult(job.id, 'FAILED', {
            error: result.error,
            result: { snapshotId: failedSnapshot.id, errorCode: result.errorCode, orderDateIso },
        });
        await createJobNotification(job.id, {
            requestedByUserId: job.requestedByUserId,
            title: '금일출고예정 조회 실패',
            message: result.error,
            notificationType: 'BACKGROUND_JOB_FAILED',
            metadata: { jobType: job.type, orderDateIso },
        });
        return;
    }

    const snapshot = await prisma.$transaction(async (tx) => {
        await tx.hanwhaTodayShipmentSnapshot.deleteMany({ where: { orderDate, targetDeliveryDate: deliveryWindow.snapshotDate } });
        const snap = await tx.hanwhaTodayShipmentSnapshot.create({
            data: {
                orderDate,
                targetDeliveryDate: deliveryWindow.snapshotDate,
                fetchedAt: new Date(),
                fetchedByUserId: job.requestedByUserId,
                status: 'OK',
                rowCount: result.rows.length,
            },
        });

        for (const row of result.rows) {
            await tx.hanwhaTodayShipmentRow.create({
                data: {
                    snapshotId: snap.id,
                    rowIndex: row.rowIndex,
                    orderNo: row.orderNo ?? null,
                    shipToName: row.shipToName ?? null,
                    statusText: row.status,
                    deliveryDateYmd: row.deliveryDateYmd ?? null,
                    rawCells: JSON.stringify(row.rawCells),
                    rowText: row.rowText,
                    detailLines: JSON.stringify(row.detailLines),
                },
            });
        }
        return snap;
    });

    const freshSnapshot = await loadTodayShipmentSnapshot(orderDate, deliveryWindow.snapshotDate);
    if (freshSnapshot?.status === 'OK') {
        const checkedAt = new Date();
        for (const order of hanwhaStatusOrders) {
            const hanwhaItems = order.items.filter(isHanwhaOrderItem);
            if (hanwhaItems.length === 0) continue;

            const shipToName = order.deliveryAddress.label || order.customer.companyName;
            const matchedStatus = matchStatusForOrder(
                freshSnapshot,
                shipToName,
                hanwhaStatusItemsFromOrderItems(hanwhaItems),
                dateToYmd(order.requestedDeliveryDate),
            );
            if (!matchedStatus) continue;

            await prisma.order.update({
                where: { id: order.id },
                data: {
                    hanwhaStatusText: matchedStatus.statusText,
                    hanwhaStatusRowText: matchedStatus.rowText,
                    hanwhaStatusCheckedAt: checkedAt,
                    hanwhaStatusSource: 'TODAY_SHIPPING',
                },
            });
        }
    }

    await updateBackgroundJobResult(job.id, 'DONE', {
        message: `금일출고예정 조회가 완료되었습니다. ${snapshot.rowCount}건을 저장했습니다.`,
        result: { snapshotId: snapshot.id, rowCount: snapshot.rowCount, orderDateIso },
    });
    await createJobNotification(job.id, {
        requestedByUserId: job.requestedByUserId,
        title: '금일출고예정 조회 완료',
        message: `${orderDateIso} 금일출고예정 조회 ${snapshot.rowCount}건이 완료되었습니다.`,
        notificationType: 'BACKGROUND_JOB_DONE',
        metadata: { jobType: job.type, snapshotId: snapshot.id, orderDateIso },
    });
}
