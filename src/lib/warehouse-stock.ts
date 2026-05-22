import { prisma } from '@/lib/db';
import { productIdentityKey } from '@/lib/product-identity';

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

    const aggregatedRows = new Map<string, WarehouseStockRow>();
    for (const row of rows) {
        const key = productIdentityKey(row.productName, row.productCode);
        const current = aggregatedRows.get(key);
        if (!current) {
            aggregatedRows.set(key, { ...row, productKey: key });
            continue;
        }
        current.snapshotQuantity += row.snapshotQuantity;
        current.inboundQuantity += row.inboundQuantity;
        current.outboundQuantity += row.outboundQuantity;
        current.currentQuantity += row.currentQuantity;
    }

    return Array.from(aggregatedRows.values())
        .sort((a, b) => a.productName.localeCompare(b.productName, 'ko'))
        .filter((row) => row.currentQuantity > 0);
}
