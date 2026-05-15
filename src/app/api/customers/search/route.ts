import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
    const session = await auth();
    if (!session?.user || session.user.userKind !== 'staff') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const q = req.nextUrl.searchParams.get('q') ?? '';
    const customers = await prisma.customer.findMany({
        where: q
            ? {
                  isActive: true,
                  OR: [
                      { companyName: { contains: q } },
                      { customerCode: { contains: q } },
                  ],
              }
            : { isActive: true },
        select: { id: true, companyName: true, customerCode: true },
        orderBy: { companyName: 'asc' },
        take: 200,
    });

    return NextResponse.json(customers);
}
