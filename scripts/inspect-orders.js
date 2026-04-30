const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
    const total = await p.order.count();
    const seedSource = await p.order.groupBy({
        by: ['orderSource'],
        _count: true,
    });
    const recent = await p.order.findMany({
        take: 30,
        orderBy: { createdAt: 'desc' },
        include: {
            customer: { select: { companyName: true } },
            requestedByUser: { select: { name: true } },
            requestedByCustomerUser: { select: { name: true } },
        },
    });
    console.log('TOTAL ORDERS:', total);
    console.log('BY SOURCE:', seedSource);
    console.log('---RECENT---');
    for (const o of recent) {
        console.log(
            o.orderNo,
            '|',
            o.customer.companyName,
            '|',
            o.orderSource,
            '|',
            'staff=' + (o.requestedByUser?.name || '-'),
            '|',
            'cust=' + (o.requestedByCustomerUser?.name || '-'),
            '|',
            o.createdAt.toISOString(),
        );
    }
    await p.$disconnect();
})();
