const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
    const targets = await p.order.findMany({
        where: { orderNo: { startsWith: 'HY202604-' } },
        select: { id: true, orderNo: true },
    });
    console.log('삭제 대상:', targets.map((t) => t.orderNo));
    const ids = targets.map((t) => t.id);
    if (ids.length === 0) {
        console.log('삭제할 주문 없음');
        await p.$disconnect();
        return;
    }
    const sh = await p.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } });
    const it = await p.orderItem.deleteMany({ where: { orderId: { in: ids } } });
    const od = await p.order.deleteMany({ where: { id: { in: ids } } });
    console.log('상태이력:', sh.count, '품목:', it.count, '주문:', od.count);
    const remain = await p.order.count();
    console.log('남은 주문:', remain);
    await p.$disconnect();
})();
