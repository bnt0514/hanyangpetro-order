const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.orderItem
    .updateMany({ where: { unit: 'KG' }, data: { unit: 'TON' } })
    .then((r) => {
        console.log('updated items:', r.count);
        return p.$disconnect();
    });
