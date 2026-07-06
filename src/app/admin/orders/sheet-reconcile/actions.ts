'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import {
    createMissingPurchaseSalesRowsFromBuffer,
    isYangHeeCheol,
    listPurchaseSalesWorkbookSheets,
    previewPurchaseSalesReconciliationFromBuffer,
} from '@/lib/order-sheet-reconcile';

async function requireStaffUser() {
    const session = await auth();
    if (!session?.user || session.user.userKind !== 'staff') return null;
    return session.user;
}

async function readPurchaseSalesFile(formData: FormData) {
    const file = formData.get('purchaseSalesFile');
    if (!(file instanceof File) || file.size === 0) {
        return { ok: false as const, error: '매입매출 엑셀 파일을 선택해 주세요.' };
    }

    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.xlsx') && !lower.endsWith('.xlsm') && !lower.endsWith('.xls')) {
        return { ok: false as const, error: '엑셀 파일(.xlsx, .xlsm, .xls)만 선택할 수 있습니다.' };
    }

    return {
        ok: true as const,
        fileName: file.name,
        buffer: Buffer.from(await file.arrayBuffer()),
    };
}

async function readProductMapFile(formData: FormData) {
    const file = formData.get('productMapFile');
    if (!(file instanceof File) || file.size === 0) {
        return { ok: true as const, fileName: '', buffer: null as Buffer | null };
    }

    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.xlsx') && !lower.endsWith('.xlsm') && !lower.endsWith('.xls')) {
        return { ok: false as const, error: '품목명 파일은 엑셀 파일(.xlsx, .xlsm, .xls)만 선택할 수 있습니다.' };
    }

    return {
        ok: true as const,
        fileName: file.name,
        buffer: Buffer.from(await file.arrayBuffer()),
    };
}

function readCommonOptions(formData: FormData, user: NonNullable<Awaited<ReturnType<typeof requireStaffUser>>>) {
    const requestedRepId = String(formData.get('repId') ?? '').trim();
    return {
        date: String(formData.get('date') ?? '').trim(),
        sheetName: String(formData.get('sheetName') ?? '').trim(),
        selectedRepId: isYangHeeCheol(user) ? (requestedRepId || 'all') : user.id,
    };
}

export async function listPurchaseSalesSheets(formData: FormData) {
    const user = await requireStaffUser();
    if (!user) return { ok: false as const, error: '직원만 사용할 수 있습니다.' };

    const file = await readPurchaseSalesFile(formData);
    if (!file.ok) return file;

    try {
        return listPurchaseSalesWorkbookSheets(file.fileName, file.buffer);
    } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : '매입매출 파일을 읽지 못했습니다.' };
    }
}

export async function previewPurchaseSalesUpload(formData: FormData) {
    const user = await requireStaffUser();
    if (!user) return { ok: false as const, error: '직원만 사용할 수 있습니다.' };

    const file = await readPurchaseSalesFile(formData);
    if (!file.ok) return file;
    const productMapFile = await readProductMapFile(formData);
    if (!productMapFile.ok) return productMapFile;
    const options = readCommonOptions(formData, user);

    try {
        return await previewPurchaseSalesReconciliationFromBuffer({
            fileName: file.fileName,
            buffer: file.buffer,
            productMapFileName: productMapFile.fileName,
            productMapBuffer: productMapFile.buffer,
            sheetName: options.sheetName,
            date: options.date,
            actor: user,
            selectedRepId: options.selectedRepId,
        });
    } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : '매입매출 파일 대조 중 오류가 발생했습니다.' };
    }
}

export async function importPurchaseSalesUpload(formData: FormData, mode: 'all' | 'selected', rowIds: string[]) {
    const user = await requireStaffUser();
    if (!user) return { ok: false as const, error: '직원만 사용할 수 있습니다.' };

    const file = await readPurchaseSalesFile(formData);
    if (!file.ok) return file;
    const productMapFile = await readProductMapFile(formData);
    if (!productMapFile.ok) return productMapFile;
    const options = readCommonOptions(formData, user);

    try {
        const result = await createMissingPurchaseSalesRowsFromBuffer({
            fileName: file.fileName,
            buffer: file.buffer,
            productMapFileName: productMapFile.fileName,
            productMapBuffer: productMapFile.buffer,
            sheetName: options.sheetName,
            date: options.date,
            actor: user,
            selectedRepId: options.selectedRepId,
            rowIds,
            mode,
        });
        revalidatePath('/admin');
        revalidatePath('/admin/orders/sheet-reconcile');
        return result;
    } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : '매입매출 누락 오더 입력 중 오류가 발생했습니다.' };
    }
}
