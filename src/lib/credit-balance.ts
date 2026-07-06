import { prisma } from '@/lib/db';
import { LEDGER_DISPATCH_COMPLETED_WHERE } from '@/lib/ledger-policy';

const RECEIPT_TX_TYPES = ['IN', 'NOTE_IN'] as const;


export async function calculateCustomerReceivable(customerId: string) {
    const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: {
            receivableAmount: true,
            openingReceivable: true,
            openingReceivableDate: true,
        },
    });
    if (!customer) return null;
    const openingDate = customer.openingReceivableDate;
    if (!openingDate) return customer.receivableAmount;

    const [orderItems, importedSales, receipts] = await Promise.all([
        prisma.orderItem.findMany({
            where: {
                OR: [
                    { salesLedgerDate: { gte: openingDate } },
                    { salesLedgerDate: null, order: { requestedDeliveryDate: { gte: openingDate } } },
                ],
                order: {
                    customerId,
                    deletedAt: null,
                    ...LEDGER_DISPATCH_COMPLETED_WHERE,
                },
                salesUnitPrice: { not: null },
            },
            select: { requestedQuantity: true, salesUnitPrice: true },
        }),
        prisma.ledgerEntry.aggregate({
            where: {
                ledgerType: 'SALES',
                customerId,
                transactionDate: { gte: openingDate },
                orderItemId: null,
            },
            _sum: { supplyAmount: true },
        }),
        prisma.creditTransaction.aggregate({
            where: { customerId, txType: { in: [...RECEIPT_TX_TYPES] }, txDate: { gte: openingDate } },
            _sum: { amount: true },
        }),
    ]);

    const orderSales = orderItems.reduce((sum, item) => sum + item.requestedQuantity * (item.salesUnitPrice ?? 0), 0);
    return (customer.openingReceivable ?? 0)
        + orderSales
        + (importedSales._sum.supplyAmount ?? 0)
        - (receipts._sum.amount ?? 0);
}

