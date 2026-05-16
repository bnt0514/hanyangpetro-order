import { prisma } from '@/lib/db';

export type WarehouseStockRow = {
    productKey: string;
    productName: string;
    productCode: string | null;
    snapshotQuantity: number;
    inboundQuantity: number;
    outboundQuantity: number;
    currentQuantity: number;
    unit: string;
};

export async function getWarehouseStock(companyEntityId: string) {
    const snapshots = await prisma.warehouseStockSnapshot.findMany({
        where: { companyEntityId },
        orderBy: [{ snapshotDate: 'desc' }, { productName: 'asc' }],
    });

    const latestByProduct = new Map<string, typeof snapshots[number]>();
    for (const snapshot of snapshots) {
        const key = snapshot.productId ?? snapshot.productName;
        if (!latestByProduct.has(key)) latestByProduct.set(key, snapshot);
    }

    const rows: WarehouseStockRow[] = [];
    for (const snapshot of latestByProduct.values()) {
        const movements = await prisma.warehouseStockMovement.findMany({
            where: {
                companyEntityId,
                movementDate: { gt: snapshot.snapshotDate },
                OR: [
                    snapshot.productId ? { productId: snapshot.productId } : { productId: null, productName: snapshot.productName },
                ],
            },
        });
        const inboundQuantity = movements
            .filter((movement) => movement.movementType === 'IN' || movement.movementType === 'ADJUST')
            .reduce((sum, movement) => sum + movement.quantity, 0);
        const outboundQuantity = movements
            .filter((movement) => movement.movementType === 'OUT')
            .reduce((sum, movement) => sum + movement.quantity, 0);
        rows.push({
            productKey: snapshot.productId ?? snapshot.productName,
            productName: snapshot.productName,
            productCode: snapshot.productCode,
            snapshotQuantity: snapshot.quantity,
            inboundQuantity,
            outboundQuantity,
            currentQuantity: snapshot.quantity + inboundQuantity - outboundQuantity,
            unit: snapshot.unit,
        });
    }

    rows.sort((a, b) => a.productName.localeCompare(b.productName, 'ko'));
    return rows;
}
