type DispatchDestination = {
    customerName?: string | null;
    addressLabel?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
};

export function normalizeDispatchDestinationText(value: string | null | undefined) {
    return (value ?? '')
        .toLowerCase()
        .replace(/주식회사|\(주\)|㈜|\s/g, '')
        .replace(/[()\[\]{}.,/\\_-]/g, '')
        .replace(/앤/g, '엔')
        .trim();
}

export function isDispatchDestinationMatch(indoChiName: string | null | undefined, destination: DispatchDestination) {
    const normalizedIndoChiName = normalizeDispatchDestinationText(indoChiName);
    if (!normalizedIndoChiName) return false;

    const destinationValues = [
        destination.addressLabel,
        destination.addressLine1,
        destination.addressLine2,
    ]
        .map(normalizeDispatchDestinationText)
        .filter(Boolean);
    const matchValues = destinationValues.length > 0
        ? destinationValues
        : [normalizeDispatchDestinationText(destination.customerName)].filter(Boolean);

    return matchValues.some((value) => value.includes(normalizedIndoChiName));
}
