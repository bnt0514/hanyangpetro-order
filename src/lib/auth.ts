/**
 * NextAuth (Auth.js v5) configuration.
 *
 * Two credential providers:
 *   - "staff"     — internal employees, login by email + password
 *   - "customer"  — B2B portal users, login by company name + business number
 *                   (where the digits-only business number IS the default password)
 *
 * Session contains discriminated `userKind` so middleware can route accordingly.
 */
import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { prisma } from '@/lib/db';
import { normalizeBusinessNumber, verifyPassword } from '@/lib/password';

declare module 'next-auth' {
    interface Session {
        user: {
            id: string;
            userKind: 'staff' | 'customer';
            role?: string;
            customerId?: string;
            customerName?: string;
        } & DefaultSession['user'];
    }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
    trustHost: true,
    session: { strategy: 'jwt' },
    pages: {
        signIn: '/login',
        error: '/login',
    },
    providers: [
        Credentials({
            id: 'staff',
            name: 'Staff',
            credentials: {
                loginId: { label: '아이디(이름)', type: 'text' },
                password: { label: 'Password', type: 'password' },
            },
            async authorize(creds) {
                const loginId = String(creds?.loginId ?? '').trim();
                const password = String(creds?.password ?? '');
                if (!loginId || !password) return null;

                // Allow lookup by loginId (Korean name) OR by email (legacy)
                const user = await prisma.user.findFirst({
                    where: {
                        OR: [
                            { loginId },
                            { name: loginId },
                            { email: loginId.toLowerCase() },
                        ],
                    },
                });
                if (!user || !user.isActive || !user.passwordHash) return null;

                const ok = await verifyPassword(password, user.passwordHash);
                if (!ok) return null;

                return {
                    id: user.id,
                    name: user.name,
                    email: user.email ?? user.loginId ?? user.name,
                    // these go into JWT via callbacks
                    userKind: 'staff' as const,
                    role: user.role,
                } as never;
            },
        }),
        Credentials({
            id: 'customer',
            name: 'Customer',
            credentials: {
                companyName: { label: '회사명', type: 'text' },
                businessNumber: { label: '사업자등록번호', type: 'text' },
            },
            async authorize(creds) {
                const companyName = String(creds?.companyName ?? '').trim();
                const rawBn = String(creds?.businessNumber ?? '');
                if (!companyName || !rawBn) return null;

                const bn = normalizeBusinessNumber(rawBn);
                if (bn.length < 8) return null;

                // Find customer by name + business number match
                const customer = await prisma.customer.findFirst({
                    where: { companyName, isActive: true },
                });
                if (!customer) return null;

                // Check if there's at least one CustomerUser; if not, auto-bootstrap one
                // using the digits-only business number as the password.
                const customerBn = normalizeBusinessNumber(customer.businessNumber ?? '');
                if (customerBn && customerBn !== bn) return null;

                // Pick the first active customer user (or the bootstrap one)
                let user = await prisma.customerUser.findFirst({
                    where: { customerId: customer.id, isActive: true },
                    orderBy: { createdAt: 'asc' },
                });

                if (!user) {
                    // First-time login: auto-create a default user with the same default password.
                    const { hashPassword } = await import('@/lib/password');
                    user = await prisma.customerUser.create({
                        data: {
                            customerId: customer.id,
                            email: `default+${customer.id}@portal.local`,
                            name: `${customer.companyName} 담당자`,
                            passwordHash: await hashPassword(bn),
                        },
                    });
                } else {
                    // Verify password against stored hash
                    const ok = await verifyPassword(bn, user.passwordHash);
                    if (!ok) return null;
                }

                await prisma.customerUser.update({
                    where: { id: user.id },
                    data: { lastLoginAt: new Date() },
                });

                return {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    userKind: 'customer' as const,
                    customerId: customer.id,
                    customerName: customer.companyName,
                } as never;
            },
        }),
    ],
    callbacks: {
        async jwt({ token, user }) {
            if (user) {
                // user is the object returned from authorize()
                const u = user as unknown as {
                    id: string;
                    userKind: 'staff' | 'customer';
                    role?: string;
                    customerId?: string;
                    customerName?: string;
                };
                token.uid = u.id;
                token.userKind = u.userKind;
                token.role = u.role;
                token.customerId = u.customerId;
                token.customerName = u.customerName;
            }
            return token;
        },
        async session({ session, token }) {
            if (token && session.user) {
                session.user.id = String(token.uid ?? '');
                session.user.userKind = (token.userKind as 'staff' | 'customer') ?? 'staff';
                session.user.role = token.role as string | undefined;
                session.user.customerId = token.customerId as string | undefined;
                session.user.customerName = token.customerName as string | undefined;
            }
            return session;
        },
    },
});
