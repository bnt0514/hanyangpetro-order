/**
 * Prisma Client singleton.
 * Avoids connection-pool exhaustion in Next.js dev hot-reload.
 */
import { PrismaClient } from '@prisma/client';
import { scheduleRealtimeBackup } from '@/lib/realtime-backup';

const WRITE_OPERATIONS = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);

function createPrismaClient() {
    return new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    }).$extends({
        query: {
            $allModels: {
                async $allOperations({ model, operation, args, query }) {
                    const result = await query(args);
                    if (WRITE_OPERATIONS.has(operation)) {
                        scheduleRealtimeBackup(`${model}.${operation}`);
                    }
                    return result;
                },
            },
        },
    });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
    globalForPrisma.prisma ??
    (createPrismaClient() as unknown as PrismaClient);

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
