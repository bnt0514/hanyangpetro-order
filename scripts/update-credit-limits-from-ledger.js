// @ts-check
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function parseArgs(argv) {
    const args = new Map();
    for (const arg of argv) {
        if (arg === '--apply') args.set('apply', 'true');
        else if (arg.startsWith('--as-of=')) args.set('asOf', arg.slice('--as-of='.length));
    }
    return args;
}

function monthStart(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, months) {
    return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function monthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function normalizeName(value) {
    return String(value || '')
        .replace(/\s+/g, '')
        .replace(/[㈜（]/g, '(')
        .replace(/[）]/g, ')')
        .trim()
        .toLowerCase();
}

function money(value) {
    return Math.round(value).toLocaleString('ko-KR');
}

function entryAmount(entry) {
    if (entry.totalAmount != null) return entry.totalAmount;
    if (entry.supplyAmount != null || entry.vatAmount != null) return (entry.supplyAmount || 0) + (entry.vatAmount || 0);
    return 0;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const apply = args.get('apply') === 'true';
    const asOfValue = args.get('asOf') || new Date().toISOString().slice(0, 10);
    const asOf = new Date(`${asOfValue}T00:00:00`);
    if (Number.isNaN(asOf.getTime())) throw new Error(`Invalid --as-of date: ${asOfValue}`);

    const currentMonthStart = monthStart(asOf);
    const startDate = addMonths(currentMonthStart, -3);
    const endDate = currentMonthStart;
    const months = [0, 1, 2].map((offset) => monthKey(addMonths(startDate, offset)));

    const customers = await prisma.customer.findMany({
        where: { isActive: true },
        select: { id: true, companyName: true, customerCode: true, creditLimit: true },
        orderBy: { companyName: 'asc' },
    });
    const customerById = new Map(customers.map((customer) => [customer.id, customer]));
    const customerByName = new Map(customers.map((customer) => [normalizeName(customer.companyName), customer]));

    const totals = new Map(customers.map((customer) => [customer.id, { total: 0, months: new Map(months.map((m) => [m, 0])) }]));
    const unmatched = new Map();

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
        if (!customer) {
            const key = entry.counterpartyName || '(거래처명 없음)';
            unmatched.set(key, (unmatched.get(key) || 0) + entryAmount(entry));
            continue;
        }
        const bucket = totals.get(customer.id);
        if (!bucket) continue;
        const amount = entryAmount(entry);
        const key = monthKey(entry.transactionDate);
        bucket.total += amount;
        bucket.months.set(key, (bucket.months.get(key) || 0) + amount);
    }

    const results = customers.map((customer) => {
        const bucket = totals.get(customer.id);
        const total = bucket?.total || 0;
        const creditLimit = Math.round((total / 3) * 2);
        return {
            customer,
            monthlyAmounts: months.map((month) => ({ month, amount: bucket?.months.get(month) || 0 })),
            total,
            creditLimit,
        };
    });

    const changed = results.filter((row) => Math.round(row.customer.creditLimit || 0) !== row.creditLimit);
    console.log(`기준일: ${asOfValue}`);
    console.log(`산정기간: ${months.join(', ')} (당월 제외 최근 3개월)`);
    console.log(`대상 거래처: ${customers.length.toLocaleString('ko-KR')}개`);
    console.log(`매출원장: ${entries.length.toLocaleString('ko-KR')}건`);
    console.log(`변경 대상: ${changed.length.toLocaleString('ko-KR')}개`);
    console.log(`실행 모드: ${apply ? 'APPLY' : 'DRY RUN'}\n`);

    console.log('상위 여신 산정 거래처');
    console.log('거래처'.padEnd(24), months.join(' / ').padEnd(34), '3개월평균');
    console.log('-'.repeat(78));
    results
        .filter((row) => row.creditLimit > 0)
        .sort((a, b) => b.creditLimit - a.creditLimit)
        .slice(0, 20)
        .forEach((row) => {
            const monthly = row.monthlyAmounts.map((m) => money(m.amount)).join(' / ');
            console.log(row.customer.companyName.slice(0, 22).padEnd(24), monthly.padEnd(34), money(row.creditLimit));
        });

    if (unmatched.size > 0) {
        console.log(`\n미매칭 원장 거래처: ${unmatched.size.toLocaleString('ko-KR')}개`);
        [...unmatched.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .forEach(([name, amount]) => console.log(`- ${name}: ${money(amount)}원`));
    }

    if (apply) {
        await prisma.$transaction(
            results.map((row) => prisma.customer.update({
                where: { id: row.customer.id },
                data: { creditLimit: row.creditLimit },
            })),
        );
        console.log(`\n✅ 여신한도 업데이트 완료: ${results.length.toLocaleString('ko-KR')}개 거래처`);
    } else {
        console.log('\nDRY RUN입니다. 반영하려면 --apply를 붙여 실행하세요.');
    }
}

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());