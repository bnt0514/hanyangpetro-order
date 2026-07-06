import ecountCustomers from '@/data/ecount-customers.json';

export type EcountCustomerRow = {
    rowNumber: number;
    businessNumberCode: string;
    companyName: string;
    ceoName: string;
    phone: string;
    address: string;
    email: string;
    managerName: string;
};

export type EcountCustomerMatch = {
    homepageCustomerId: string;
    homepageCustomerCode: string;
    homepageCompanyName: string;
    matchType: 'BUSINESS_NUMBER' | 'EXACT_NAME' | 'NORMALIZED_NAME';
    recentTransactionDate: string | null;
};

export type EcountCustomerMatchIndex = {
    byBusinessNumber: Record<string, EcountCustomerMatch>;
    byExactName: Record<string, EcountCustomerMatch>;
    byNormalizedName: Record<string, EcountCustomerMatch>;
};

export type EcountCustomerDisplayRow = EcountCustomerRow & {
    match: EcountCustomerMatch | null;
};

export type EcountCustomerLookup = {
    totalCount: number;
    rows: EcountCustomerDisplayRow[];
};

export function normalizeEcountCustomerName(value: string) {
    return value
        .toLowerCase()
        .replace(/주식회사|\(주\)|㈜|\s/g, '')
        .replace(/[()\[\]{}.,/\\_-]/g, '')
        .trim();
}

export function normalizeBusinessNumber(value: string) {
    return value.replace(/\D/g, '');
}

function matchForRow(row: EcountCustomerRow, matchIndex?: EcountCustomerMatchIndex) {
    if (!matchIndex) return null;
    const businessNumber = normalizeBusinessNumber(row.businessNumberCode);
    return (businessNumber.length >= 10 ? matchIndex.byBusinessNumber[businessNumber] : null)
        ?? matchIndex.byExactName[row.companyName.trim()]
        ?? matchIndex.byNormalizedName[normalizeEcountCustomerName(row.companyName)]
        ?? null;
}

function includesQuery(row: EcountCustomerRow, query: string) {
    if (!query) return true;
    const normalizedQuery = normalizeEcountCustomerName(query);
    const values = [
        row.businessNumberCode,
        row.companyName,
        row.ceoName,
        row.phone,
        row.address,
        row.email,
        row.managerName,
    ];
    return values.some((value) => {
        const text = value.trim();
        return text.includes(query) || normalizeEcountCustomerName(text).includes(normalizedQuery);
    });
}

function recentTime(match: EcountCustomerMatch | null) {
    return match?.recentTransactionDate ? new Date(match.recentTransactionDate).getTime() : 0;
}

export function loadEcountCustomers(
    query = '',
    limit = 300,
    matchIndex?: EcountCustomerMatchIndex,
): EcountCustomerLookup {
    const trimmedQuery = query.trim();
    const allRows = ecountCustomers as EcountCustomerRow[];
    const rows = allRows
        .filter((row) => includesQuery(row, trimmedQuery))
        .map((row) => ({ ...row, match: matchForRow(row, matchIndex) }))
        .sort((a, b) =>
            recentTime(b.match) - recentTime(a.match)
            || Number(Boolean(b.match)) - Number(Boolean(a.match))
            || a.companyName.localeCompare(b.companyName, 'ko')
            || a.rowNumber - b.rowNumber
        );

    return {
        totalCount: rows.length,
        rows: rows.slice(0, limit),
    };
}
