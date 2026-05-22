import { prisma } from '@/lib/db';

export const CREDIT_LIMIT_MANAGER_NAME = '양희철';
export const CREDIT_LIMIT_MANAGER_ID = 'cmojpskkh0000994c99z7ro6d';

export type CreditLimitSortKey =
    | 'customer'
    | 'rep'
    | 'averageSales'
    | 'calculatedLimit'
    | 'currentLimit'
    | 'difference'
    | 'creditInsuranceAmount'
    | 'mortgageAmount'
    | 'creditGrade';
export type CreditLimitSortDir = 'asc' | 'desc';

export type CreditLimitRow = {
    customerId: string;
    customerCode: string;
    companyName: string;
    salesRepName: string;
    currentLimit: number;
    creditInsuranceAmount: number;
    mortgageAmount: number;
    creditGrade: string;
    totalSales: number;
    averageSales: number;
    calculatedLimit: number;
    difference: number;
    monthlyAmounts: { month: string; amount: number }[];
};

export type CreditLimitReport = {
    asOf: string;
    months: number;
    startDate: Date;
    endDate: Date;
    monthKeys: string[];
    rows: CreditLimitRow[];
    summary: {
        customerCount: number;
        activeSalesCustomerCount: number;
        totalCurrentLimit: number;
        totalCalculatedLimit: number;
        totalAverageSales: number;
        totalCreditInsuranceAmount: number;
        totalMortgageAmount: number;
    };
};

