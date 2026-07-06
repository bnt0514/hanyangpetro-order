'use server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';

async function assertStaff() {
    const session = await auth();
    if (!session?.user || session.user.userKind !== 'staff') {
        throw new Error('직원만 품목을 관리할 수 있습니다.');
    }
}

function text(formData: FormData, key: string) {
    const value = String(formData.get(key) ?? '').trim();
    return value || null;
}

async function generateNextProductCode(): Promise<string> {
    const products = await prisma.product.findMany({
        select: { productCode: true },
        where: { productCode: { startsWith: 'ITEM-' } },
    });
    const nums = products
        .map((p) => {
            const m = p.productCode.match(/^ITEM-([0-9]+)$/i);
            return m ? parseInt(m[1], 10) : 0;
        })
        .filter((n) => !isNaN(n));
    const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
    return `ITEM-${next}`;
}

export async function createProductAction(formData: FormData) {
    await assertStaff();
    const productName = text(formData, 'productName');
    if (!productName) return;

    const productCode = await generateNextProductCode();

    await prisma.product.create({
        data: {
            productCode,
            productName,
            manufacturer: text(formData, 'manufacturer'),
            grade: text(formData, 'grade'),
            packagingType: text(formData, 'packagingType'),
            category: text(formData, 'category'),
            brand: text(formData, 'brand'),
            productGroup: text(formData, 'productGroup'),
            hanwhaMaterialName: text(formData, 'hanwhaMaterialName'),
            hanwhaItemCode: text(formData, 'hanwhaItemCode'),
            isActive: true,
        },
    });
    revalidatePath('/admin/products');
}

export async function updateProductAction(formData: FormData) {
    await assertStaff();
    const id = text(formData, 'id');
    const productCode = text(formData, 'productCode');
    const productName = text(formData, 'productName');
    if (!id || !productCode || !productName) return;

    await prisma.product.update({
        where: { id },
        data: {
            productCode,
            productName,
            manufacturer: text(formData, 'manufacturer'),
            grade: text(formData, 'grade'),
            packagingType: text(formData, 'packagingType'),
            category: text(formData, 'category'),
            brand: text(formData, 'brand'),
            productGroup: text(formData, 'productGroup'),
            hanwhaMaterialName: text(formData, 'hanwhaMaterialName'),
            hanwhaItemCode: text(formData, 'hanwhaItemCode'),
            isActive: formData.get('isActive') === 'on',
        },
    });
    revalidatePath('/admin/products');
}

export async function deactivateProductAction(formData: FormData) {
    await assertStaff();
    const id = text(formData, 'id');
    if (!id) return;
    await prisma.product.update({ where: { id }, data: { isActive: false } });
    revalidatePath('/admin/products');
}
