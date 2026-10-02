import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { paginated, paginationSchema, toSkipTake } from '../../lib/pagination.js';

export const auditRoutes = Router();

const filtersSchema = paginationSchema.extend({
  entity: z.string().optional(),
  entityId: z.string().optional(),
  action: z.string().optional(),
  search: z.string().trim().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/** Histórico de alterações, do mais recente para o mais antigo. Só leitura: não há rota para apagar. */
auditRoutes.get('/', async (req, res) => {
  const filters = filtersSchema.parse(req.query);
  const where: Prisma.AuditLogWhereInput = {
    entity: filters.entity,
    entityId: filters.entityId,
    action: filters.action,
    createdAt: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined,
    ...(filters.search && {
      OR: [{ summary: { contains: filters.search } }, { userName: { contains: filters.search } }],
    }),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.auditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...toSkipTake(filters) }),
    prisma.auditLog.count({ where }),
  ]);

  const data = rows.map((row) => ({ ...row, changes: row.changes ? JSON.parse(row.changes) : null }));
  res.json(paginated(data, total, filters));
});
