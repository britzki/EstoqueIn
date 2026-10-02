import { PrismaClient, type Prisma } from '@prisma/client';

export const prisma = new PrismaClient();

/** Cliente usado dentro de `prisma.$transaction(async (tx) => ...)`. */
export type Tx = Prisma.TransactionClient;
