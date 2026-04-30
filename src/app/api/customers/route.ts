/**
 * GET /api/customers
 *  - 직원 전용. 거래처 목록 (Combobox 데이터 소스)
 *  - 응답: { id, label, sublabel } []
 */
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
    const session = await auth();
    if (!session?.user || session.user.userKind !== 'staff') {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const list = await prisma.customer.findMany({
        where: { isActive: true },
        select: { id: true, companyName: true, customerCode: true },
        orderBy: { companyName: 'asc' },
    });

    return NextResponse.json(
        list.map(c => ({
            value: c.id,
            label: c.companyName,
            sublabel: c.customerCode,
        })),
    );
}
