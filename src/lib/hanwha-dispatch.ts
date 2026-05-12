export function parseHanwhaRawCells(rawCells: string[] | string | null | undefined): string[] {
    if (Array.isArray(rawCells)) return rawCells;
    if (!rawCells) return [];
    try {
        const parsed = JSON.parse(rawCells);
        return Array.isArray(parsed) ? parsed.map((value) => String(value ?? '').trim()) : [];
    } catch {
        return [];
    }
}

export type HanwhaDriverFields = {
    vehicleNumber: string | null;
    driverName: string | null;
    driverPhone: string | null;
};

export function hanwhaDriverInfo(rawCells: string[] | string | null | undefined): string {
    const fields = extractHanwhaDriverFields(rawCells);
    return joinHanwhaDriverInfo(fields.vehicleNumber, fields.driverName, fields.driverPhone);
}

export function extractHanwhaDriverFields(rawCells: string[] | string | null | undefined): HanwhaDriverFields {
    const cells = parseHanwhaRawCells(rawCells).map((value) => value.trim()).filter(Boolean);
    const vehicleIndex = cells.findIndex((value) => isVehicleNumber(value));
    const phoneIndex = cells.findIndex((value, index) => index > vehicleIndex && isPhoneNumber(value));
    const vehicleNumber = vehicleIndex >= 0 ? cells[vehicleIndex] : null;
    const driverPhone = phoneIndex >= 0 ? cells[phoneIndex] : null;
    const driverName = findDriverName(cells, vehicleIndex, phoneIndex);
    return { vehicleNumber, driverName, driverPhone };
}

export function joinHanwhaDriverInfo(
    vehicleNumber?: string | null,
    driverName?: string | null,
    driverPhone?: string | null,
): string {
    return [vehicleNumber, driverName, driverPhone]
        .map((value) => value?.trim())
        .filter(Boolean)
        .join(' · ') || '-';
}

export function parseHanwhaMaterialFromMemo(memo?: string | null): string | null {
    const value = memo?.split(' / ').pop()?.trim();
    return value && value !== memo ? value : null;
}

function isVehicleNumber(value: string): boolean {
    return /\d{4}\s*-\s*[가-힣]{2,}\d{1,3}[가-힣]/.test(value);
}

function isPhoneNumber(value: string): boolean {
    return /01[016789][\s-]?\d{3,4}[\s-]?\d{4}/.test(value);
}

function findDriverName(cells: string[], vehicleIndex: number, phoneIndex: number): string | null {
    if (vehicleIndex < 0) return null;
    const end = phoneIndex >= 0 ? phoneIndex : cells.length;
    const candidates = cells.slice(vehicleIndex + 1, end);
    const name = candidates.find((value) => /^[가-힣]{2,6}$/.test(value));
    return name ?? null;
}