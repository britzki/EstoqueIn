import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { param } from '../../lib/http.js';
import { conflict, notFound } from '../../lib/errors.js';
import { paginated, paginationSchema, toSkipTake } from '../../lib/pagination.js';
import { currentUser, requirePermission } from '../../middleware/auth.js';

export const alertsRoutes = Router();

const filtersSchema = paginationSchema.extend({
  status: z.enum(['OPEN', 'RESOLVED']).optional(),
  type: z.enum(['LOW_STOCK', 'OUT_OF_STOCK', 'NEGATIVE_STOCK']).optional(),
  warehouseId: z.string().optional(),
  productId: z.string().optional(),
});

alertsRoutes.get('/', async (req, res) => {
  const filters = filtersSchema.parse(req.query);
  const where = {
    status: filters.status,
    type: filters.type,
    warehouseId: filters.warehouseId,
    productId: filters.productId,
  };

  const [data, total] = await prisma.$transaction([
    prisma.stockAlert.findMany({
      where,
      include: {
        product: { select: { id: true, sku: true, name: true, unit: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        acknowledgedBy: { select: { id: true, name: true } },
      },
      orderBy: [{ status: 'asc' }, { type: 'desc' }, { updatedAt: 'desc' }],
      ...toSkipTake(filters),
    }),
    prisma.stockAlert.count({ where }),
  ]);
  res.json(paginated(data, total, filters));
});

alertsRoutes.get('/summary', async (_req, res) => {
  const grouped = await prisma.stockAlert.groupBy({
    by: ['type'],
    where: { status: 'OPEN' },
    _count: { _all: true },
  });
  const count = (type: string) => grouped.find((group) => group.type === type)?._count._all ?? 0;
  const unacknowledged = await prisma.stockAlert.count({ where: { status: 'OPEN', acknowledgedAt: null } });

  res.json({
    open: count('LOW_STOCK') + count('OUT_OF_STOCK') + count('NEGATIVE_STOCK'),
    lowStock: count('LOW_STOCK'),
    outOfStock: count('OUT_OF_STOCK'),
    negative: count('NEGATIVE_STOCK'),
    unacknowledged,
  });
});

alertsRoutes.post('/:id/acknowledge', requirePermission('alerts:ack'), async (req, res) => {
  const alert = await prisma.stockAlert.findUnique({ where: { id: param(req, 'id') } });
  if (!alert) throw notFound('Alerta');
  if (alert.status !== 'OPEN') throw conflict('Somente alertas abertos podem ser reconhecidos');

  const updated = await prisma.stockAlert.update({
    where: { id: alert.id },
    data: { acknowledgedAt: new Date(), acknowledgedById: currentUser(req).id },
  });
  res.json(updated);
});
