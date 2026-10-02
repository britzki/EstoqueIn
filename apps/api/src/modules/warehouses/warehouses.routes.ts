import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { param } from '../../lib/http.js';
import { notFound } from '../../lib/errors.js';
import { actorOf, diff, recordAudit, recordUpdate } from '../../lib/audit.js';
import { optionalText } from '../../lib/validation.js';
import { roundQty } from '../../lib/quantity.js';
import { requirePermission } from '../../middleware/auth.js';

export const warehousesRoutes = Router();

const warehouseSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,12}$/, 'Use de 2 a 12 letras, números ou hífen'),
  name: z.string().trim().min(2, 'Informe o nome').max(100),
  address: optionalText(255),
  active: z.boolean().optional(),
});

warehousesRoutes.get('/', async (_req, res) => {
  const [warehouses, totals, openAlerts] = await Promise.all([
    prisma.warehouse.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] }),
    prisma.stockLevel.groupBy({
      by: ['warehouseId'],
      _sum: { quantity: true },
      _count: { _all: true },
      where: { quantity: { gt: 0 } },
    }),
    prisma.stockAlert.groupBy({ by: ['warehouseId'], _count: { _all: true }, where: { status: 'OPEN' } }),
  ]);

  res.json(
    warehouses.map((warehouse) => {
      const total = totals.find((t) => t.warehouseId === warehouse.id);
      return {
        ...warehouse,
        totalUnits: roundQty(total?._sum.quantity ?? 0),
        productsInStock: total?._count._all ?? 0,
        openAlerts: openAlerts.find((a) => a.warehouseId === warehouse.id)?._count._all ?? 0,
      };
    }),
  );
});

warehousesRoutes.post('/', requirePermission('warehouses:write'), async (req, res) => {
  const warehouse = await prisma.warehouse.create({ data: warehouseSchema.parse(req.body) });
  await recordAudit(actorOf(req), {
    action: 'CREATE',
    entity: 'Warehouse',
    entityId: warehouse.id,
    summary: `Estoque ${warehouse.name} cadastrado`,
  });
  res.status(201).json(warehouse);
});

warehousesRoutes.patch('/:id', requirePermission('warehouses:write'), async (req, res) => {
  const data = warehouseSchema.partial().parse(req.body);
  const before = await prisma.warehouse.findUnique({ where: { id: param(req, 'id') } });
  if (!before) throw notFound('Estoque');
  const warehouse = await prisma.warehouse.update({ where: { id: before.id }, data });
  await recordUpdate(actorOf(req), {
    entity: 'Warehouse',
    entityId: warehouse.id,
    summary: `Estoque ${warehouse.name} alterado`,
    changes: diff(before, data, ['code', 'name', 'address', 'active']),
  });
  res.json(warehouse);
});
