'use server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { nextBusinessDate } from '@/lib/korean-holidays';
import { resolveHanwhaMaterialName } from '@/lib/hanwha-material-map';
import {
    hanwhaOrderStatusItemsMatch,
    type HanwhaESalesOrderDetailLine,
    type HanwhaESalesOrderStatusItem,
} from '@/lib/hanwha-esales-login';
import { revalidatePath } from 'next/cache';
import {
    BACKGROUND_JOB_TYPES,
    enqueueBackgroundJob,
    parseJobJsonAs,
    toBackgroundJobView,
    type BackgroundJobView,
} from '@/lib/background-jobs';

type SnapshotRowForMatch = {
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

type SnapshotForMatch = {
    id: string;
    fetchedAt: Date;
    status: string;
    errorMessage: string | null;
    rowCount: number;
    rows: SnapshotRowForMatch[];
};

export type TodayShipmentItemVM = {
    productName: string;
    quantityTon: number;
    materialName: string;
    itemCode: string | null;
};

export type TodayShipmentOrderVM = {
    id: string;
    orderNo: string;
    customerName: string;
    shipToName: string;
    deliveryDate: string;
    sameDayDelivery: boolean;
    canManualApprove: boolean;
    items: TodayShipmentItemVM[];
    hanwhaStatus: string;
    matchState: 'NOT_FETCHED' | 'MATCHED' | 'NOT_FOUND' | 'MISMATCH' | 'AMBIGUOUS' | 'SNAPSHOT_FAILED' | 'NOT_HANWHA' | 'NO_HANWHA_ORDER_DATE';
    matchNote: string | null;
    matchedRowId: string | null;
};

export type TodayShipmentSnapshotVM = {
    id: string;
    fetchedAt: string;
    status: string;
    errorMessage: string | null;
    rowCount: number;
};

export type TodayShipmentView = {
    orderDate: string;
    targetDeliveryDate: string;
    snapshot: TodayShipmentSnapshotVM | null;
    orders: TodayShipmentOrderVM[];
};

export type TodayShipmentFetchResult =
    | { ok: true; cached: boolean; rowCount: number; view: TodayShipmentView }
    | { ok: true; queued: true; job: BackgroundJobView; cached: false; view: TodayShipmentView; message: string }
    | { ok: false; error: string; errorCode?: string; view?: TodayShipmentView };

export type TodayShipmentJobStatusResult =
    | { ok: true; job: BackgroundJobView; view: TodayShipmentView }
    | { ok: false; error: string };

function dateOnly(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dateToIso(date: Date | null | undefined) {
    if (!date) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateToYmd(date: Date | null | undefined) {
    return dateToIso(date).replace(/\D/g, '');
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

function normalizePersonName(value: string | null | undefined) {
    return (value ?? '').replace(/\s/g, '');
}

function isYangHeeCheol(user: { userKind?: string; name?: string | null } | null | undefined) {
    return user?.userKind === 'staff' && normalizePersonName(user.name) === '양희철';
}

function isApprovedHanwhaStatus(value: string | null | undefined) {
    return (value ?? '').trim() === '승인';
}

function normalizeCompanyName(value: string | null | undefined) {
    return (value ?? '')
        .replace(/주식회사|\(주\)|㈜/g, '')
        .replace(/\s|[()]/g, '')
        .trim();
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

function isHanwhaSupplierName(value: string | null | undefined) {
    const normalized = normalizeCompanyName(value);
    return normalized === '한화솔루션' || normalized.includes('한화솔루션');
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
    if (normalizedUnit === 'KG') return quantity / 1000;
    return quantity;
}

function normalizeOrderMatchText(value: string | null | undefined) {
    return (value ?? '')
        .replace(/[\s()[\]{}.,/\\_-]/g, '')
        .toUpperCase();
}

function rowMatchesShipTo(row: SnapshotRowForMatch, shipToName: string) {
    const target = normalizeOrderMatchText(shipToName);
    if (!target) return false;
    const cellHits = row.rawCells
        .map(normalizeOrderMatchText)
        .filter(Boolean)
        .some((cell) => cell === target || (cell.length >= 4 && (cell.includes(target) || target.includes(cell))));
    if (cellHits) return true;
    return normalizeOrderMatchText(row.rowText).includes(target);
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

async function loadSnapshot(orderDate: Date, targetDeliveryDate: Date): Promise<SnapshotForMatch | null> {
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

function snapshotToVM(snapshot: SnapshotForMatch | null): TodayShipmentSnapshotVM | null {
    if (!snapshot) return null;
    return {
        id: snapshot.id,
        fetchedAt: snapshot.fetchedAt.toISOString(),
        status: snapshot.status,
        errorMessage: snapshot.errorMessage,
        rowCount: snapshot.rowCount,
    };
}

function matchStatusForOrder(
    snapshot: SnapshotForMatch | null,
    shipToName: string,
    expectedItems: HanwhaESalesOrderStatusItem[],
    targetDeliveryDateYmd: string,
) {
    if (!snapshot) {
        return {
            hanwhaStatus: '상태 미조회',
            matchState: 'NOT_FETCHED' as const,
            matchNote: '한화 상태조회 버튼을 눌러 현재 상태를 가져오세요.',
            matchedRowId: null,
        };
    }
    if (snapshot.status !== 'OK') {
        return {
            hanwhaStatus: '조회 실패',
            matchState: 'SNAPSHOT_FAILED' as const,
            matchNote: snapshot.errorMessage,
            matchedRowId: null,
        };
    }

    const shipToRows = snapshot.rows.filter((row) => rowMatchesShipTo(row, shipToName));
    const matchedRows = shipToRows.filter((row) =>
        hanwhaOrderStatusItemsMatch(row.detailLines, expectedItems, targetDeliveryDateYmd)
    );

    if (matchedRows.length === 1) {
        const matched = matchedRows[0];
        return {
            hanwhaStatus: matched.statusText || '상태 없음',
            matchState: 'MATCHED' as const,
            matchNote: null,
            matchedRowId: matched.id,
        };
    }
    if (matchedRows.length > 1) {
        const statuses = Array.from(new Set(matchedRows.map((row) => row.statusText).filter(Boolean)));
        return {
            hanwhaStatus: statuses.join(', ') || '후보 중복',
            matchState: 'AMBIGUOUS' as const,
            matchNote: `같은 조건의 한화 주문 후보가 ${matchedRows.length}건입니다.`,
            matchedRowId: null,
        };
    }
    if (shipToRows.length > 0) {
        return {
            hanwhaStatus: '확인 필요',
            matchState: 'MISMATCH' as const,
            matchNote: '도착지는 찾았지만 품목/수량/도착일이 일치하는 행을 찾지 못했습니다.',
            matchedRowId: null,
        };
    }
    return {
        hanwhaStatus: 'e-Sales 미조회',
        matchState: 'NOT_FOUND' as const,
        matchNote: '한화 주문 진행 조회에서 도착지에 맞는 행을 찾지 못했습니다.',
        matchedRowId: null,
    };
}

function excludedStatusForOrder(hasHanwhaItems: boolean, hanwhaOrderedAt: Date | null | undefined) {
    if (!hasHanwhaItems) {
        return {
            hanwhaStatus: '한화 조회 제외',
            matchState: 'NOT_HANWHA' as const,
            matchNote: '한화 매입 품목이 아니어서 e-Sales 상태조회 대상에서 제외했습니다.',
            matchedRowId: null,
        };
    }
    if (!hanwhaOrderedAt) {
        return {
            hanwhaStatus: '한화 오더일자 없음',
            matchState: 'NO_HANWHA_ORDER_DATE' as const,
            matchNote: '한화 오더완료일자가 없어 e-Sales 자동 매칭에서 제외했습니다.',
            matchedRowId: null,
        };
    }
    return null;
}

export async function getTodayShipmentView(orderDateIso?: string): Promise<TodayShipmentView> {
    const session = await auth();
    const canManualApprove = isYangHeeCheol(session?.user);
    const orderDate = dateOnly(parseIsoDate(orderDateIso));
    const deliveryWindow = todayShipmentDeliveryWindow(orderDate);
    const sameDayEnd = addDays(orderDate, 1);
    const targetStart = deliveryWindow.start;
    const targetEnd = deliveryWindow.end;
    const snapshot = await loadSnapshot(orderDate, deliveryWindow.snapshotDate);

    const rawOrders = await prisma.order.findMany({
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
        orderBy: [{ requestedDeliveryDate: 'asc' }, { createdAt: 'desc' }],
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

    const orders = rawOrders.flatMap((order) => {
        const hanwhaItems = order.items.filter(isHanwhaOrderItem);
        const shipToName = order.deliveryAddress.label || order.customer.companyName;
        const expectedItems = hanwhaItems.map((item) => {
            const materialName = resolveHanwhaMaterialName({
                productName: item.product.productName,
                productCode: item.product.productCode,
                explicitMaterialName: item.product.hanwhaMaterialName,
                bagType: resolveHanwhaBagType(item.hanwhaBagType, item.product.productName),
            });
            return {
                materialName,
                itemCode: item.product.hanwhaItemCode,
                quantity: quantityToMetricTon(item.approvedQuantity ?? item.requestedQuantity, item.unit),
            };
        });
        const excludedStatus = excludedStatusForOrder(hanwhaItems.length > 0, order.hanwhaOrderedAt);
        const cachedApprovedStatus = isApprovedHanwhaStatus(order.hanwhaStatusText)
            ? {
                hanwhaStatus: '승인',
                matchState: 'MATCHED' as const,
                matchNote: null,
                matchedRowId: null,
            }
            : null;
        const status = cachedApprovedStatus ?? excludedStatus ?? matchStatusForOrder(snapshot, shipToName, expectedItems, dateToYmd(order.requestedDeliveryDate));
        return [{
            id: order.id,
            orderNo: order.orderNo,
            customerName: order.customer.companyName,
            shipToName,
            deliveryDate: dateToIso(order.requestedDeliveryDate),
            sameDayDelivery: order.sameDayDelivery,
            canManualApprove,
            items: order.items.map((item) => ({
                productName: item.product.productName,
                quantityTon: quantityToMetricTon(item.approvedQuantity ?? item.requestedQuantity, item.unit),
                materialName: hanwhaItems.includes(item)
                    ? resolveHanwhaMaterialName({
                        productName: item.product.productName,
                        productCode: item.product.productCode,
                        explicitMaterialName: item.product.hanwhaMaterialName,
                        bagType: resolveHanwhaBagType(item.hanwhaBagType, item.product.productName),
                    })
                    : '',
                itemCode: item.product.hanwhaItemCode,
            })),
            ...status,
        }];
    });

    return {
        orderDate: dateToIso(orderDate),
        targetDeliveryDate: dateToIso(deliveryWindow.snapshotDate),
        snapshot: snapshotToVM(snapshot),
        orders,
    };
}

export async function fetchHanwhaTodayShipmentStatus(orderDateIso: string, force = false): Promise<TodayShipmentFetchResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff') return { ok: false, error: '직원만 조회할 수 있습니다.' };

    const orderDate = dateOnly(parseIsoDate(orderDateIso));
    const deliveryWindow = todayShipmentDeliveryWindow(orderDate);
    const sameDayEnd = addDays(orderDate, 1);
    const targetStart = deliveryWindow.start;
    const targetEnd = deliveryWindow.end;

    const cached = await loadSnapshot(orderDate, deliveryWindow.snapshotDate);
    if (cached && cached.status === 'OK' && !force) {
        return {
            ok: true,
            cached: true,
            rowCount: cached.rowCount,
            view: await getTodayShipmentView(dateToIso(orderDate)),
        };
    }

    const { job, created } = await enqueueBackgroundJob({
        type: BACKGROUND_JOB_TYPES.HANWHA_TODAY_SHIPMENT_FETCH,
        queueKey: `HANWHA_TODAY_SHIPMENT:${dateToIso(orderDate)}`,
        entityType: 'TODAY_SHIPMENT_DATE',
        entityId: dateToIso(orderDate),
        title: `금일출고예정 ${dateToIso(orderDate)}`,
        message: force
            ? '금일출고예정 재조회를 백그라운드에서 진행합니다.'
            : '금일출고예정 조회를 백그라운드에서 진행합니다.',
        requestedByUserId: session.user.id,
        metadata: {
            orderDateIso: dateToIso(orderDate),
            force,
            targetDeliveryDateIso: dateToIso(deliveryWindow.snapshotDate),
            targetDeliveryDateFromIso: dateToIso(targetStart),
            targetDeliveryDateToIso: dateToIso(addDays(targetEnd, -1)),
            sameDayEndIso: dateToIso(sameDayEnd),
        },
    });

    return {
        ok: true,
        queued: true,
        cached: false,
        job: toBackgroundJobView(job),
        view: await getTodayShipmentView(dateToIso(orderDate)),
        message: created
            ? '금일출고예정 조회 작업을 등록했습니다. 완료되면 자동으로 반영됩니다.'
            : '같은 날짜의 금일출고예정 조회가 이미 진행 중입니다. 완료되면 같은 결과를 표시합니다.',
    };

}

/*
 * Legacy synchronous e-Sales fetch path kept for reference while the worker
 * rollout settles. The active path above now enqueues a BackgroundJob instead.
 *
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
        ? await (async () => {
            if (isHanwhaAutomationBusy()) {
                return { ok: false as const, error: '이미 한화 e-Sales 자동화가 진행중입니다. 잠시 후 조회해주세요.', errorCode: 'BUSY' };
            }

            const username = await getHanwhaUsername();
            const password = await getHanwhaPassword();
            return runHanwhaAutomationQueued(
                `금일 출고예정 상태조회 ${dateToIso(orderDate)}`,
                () => scrapeHanwhaESalesShipmentStatusesByOrderDateRange({
                    username,
                    password,
                    orderDateFromYmd,
                    orderDateToYmd,
                    targetDeliveryDateYmds,
                }),
            );
        })()
        : { ok: true as const, message: 'e-Sales 조회 대상 한화 오더가 없습니다.', rows: [] };

    if (!result.ok) {
        const status = result.errorCode === 'AUTH_FAILED' ? 'AUTH_FAILED' : 'FAILED';
        const failedSnapshot = await prisma.hanwhaTodayShipmentSnapshot.upsert({
            where: { orderDate_targetDeliveryDate: { orderDate, targetDeliveryDate: targetStart } },
            update: {
                fetchedAt: new Date(),
                fetchedByUserId: session.user.id,
                status,
                errorMessage: result.error,
                rowCount: 0,
            },
            create: {
                orderDate,
                targetDeliveryDate: targetStart,
                fetchedByUserId: session.user.id,
                status,
                errorMessage: result.error,
            },
        });
        await prisma.hanwhaTodayShipmentRow.deleteMany({ where: { snapshotId: failedSnapshot.id } });
        revalidatePath('/admin/today-shipping');
        return {
            ok: false,
            error: result.error,
            errorCode: result.errorCode,
            view: await getTodayShipmentView(dateToIso(orderDate)),
        };
    }

    const snapshot = await prisma.$transaction(async (tx) => {
        await tx.hanwhaTodayShipmentSnapshot.deleteMany({ where: { orderDate, targetDeliveryDate: targetStart } });
        const snap = await tx.hanwhaTodayShipmentSnapshot.create({
            data: {
                orderDate,
                targetDeliveryDate: targetStart,
                fetchedAt: new Date(),
                fetchedByUserId: session.user.id,
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

    const freshSnapshot = await loadSnapshot(orderDate, targetStart);
    if (freshSnapshot?.status === 'OK') {
        const checkedAt = new Date();
        for (const order of hanwhaStatusOrders) {
            const hanwhaItems = order.items.filter(isHanwhaOrderItem);
            if (hanwhaItems.length === 0) continue;

            const shipToName = order.deliveryAddress.label || order.customer.companyName;
            const expectedItems = hanwhaItems.map((item) => ({
                materialName: resolveHanwhaMaterialName({
                    productName: item.product.productName,
                    productCode: item.product.productCode,
                    explicitMaterialName: item.product.hanwhaMaterialName,
                    bagType: resolveHanwhaBagType(item.hanwhaBagType, item.product.productName),
                }),
                itemCode: item.product.hanwhaItemCode,
                quantity: quantityToMetricTon(item.approvedQuantity ?? item.requestedQuantity, item.unit),
            }));
            const matchedStatus = matchStatusForOrder(freshSnapshot, shipToName, expectedItems, dateToYmd(order.requestedDeliveryDate));
            if (matchedStatus.matchState !== 'MATCHED') continue;

            const matchedRow = freshSnapshot.rows.find((row) => row.id === matchedStatus.matchedRowId);
            await prisma.order.update({
                where: { id: order.id },
                data: {
                    hanwhaStatusText: matchedStatus.hanwhaStatus,
                    hanwhaStatusRowText: matchedRow?.rowText ?? null,
                    hanwhaStatusCheckedAt: checkedAt,
                    hanwhaStatusSource: 'TODAY_SHIPPING',
                },
            });
        }
    }

    revalidatePath('/admin/today-shipping');
    return {
        ok: true,
        cached: false,
        rowCount: snapshot.rowCount,
        view: await getTodayShipmentView(dateToIso(orderDate)),
    };
}
*/

export async function refetchHanwhaTodayShipmentStatus(orderDateIso: string) {
    return fetchHanwhaTodayShipmentStatus(orderDateIso, true);
}

export async function getHanwhaTodayShipmentJobStatus(jobId: string): Promise<TodayShipmentJobStatusResult> {
    const session = await auth();
    if (!session?.user || session.user.userKind !== 'staff') return { ok: false, error: '권한이 없습니다.' };

    const job = await prisma.backgroundJob.findUnique({ where: { id: jobId } });
    if (!job) return { ok: false, error: '금일출고예정 조회 작업을 찾을 수 없습니다.' };

    const metadata = parseJobJsonAs<{ orderDateIso?: string }>(job.metadata);
    return {
        ok: true,
        job: toBackgroundJobView(job),
        view: await getTodayShipmentView(metadata?.orderDateIso),
    };
}

export async function approveTodayShipmentOrder(orderId: string): Promise<TodayShipmentFetchResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (!isYangHeeCheol(session.user)) {
        return { ok: false, error: '양희철만 금일 출고예정 승인처리를 할 수 있습니다.' };
    }

    const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
            id: true,
            orderNo: true,
            status: true,
            deletedAt: true,
            requestedDeliveryDate: true,
        },
    });
    if (!order || order.deletedAt) return { ok: false, error: '주문을 찾을 수 없습니다.' };

    const now = new Date();
    await prisma.$transaction(async (tx) => {
        await tx.order.update({
            where: { id: order.id },
            data: {
                hanwhaStatusText: '승인',
                hanwhaStatusRowText: '양희철 금일 출고예정 수동 승인처리',
                hanwhaStatusCheckedAt: now,
                hanwhaStatusSource: 'MANUAL_TODAY_SHIPPING',
                hanwhaStatusManualApprovedAt: now,
                hanwhaStatusManualApprovedById: session.user.id,
            },
        });
        await tx.orderStatusHistory.create({
            data: {
                orderId: order.id,
                previousStatus: order.status,
                newStatus: order.status,
                changedByUserId: session.user.id,
                changeReason: '[금일 출고예정] 양희철 수동 승인처리',
            },
        });
    });

    revalidatePath('/admin/today-shipping');
    revalidatePath(`/admin/orders/${order.id}`);
    return {
        ok: true,
        cached: false,
        rowCount: 0,
        view: await getTodayShipmentView(),
    };
}
