import { previousBusinessDate } from '@/lib/korean-holidays';
import { ORDER_STATUS } from '@/lib/orders';

type ShipmentStatusInput = {
    requestedDeliveryDate: Date | null | undefined;
    sameDayDelivery?: boolean | null;
};

function kstParts(date: Date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(date);
    return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function kstDateKey(date: Date) {
    const values = kstParts(date);
    return `${values.year}-${values.month}-${values.day}`;
}

/**
 * Normal orders ship on the prior business day. Same-day delivery orders
 * ship on their requested delivery date.
 */
export function shipmentDateForOrder({ requestedDeliveryDate, sameDayDelivery }: ShipmentStatusInput) {
    if (!requestedDeliveryDate) return null;
    if (sameDayDelivery) return new Date(requestedDeliveryDate);
    return previousBusinessDate(requestedDeliveryDate);
}

export function isShipmentCutoffReached(input: ShipmentStatusInput, now = new Date()) {
    const shipmentDate = shipmentDateForOrder(input);
    if (!shipmentDate) return false;

    const todayKey = kstDateKey(now);
    const shipmentKey = kstDateKey(shipmentDate);
    if (todayKey > shipmentKey) return true;
    if (todayKey < shipmentKey) return false;

    const values = kstParts(now);
    const hour = Number(values.hour);
    const minute = Number(values.minute);
    return hour > 14 || (hour === 14 && minute >= 0);
}

export function dispatchCompletedStatusForOrder(input: ShipmentStatusInput, now = new Date()) {
    return isShipmentCutoffReached(input, now)
        ? ORDER_STATUS.SHIPPED
        : ORDER_STATUS.DISPATCH_COMPLETED;
}

export function isShipmentDueOnKstDate(input: ShipmentStatusInput, dateKey: string) {
    const shipmentDate = shipmentDateForOrder(input);
    return shipmentDate ? kstDateKey(shipmentDate) === dateKey : false;
}
