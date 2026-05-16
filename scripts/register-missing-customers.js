// @ts-check
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const repId = 'cmojpskm50001994cuaz2yd7u'; // 차성식

    const customers = [
        {
            name: '(주)영주',
            openingReceivable: 2140000,
            openingReceivableDate: new Date('2026-05-16'),
        },
        {
            name: '(주)아이큐포리머',
            openingReceivable: 1485000,
            openingReceivableDate: new Date('2026-05-16'),
        },
    ];

    // Determine next customer code
    const allCodes = await prisma.customer.findMany({ select: { customerCode: true } });
    const maxCode = allCodes.reduce((max, c) => {
        const n = parseInt(c.customerCode.replace(/\D/g, ''), 10);
        return isNaN(n) ? max : Math.max(max, n);
    }, 0);
    let nextCode = maxCode + 1;

    for (const c of customers) {
        const existing = await prisma.customer.findFirst({ where: { companyName: c.name } });
        if (existing) {
            console.log('이미 존재: ' + c.name + ' → 잔액/담당자 업데이트');
            await prisma.customer.update({
                where: { id: existing.id },
                data: {
                    openingReceivable: c.openingReceivable,
                    openingReceivableDate: c.openingReceivableDate,
                    defaultSalesRepId: repId,
                },
            });
            console.log('  이월미수금: ' + c.openingReceivable.toLocaleString() + '원');
        } else {
            const code = String(nextCode++).padStart(5, '0');
            const created = await prisma.customer.create({
                data: {
                    customerCode: code,
                    companyName: c.name,
                    openingReceivable: c.openingReceivable,
                    openingReceivableDate: c.openingReceivableDate,
                    defaultSalesRepId: repId,
                },
            });
            console.log('신규 등록: ' + c.name + ' (code: ' + code + ', id: ' + created.id + ')');
            console.log('  이월미수금: ' + c.openingReceivable.toLocaleString() + '원');
        }
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());