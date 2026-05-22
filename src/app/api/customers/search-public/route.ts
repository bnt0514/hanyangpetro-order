import { prisma } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

// Public endpoint — returns only companyName (no sensitive data)
// Used by the login page autocomplete so customers can find their registered name.
export async function GET(req: NextRequest) {
    const q = (req.nextUrl.searchParams.get('q') ?? '').trim();

    if (q.length < 1) {
        return NextResponse.json([]);
    }

    const customers = await prisma.customer.findMany({
        where: {
            isActive: true,
            companyName: { contains: q },
        },
        select: { companyName: true },
        orderBy: { companyName: 'asc' },
        take: 10,
    });

    const names = [...new Set(customers.map((c) => c.companyName))];
    return NextResponse.json(names);
}
