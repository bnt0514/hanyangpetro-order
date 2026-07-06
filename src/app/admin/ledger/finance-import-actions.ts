'use server';

import { auth } from '@/lib/auth';
import { applyFinanceImportFromBuffer, listFinanceWorkbookSheets, previewFinanceImportFromBuffer } from '@/lib/finance-import';
import { canViewAllStaffData } from '@/lib/staff-permissions';
import { revalidatePath } from 'next/cache';

async function requireYangHeeCheol() {
    const session = await auth();
    if (!session?.user || session.user.userKind !== 'staff' || !canViewAllStaffData(session.user)) {
        return null;
    }
    return session.user;
}

export async function previewFinanceSheet(sheetSpec: string) {
    const user = await requireYangHeeCheol();
    if (!user) return { ok: false as const, error: '입출금 업데이트는 양희철만 사용할 수 있습니다.' };
    return { ok: false as const, error: '파일을 선택한 뒤 시트를 불러와주세요.' };
}

export async function importFinanceSheet(sheetSpec: string, allowDuplicates: boolean) {
    const user = await requireYangHeeCheol();
    if (!user) return { ok: false as const, error: '입출금 업데이트는 양희철만 사용할 수 있습니다.' };

    void sheetSpec;
    void allowDuplicates;
    return { ok: false as const, error: '파일을 선택한 뒤 시트를 불러와주세요.' };
}

async function readWorkbookFile(formData: FormData) {
    const file = formData.get('financeFile');
    if (!(file instanceof File) || file.size === 0) {
        return { ok: false as const, error: '재무일보 엑셀 파일을 선택해주세요.' };
    }
    const ext = file.name.toLowerCase();
    if (!ext.endsWith('.xlsx') && !ext.endsWith('.xlsm') && !ext.endsWith('.xls')) {
        return { ok: false as const, error: '엑셀 파일(.xlsx, .xlsm, .xls)만 선택할 수 있습니다.' };
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    return { ok: true as const, fileName: file.name, buffer };
}

export async function listFinanceSheets(formData: FormData) {
    const user = await requireYangHeeCheol();
    if (!user) return { ok: false as const, error: '입출금 업데이트는 양희철만 사용할 수 있습니다.' };

    const file = await readWorkbookFile(formData);
    if (!file.ok) return file;
    return listFinanceWorkbookSheets(file.fileName, file.buffer);
}

export async function previewFinanceUpload(formData: FormData) {
    const user = await requireYangHeeCheol();
    if (!user) return { ok: false as const, error: '입출금 업데이트는 양희철만 사용할 수 있습니다.' };

    const file = await readWorkbookFile(formData);
    if (!file.ok) return file;
    const sheetSpec = String(formData.get('sheetSpec') ?? '').trim();
    return previewFinanceImportFromBuffer(file.fileName, file.buffer, sheetSpec);
}

export async function importFinanceUpload(formData: FormData, allowDuplicates: boolean) {
    const user = await requireYangHeeCheol();
    if (!user) return { ok: false as const, error: '입출금 업데이트는 양희철만 사용할 수 있습니다.' };

    const file = await readWorkbookFile(formData);
    if (!file.ok) return file;
    const sheetSpec = String(formData.get('sheetSpec') ?? '').trim();
    const result = await applyFinanceImportFromBuffer(file.fileName, file.buffer, sheetSpec, { allowDuplicates });
    revalidatePath('/admin/ledger');
    revalidatePath('/admin/finance-transactions');
    return result;
}
