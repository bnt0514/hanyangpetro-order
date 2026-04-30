/**
 * 한화 H-CRM 자격증명 관리
 * - 비밀번호는 SystemSetting(DB)에 저장. DB 우선, 없으면 .env fallback.
 * - 양희철 대표(EXECUTIVE) 또는 차성식 관리자(ADMIN)만 변경 가능.
 */
import { prisma } from '@/lib/db';

export const HANWHA_PASSWORD_KEY = 'HANWHA_PASSWORD';
export const HANWHA_USERNAME_KEY = 'HANWHA_USERNAME';

/** 비밀번호 변경 권한이 있는 역할 */
export const HANWHA_MANAGER_ROLES = ['EXECUTIVE', 'ADMIN'] as const;

export function canManageHanwhaCredentials(role?: string | null): boolean {
    if (!role) return false;
    return (HANWHA_MANAGER_ROLES as readonly string[]).includes(role);
}

export async function getHanwhaUsername(): Promise<string | null> {
    const row = await prisma.systemSetting.findUnique({ where: { key: HANWHA_USERNAME_KEY } });
    return row?.value ?? process.env.HANWHA_USERNAME ?? null;
}

export async function getHanwhaPassword(): Promise<string | null> {
    const row = await prisma.systemSetting.findUnique({ where: { key: HANWHA_PASSWORD_KEY } });
    return row?.value ?? process.env.HANWHA_PASSWORD ?? null;
}

/** 비밀번호 출처(어디서 로드되는지) — UI 표시용 */
export async function getHanwhaPasswordSource(): Promise<'db' | 'env' | 'none'> {
    const row = await prisma.systemSetting.findUnique({ where: { key: HANWHA_PASSWORD_KEY } });
    if (row?.value) return 'db';
    if (process.env.HANWHA_PASSWORD) return 'env';
    return 'none';
}

export async function getHanwhaPasswordMeta(): Promise<{
    source: 'db' | 'env' | 'none';
    updatedAt: Date | null;
    updatedById: string | null;
    masked: string;
}> {
    const row = await prisma.systemSetting.findUnique({ where: { key: HANWHA_PASSWORD_KEY } });
    const value = row?.value ?? process.env.HANWHA_PASSWORD ?? '';
    const source: 'db' | 'env' | 'none' = row?.value ? 'db' : value ? 'env' : 'none';
    return {
        source,
        updatedAt: row?.updatedAt ?? null,
        updatedById: row?.updatedById ?? null,
        masked: value ? `${value.slice(0, 2)}${'*'.repeat(Math.max(0, value.length - 2))}` : '',
    };
}

export async function setHanwhaPassword(value: string, userId: string | null) {
    await prisma.systemSetting.upsert({
        where: { key: HANWHA_PASSWORD_KEY },
        update: { value, updatedById: userId },
        create: {
            key: HANWHA_PASSWORD_KEY,
            value,
            updatedById: userId,
            description: '한화 H-CRM 로그인 비밀번호',
        },
    });
}
