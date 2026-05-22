import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

try {
    const customers = await prisma.customer.findMany({
        where: { isActive: true },
        select: {
            id: true,
            companyName: true,
            addresses: {
                where: { isActive: true },
                select: { id: true, label: true },
            },
        },
        orderBy: { companyName: 'asc' },
    });

    const targets = customers
        .filter((customer) => customer.addresses.length === 1)
        .map((customer) => ({
            customerId: customer.id,
            companyName: customer.companyName.trim(),
            addressId: customer.addresses[0].id,
            currentLabel: customer.addresses[0].label,
        }))
        .filter((target) => target.companyName && target.currentLabel !== target.companyName);

    console.log(`single-address label targets: ${targets.length}`);
    for (const target of targets) {
        console.log(`${target.currentLabel} -> ${target.companyName}`);
    }

    if (apply) {
        for (const target of targets) {
            await prisma.deliveryAddress.update({
                where: { id: target.addressId },
                data: { label: target.companyName },
            });
        }
        console.log(`updated: ${targets.length}`);
    } else {
        console.log('preview only. run with --apply to update labels.');
    }
} finally {
    await prisma.$disconnect();
}