function monthStart(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number) {
    return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function monthKey(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function normalizeName(value: string | null | undefined) {
    return String(value || '')
        .replace(/\s+/g, '')
        .replace(/[㈜（]/g, '(')
        .replace(/[）]/g, ')')
        .trim()
        .toLowerCase();
}

function entryAmount(entry: { totalAmount: number | null; supplyAmount: number | null; vatAmount: number | null }) {
    if (entry.totalAmount != null) return entry.totalAmount;
    if (entry.supplyAmount != null || entry.vatAmount != null) return (entry.supplyAmount || 0) + (entry.vatAmount || 0);
    return 0;
}

function parseAsOf(value?: string) {
    const fallback = new Date();
    const date = value ? new Date(`${value}T00:00:00`) : fallback;
    if (Number.isNaN(date.getTime())) return fallback;
    return date;
}

export function normalizeCreditLimitMonths(value?: string | number) {
    const months = Number(value ?? 3);
    return [3, 4, 5, 12].includes(months) ? months : 3;
}

export function defaultAsOf() {
    return new Date().toISOString().slice(0, 10);
}

export function canManageCreditLimits(user?: { id?: string; name?: string | null; userKind?: string }) {
    return user?.userKind === 'staff' && (user.id === CREDIT_LIMIT_MANAGER_ID || user.name === CREDIT_LIMIT_MANAGER_NAME);
}

export async function getCreditLimitReport(options: {
    asOf?: string;
    months?: string | number;
    sort?: CreditLimitSortKey;
    dir?: CreditLimitSortDir;
    q?: string;
}): Promise<CreditLimitReport> {
    const asOfDate = parseAsOf(options.asOf);
    const asOf = asOfDate.toISOString().slice(0, 10);
    const months = normalizeCreditLimitMonths(options.months);
    const currentMonthStart = monthStart(asOfDate);
    const startDate = addMonths(currentMonthStart, -months);
    const endDate = currentMonthStart;
    const monthKeys = Array.from({ length: months }, (_, index) => monthKey(addMonths(startDate, index)));
    const query = options.q?.trim() || '';

    const customers = await prisma.customer.findMany({
        where: {
            isActive: true,
            ...(query
                ? {
                    OR: [
                        { companyName: { contains: query } },
                        { customerCode: { contains: query } },
                        { defaultSalesRep: { name: { contains: query } } },
                    ],
                }
                : {}),
        },
        select: {
            id: true,
            customerCode: true,
            companyName: true,
            creditLimit: true,
            creditInsuranceAmount: true,
            mortgageAmount: true,
            creditGrade: true,
            defaultSalesRep: { select: { name: true } },
        },
    });

    const customerById = new Map(customers.map((customer) => [customer.id, customer]));
    const customerByName = new Map(customers.map((customer) => [normalizeName(customer.companyName), customer]));
    const totals = new Map(customers.map((customer) => [
        customer.id,
        { total: 0, months: new Map(monthKeys.map((key) => [key, 0])) },
    ]));

    const entries = await prisma.ledgerEntry.findMany({
        where: {
            ledgerType: 'SALES',
            transactionDate: { gte: startDate, lt: endDate },
        },
        select: {
            customerId: true,
            counterpartyName: true,
            transactionDate: true,
            totalAmount: true,
            supplyAmount: true,
            vatAmount: true,
        },
    });

    for (const entry of entries) {
        const customer = entry.customerId ? customerById.get(entry.customerId) : customerByName.get(normalizeName(entry.counterpartyName));
        if (!customer) continue;
        const bucket = totals.get(customer.id);
        if (!bucket) continue;
        const amount = entryAmount(entry);
        const key = monthKey(entry.transactionDate);
        bucket.total += amount;
        bucket.months.set(key, (bucket.months.get(key) || 0) + amount);
    }

    const rows: CreditLimitRow[] = customers.map((customer) => {
        const bucket = totals.get(customer.id);
        const totalSales = bucket?.total || 0;
        const averageSales = totalSales / months;
        const calculatedLimit = Math.round(averageSales * 2);
        const currentLimit = Math.round(customer.creditLimit || 0);
        return {
            customerId: customer.id,
            customerCode: customer.customerCode,
            companyName: customer.companyName,
            salesRepName: customer.defaultSalesRep?.name ?? '미배정',
            currentLimit,
            creditInsuranceAmount: Math.round(customer.creditInsuranceAmount || 0),
            mortgageAmount: Math.round(customer.mortgageAmount || 0),
            creditGrade: customer.creditGrade || 'B',
            totalSales,
            averageSales,
            calculatedLimit,
            difference: currentLimit - calculatedLimit,
            monthlyAmounts: monthKeys.map((key) => ({ month: key, amount: bucket?.months.get(key) || 0 })),
        };
    }).filter((row) => row.totalSales > 0);

    const sort = options.sort || 'calculatedLimit';
    const dir = options.dir === 'asc' ? 'asc' : 'desc';
    rows.sort((a, b) => {
        let result = 0;
        if (sort === 'customer') result = a.companyName.localeCompare(b.companyName, 'ko-KR');
        else if (sort === 'rep') result = a.salesRepName.localeCompare(b.salesRepName, 'ko-KR') || a.companyName.localeCompare(b.companyName, 'ko-KR');
        else if (sort === 'creditGrade') result = a.creditGrade.localeCompare(b.creditGrade);
        else result = (a[sort] as number) - (b[sort] as number);
        return dir === 'asc' ? result : -result;
    });

    const summary = rows.reduce(
        (acc, row) => {
            acc.customerCount += 1;
            if (row.totalSales > 0) acc.activeSalesCustomerCount += 1;
            acc.totalCurrentLimit += row.currentLimit;
            acc.totalCalculatedLimit += row.calculatedLimit;
            acc.totalAverageSales += row.averageSales;
            acc.totalCreditInsuranceAmount += row.creditInsuranceAmount;
            acc.totalMortgageAmount += row.mortgageAmount;
            return acc;
        },
        {
            customerCount: 0,
            activeSalesCustomerCount: 0,
            totalCurrentLimit: 0,
            totalCalculatedLimit: 0,
            totalAverageSales: 0,
            totalCreditInsuranceAmount: 0,
            totalMortgageAmount: 0,
        },
    );

    return { asOf, months, startDate, endDate, monthKeys, rows, summary };
}


