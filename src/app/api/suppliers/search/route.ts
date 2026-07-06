import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
    const session = await auth();
    if (!session?.user || session.user.userKind !== 'staff') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const q = req.nextUrl.searchParams.get('q') ?? '';
    const suppliers = await prisma.supplier.findMany({
        where: q
            ? {
                isActive: true,
                OR: [
                    { supplierName: { contains: q } },
                    { businessNumber: { contains: q } },
                    { contactPerson: { contains: q } },
                ],
            }
            : { isActive: true },
        select: { id: true, supplierName: true, contactPerson: true, phone: true },
        orderBy: { supplierName: 'asc' },
        take: 200,
    });

    return NextResponse.json(suppliers);
}
