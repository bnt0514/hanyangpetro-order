/**
 * Password helpers — bcryptjs (pure JS, works on Windows without native build).
 *
 * Default password policy for B2B portal users:
 *   비밀번호 = 사업자등록번호의 숫자만 (e.g. "123-45-67890" -> "1234567890")
 *
 * Default password policy for staff (initial):
 *   비밀번호 = 사번 또는 관리자가 부여한 임시 비밀번호
 */
import bcrypt from 'bcryptjs';

export const BCRYPT_ROUNDS = 10;

export function normalizeBusinessNumber(input: string): string {
    return input.replace(/\D/g, '');
}

export async function hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
    if (!hash) return false;
    return bcrypt.compare(plain, hash);
}

/** Default password = digits-only business number. */
export async function defaultCustomerPasswordHash(businessNumber: string): Promise<string> {
    return hashPassword(normalizeBusinessNumber(businessNumber));
}
