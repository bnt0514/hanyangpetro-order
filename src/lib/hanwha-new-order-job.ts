import { OrderStatus } from '@/shared/enums';
import { prisma } from '@/lib/db';
import {
    openHanwhaESalesOrder,
    prepareHanwhaESalesApprovalForOrders,
    requestHanwhaESalesApprovalForOrders,
    resumeHanwhaESalesOrderAfterProductSelection,
    type HanwhaESalesOrderInput,
} from '@/lib/hanwha-esales-login';
import { getHanwhaPassword, getHanwhaUsername } from '@/lib/hanwha-credentials';
import { resolveHanwhaMaterialName } from '@/lib/hanwha-material-map';
import { purchaseRequestDateFromOrderNo } from '@/lib/ledger-policy';

export type HanwhaNewOrderJobMetadata = {
    orderId: string;
    approveAfterOrder: boolean;
    forceReorder?: boolean;
    resumeInput?: HanwhaESalesOrderInput;
    resumeRowIndex?: number;
    manualAction?: 'PRODUCT_SELECTION';
    manualTitle?: string;
    manualButtonLabel?: string;
};

export class HanwhaProductSelectionRequiredError extends Error {
    constructor(
        message: string,
        readonly resumeInput: HanwhaESalesOrderInput,
        readonly resumeRowIndex: number,
        readonly manualTitle?: string,
        readonly manualButtonLabel?: string,
    ) {
        super(message);
        this.name = 'HanwhaProductSelectionRequiredError';
    }
}

function normalizeCompanyName(value: string | null | undefined) {
    return (value ?? '')
        .replace(/\uC8FC\uC2DD\uD68C\uC0AC|\(\uC8FC\)|\u321C/g, '')
        .replace(/\s|[()]/g, '')
        .trim();
}

function isHanwhaSupplierName(value: string | null | undefined) {
    const normalized = normalizeCompanyName(value);
    return normalized === '\uD55C\uD654\uC194\uB8E8\uC158' || normalized.includes('\uD55C\uD654\uC194\uB8E8\uC158');
}

function normalizeHanwhaBagType(value: string | null | undefined) {
    const bagType = value?.trim().toUpperCase();
    return bagType && ['FFS', 'FB500', 'FB700', 'FB750'].includes(bagType) ? bagType : null;
}

function normalizeProductForDefaultBag(value: string | null | undefined) {
    return (value ?? '').replace(/\s+/g, '').toUpperCase();
}

