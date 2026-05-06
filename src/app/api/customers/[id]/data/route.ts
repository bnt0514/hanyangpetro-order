/**
 * GET /api/customers/[id]/data
 *  - 거래처에 종속된 도착지 + 노출 가능 제품 목록
 *  - 권한:
 *      - staff: 모든 거래처 조회 가능
 *      - customer: 자기 customerId만 조회 가능
 *  - 응답: { addresses: ComboboxOption[], products: ComboboxOption[] }
 */
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(
    _req: Request,
    ctx: { params: Promise<{ id: string }> },
) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { id: customerId } = await ctx.params;

    if (session.user.userKind === 'customer' && session.user.customerId !== customerId) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const isStaff = session.user.userKind === 'staff';

    const [addresses, whitelist, allProducts] = await Promise.all([
        prisma.deliveryAddress.findMany({
            where: { customerId, isActive: true },
            select: { id: true, label: true, addressLine1: true, isDefault: true },
            orderBy: [{ isDefault: 'desc' }, { label: 'asc' }],
        }),
        prisma.customerProductWhitelist.findMany({
            where: { customerId, isVisibleInPortal: true },
            select: {
                productId: true,
                product: { select: { productCode: true, productName: true, isActive: true } },
            },
        }),
        // 직원 전용: 모든 활성 제품. 거래처는 fallback 안 함.
        isStaff
            ? prisma.product.findMany({
                where: { isActive: true },
                select: { id: true, productCode: true, productName: true },
                orderBy: { productName: 'asc' },
            })
            : Promise.resolve([] as { id: string; productCode: string; productName: string }[]),
    ]);

    // 거래처(customer): 화이트리스트(주문 이력) 있는 것만 노출.
    //                    이력 없으면 빈 배열 → "담당자에게 문의" 안내.
    // 직원(staff):       화이트리스트 + 그 외 모든 제품 (중복 제거, 화이트리스트 우선)
    let productOpts: { value: string; label: string; sublabel?: string }[];

    const whitelistOpts = whitelist
        .filter((w) => w.product && w.product.isActive)
        .map((w) => ({
            value: w.productId,
            label: w.product!.productName,
            sublabel: w.product!.productCode,
        }));

    if (isStaff) {
        const seen = new Set(whitelistOpts.map((p) => p.value));
        const otherOpts = allProducts
            .filter((p) => !seen.has(p.id))
            .map((p) => ({ value: p.id, label: p.productName, sublabel: p.productCode }));
        productOpts = [...whitelistOpts, ...otherOpts];
    } else {
        productOpts = whitelistOpts;
    }

    return NextResponse.json({
        addresses: addresses.map(a => ({
            value: a.id,
            label: a.label,
            sublabel: a.isDefault ? '기본' : undefined,
        })),
        products: productOpts,
    });
}
