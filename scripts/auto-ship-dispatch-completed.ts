import { PrismaClient } from '@prisma/client';
import { isShipmentCutoffReached, kstDateKey } from '../src/lib/shipment-status';

const prisma = new PrismaClient();
const checkIntervalMs = Number(process.env.AUTO_SHIP_CHECK_MS || 5 * 60 * 1000);
const reason = '\uCD9C\uACE0 \uAE30\uC900\uC77C \uC624\uD6C4 2\uC2DC \uC790\uB3D9 \uCD9C\uACE0\uC644\uB8CC \uC804\uD658';

async function runOnce() {
    const now = new Date();
    const orders = await prisma.order.findMany({
        where: { deletedAt: null, status: 'DISPATCH_COMPLETED' },
        select: {
            id: true,
            requestedDeliveryDate: true,
            sameDayDelivery: true,
        },
        take: 500,
    });

    let changed = 0;
    for (const order of orders) {
        if (!isShipmentCutoffReached(order, now)) continue;
        await prisma.$transaction(async (tx) => {
            const updated = await tx.order.updateMany({
                where: { id: order.id, status: 'DISPATCH_COMPLETED', deletedAt: null },
                data: { status: 'SHIPPED' },
            });
            if (updated.count === 0) return;
            changed += 1;
            await tx.orderStatusHistory.create({
                data: {
                    orderId: order.id,
                    previousStatus: 'DISPATCH_COMPLETED',
                    newStatus: 'SHIPPED',
                    changeReason: reason,
                },
            });
        });
    }

    if (changed > 0) {
        console.log(`[auto-ship] ${kstDateKey(now)} - ${changed} orders moved to SHIPPED`);
    }
}

async function shutdown() {
    await prisma.$disconnect();
    process.exit(0);
}

async function main() {
    console.log(`[auto-ship] worker started. interval=${checkIntervalMs}ms`);
    await runOnce();
    setInterval(() => void runOnce().catch((error) => console.error('[auto-ship] run failed', error)), checkIntervalMs);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
main().catch(async (error) => {
    console.error('[auto-ship] worker crashed', error);
    await shutdown();
});