function resolveHanwhaBagType(value: string | null | undefined, productName: string | null | undefined) {
    const explicit = normalizeHanwhaBagType(value);
    if (explicit) return explicit;
    return normalizeProductForDefaultBag(productName) === 'MLLDPE<M1605EN>' ? 'FB700' : null;
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

function normalizeHanwhaItemName(value: string | null | undefined) {
    return (value ?? '').replace(/\s+/g, '').toUpperCase();
}

function normalizeHanwhaItemNameLoose(value: string | null | undefined) {
    return normalizeHanwhaItemName(value).replace(/[^A-Z0-9]/g, '');
}

function compactJoin(values: Array<string | null | undefined>, separator = ' ') {
    return values.filter((value): value is string => Boolean(value)).join(separator);
}

function dateToYmd(date: Date | null | undefined) {
    if (!date) return '';
    return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

function isLaterDate(a: Date | null | undefined, b: Date | null | undefined) {
    if (!a || !b) return false;
    return new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()
        > new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
}

function quantityToMetricTon(quantity: number, unit: string | null | undefined) {
    return (unit ?? '').trim().toUpperCase() === 'KG' ? quantity / 1000 : quantity;
}

function withPurchaseCarryoverSalesPrefix(value: string | null | undefined, date: Date | null | undefined) {
    if (!date) return value ?? null;
    const prefix = `${date.getMonth() + 1}\uC6D4\uB9E4\uCD9C`;
    const text = value?.trim() ?? '';
    if (!text || text.startsWith(prefix)) return text || prefix;
    return `${prefix} ${text}`;
}

async function runPostOrderStep(approveAfterOrder: boolean, hanwhaOrderNo?: string | null) {
    if (!hanwhaOrderNo?.trim()) {
        throw new Error('\uD55C\uD654 e-Sales \uC8FC\uBB38\uBC88\uD638\uB97C \uC77D\uC9C0 \uBABB\uD574 \uC8FC\uBB38 \uB9AC\uC2A4\uD2B8\uC5D0\uC11C \uD2B9\uC815 \uC8FC\uBB38\uB9CC \uC120\uD0DD\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.');
    }
    const input = {
        username: await getHanwhaUsername(),
        password: await getHanwhaPassword(),
        orderDateYmd: dateToYmd(new Date()),
        orderNo: hanwhaOrderNo,
    };
    const result = approveAfterOrder
        ? await requestHanwhaESalesApprovalForOrders(input)
        : await prepareHanwhaESalesApprovalForOrders(input);
    if (!result.ok) throw new Error(result.error);
    return result.message;
}

async function finalizeHanwhaOrder(input: {
    orderId: string;
    requestedByUserId?: string | null;
    approveAfterOrder: boolean;
    orderNo: string;
    itemCount?: number;
    message: string;
    manualProductSelection?: boolean;
}) {
    const currentOrder = await prisma.order.findUnique({
        where: { id: input.orderId },
        select: { status: true },
    });
    const previousStatus = currentOrder?.status ?? OrderStatus.APPROVED;
    const nextStatus = previousStatus === OrderStatus.APPROVED ? OrderStatus.DISPATCHING : previousStatus;
    await prisma.order.update({
        where: { id: input.orderId },
        data: { hanwhaOrderedAt: new Date(), status: nextStatus },
    });
    await prisma.orderStatusHistory.create({
        data: {
            orderId: input.orderId,
            previousStatus,
            newStatus: nextStatus,
            changedByUserId: input.requestedByUserId ?? undefined,
            changeReason: input.manualProductSelection
                ? `[\uD55C\uD654 e-Sales] \uC218\uB3D9 \uD488\uBAA9 \uC120\uD0DD \uD6C4 \uB300\uB9AC\uC810\uC624\uB354 \uC790\uB3D9 \uC785\uB825 \uBC0F ${input.approveAfterOrder ? '\uC2B9\uC778\uC694\uCCAD' : '\uC870\uD68C/\uCCB4\uD06C'} \uC644\uB8CC (${input.orderNo})`
                : `[\uD55C\uD654 e-Sales] \uB300\uB9AC\uC810\uC624\uB354 \uC790\uB3D9 \uC785\uB825 \uD6C4 \uC870\uD68C/\uCCB4\uD06C/${input.approveAfterOrder ? '\uC2B9\uC778\uC694\uCCAD' : '\uC900\uBE44'} \uC644\uB8CC (\uD55C\uD654\uC194\uB8E8\uC158 \uD488\uBAA9 ${input.itemCount ?? 0}\uAC74 / \uC8FC\uBB38 ${input.orderNo})`,
        },
    });
    return input.message;
}

export async function executeHanwhaNewOrderJob(input: HanwhaNewOrderJobMetadata & { requestedByUserId?: string | null }) {
    const order = await prisma.order.findUnique({
        where: { id: input.orderId },
        select: {
            id: true,
            orderNo: true,
            createdAt: true,
            status: true,
            hanwhaOrderedAt: true,
            deletedAt: true,
            requestedDeliveryDate: true,
            driverCustomerNotice: true,
            orderExtraRequest: true,
            customer: { select: { companyName: true } },
            deliveryAddress: { select: { label: true, addressLine1: true, addressLine2: true } },
            items: {
                select: {
                    requestedQuantity: true,
                    unit: true,
                    hanwhaBagType: true,
                    purchaseLedgerDate: true,
                    product: { select: { productName: true, productCode: true, hanwhaMaterialName: true, hanwhaItemCode: true } },
                    purchaseSupplier: { select: { supplierName: true } },
                },
            },
        },
    });
    if (!order || order.deletedAt) throw new Error('\uC8FC\uBB38\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.');

    const canRunReorder = Boolean(input.forceReorder && order.hanwhaOrderedAt && order.status === OrderStatus.DISPATCHING);
    if (order.status !== OrderStatus.APPROVED && !canRunReorder) {
        throw new Error('\uC2B9\uC778 \uC644\uB8CC\uB41C \uC8FC\uBB38\uC5D0\uC11C\uB9CC \uD55C\uD654 e-Sales\uB97C \uC5F4 \uC218 \uC788\uC2B5\uB2C8\uB2E4.');
    }

    const hanwhaItems = order.items.filter(isHanwhaOrderItem);
    if (!hanwhaItems.length) {
        throw new Error('\uD55C\uD654 e-Sales\uC5D0 \uC785\uB825\uD560 \uD55C\uD654 \uD488\uBAA9\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uB9E4\uC785\uCC98\uAC00 \uD55C\uD654\uC194\uB8E8\uC158\uC778 \uD488\uBAA9\uB9CC \uCC98\uB9AC\uD569\uB2C8\uB2E4.');
    }
    if (!order.requestedDeliveryDate) throw new Error('\uB0A9\uD488\uC694\uCCAD\uC77C\uC774 \uC5C6\uC5B4 \uD55C\uD654 e-Sales \uC8FC\uBB38\uC744 \uC785\uB825\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.');

    const basePurchaseDate = purchaseRequestDateFromOrderNo(order.orderNo) ?? order.createdAt;
    const poDate = hanwhaItems.find((item) => isLaterDate(item.purchaseLedgerDate, basePurchaseDate))?.purchaseLedgerDate ?? null;
    const itemCodeRows = await prisma.hanwhaItemCode.findMany({ select: { itemName: true, itemCode: true } });
    const findItemCode = (materialName: string) => {
        const target = normalizeHanwhaItemName(materialName);
        const looseTarget = normalizeHanwhaItemNameLoose(materialName);
        return itemCodeRows.find((row) => normalizeHanwhaItemName(row.itemName) === target)?.itemCode
            ?? itemCodeRows.find((row) => normalizeHanwhaItemName(row.itemName).startsWith(`${target}_`))?.itemCode
            ?? itemCodeRows.find((row) => normalizeHanwhaItemNameLoose(row.itemName) === looseTarget)?.itemCode
            ?? itemCodeRows.find((row) => normalizeHanwhaItemNameLoose(row.itemName).startsWith(looseTarget))?.itemCode
            ?? null;
    };

    const hanwhaInput: HanwhaESalesOrderInput = {
        username: await getHanwhaUsername(),
        password: await getHanwhaPassword(),
        shipToName: order.deliveryAddress.label || order.customer.companyName,
        shipToAddress: compactJoin([order.deliveryAddress.addressLine1, order.deliveryAddress.addressLine2], ' '),
        customerName: order.customer.companyName,
        orderDateYmd: dateToYmd(new Date()),
        poDateYmd: poDate ? dateToYmd(poDate) : null,
        deliveryDateYmd: dateToYmd(order.requestedDeliveryDate),
        driverCustomerNotice: order.driverCustomerNotice,
        orderExtraRequest: poDate ? withPurchaseCarryoverSalesPrefix(order.orderExtraRequest, poDate) : order.orderExtraRequest,
        approveAfterOrder: false,
        items: hanwhaItems.map((item) => {
            const bagType = resolveHanwhaBagType(item.hanwhaBagType, item.product.productName);
            const materialName = resolveHanwhaMaterialName({
                productName: item.product.productName,
                productCode: item.product.productCode,
                explicitMaterialName: item.product.hanwhaMaterialName,
                bagType,
            });
            const mappedItemCode = findItemCode(materialName);
            const itemCode = bagType && bagType !== 'FFS'
                ? mappedItemCode || item.product.hanwhaItemCode?.trim()
                : item.product.hanwhaItemCode?.trim() || mappedItemCode;
            if (!itemCode) throw new Error(`\uC81C\uD488 DB\uC5D0 \uD55C\uD654 \uD488\uBAA9\uCF54\uB4DC\uAC00 \uB4F1\uB85D\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4: ${item.product.productName} / ${materialName}`);
            return {
                productName: item.product.productName,
                productCode: item.product.productCode,
                materialName,
                itemCode,
                quantity: quantityToMetricTon(item.requestedQuantity, item.unit),
            };
        }),
    };

    const result = await openHanwhaESalesOrder(hanwhaInput);
    if (!result.ok) {
        if (result.manualAction === 'PRODUCT_SELECTION') {
            throw new HanwhaProductSelectionRequiredError(
                result.error,
                hanwhaInput,
                result.rowIndex ?? 0,
                result.manualTitle,
                result.manualButtonLabel,
            );
        }
        throw new Error(result.error);
    }

    const postOrderMessage = await runPostOrderStep(input.approveAfterOrder, result.orderNo);
    const message = `${result.message} ${postOrderMessage}`;
    await finalizeHanwhaOrder({
        orderId: input.orderId,
        requestedByUserId: input.requestedByUserId,
        approveAfterOrder: input.approveAfterOrder,
        orderNo: order.orderNo,
        itemCount: hanwhaItems.length,
        message,
    });
    return { message };
}

export async function resumeHanwhaNewOrderAfterProductSelection(input: HanwhaNewOrderJobMetadata & { requestedByUserId?: string | null }) {
    if (!input.resumeInput || input.resumeRowIndex == null) {
        throw new Error('\uC774\uC5B4\uAC00\uAE30 \uC815\uBCF4\uAC00 \uC5C6\uC5B4 \uC790\uB3D9 \uC785\uB825\uC744 \uC7AC\uAC1C\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.');
    }
    const result = await resumeHanwhaESalesOrderAfterProductSelection(input.resumeInput, input.resumeRowIndex);
    if (!result.ok) {
        if (result.manualAction === 'PRODUCT_SELECTION') {
            throw new HanwhaProductSelectionRequiredError(
                result.error,
                input.resumeInput,
                result.rowIndex ?? input.resumeRowIndex,
                result.manualTitle,
                result.manualButtonLabel,
            );
        }
        throw new Error(result.error);
    }
    const order = await prisma.order.findUnique({ where: { id: input.orderId }, select: { orderNo: true } });
    if (!order) throw new Error('\uC8FC\uBB38\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.');
    const postOrderMessage = await runPostOrderStep(input.approveAfterOrder, result.orderNo);
    const message = `${result.message} ${postOrderMessage}`;
    await finalizeHanwhaOrder({
        orderId: input.orderId,
        requestedByUserId: input.requestedByUserId,
        approveAfterOrder: input.approveAfterOrder,
        orderNo: order.orderNo,
        message,
        manualProductSelection: true,
    });
    return { message };
}
