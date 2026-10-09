import { Router } from 'express';
import { canSeeFinancials, saleWithoutCost } from '../../lib/visibility.js';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { param } from '../../lib/http.js';
import { actorOf, recordAudit } from '../../lib/audit.js';
import { paginated, paginationSchema, toSkipTake } from '../../lib/pagination.js';
import { roundQty } from '../../lib/quantity.js';
import { currentUser, requirePermission } from '../../middleware/auth.js';
import {
  cancelSale,
  createReturn,
  createSale,
  getQuickProducts,
  getSale,
  resolveCode,
  returnSchema,
  saleSchema,
} from './sales.service.js';

export const salesRoutes = Router();

const filtersSchema = paginationSchema.extend({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  status: z.enum(['COMPLETED', 'CANCELLED']).optional(),
  warehouseId: z.string().optional(),
});

const cancelSchema = z.object({ reason: z.string().trim().min(3, 'Informe o motivo do cancelamento').max(255) });

salesRoutes.get('/', async (req, res) => {
  const filters = filtersSchema.parse(req.query);
  const where: Prisma.SaleWhereInput = {
    status: filters.status,
    warehouseId: filters.warehouseId,
    createdAt: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined,
  };

  const [data, total] = await prisma.$transaction([
    prisma.sale.findMany({
      where,
      include: {
        payments: true,
        user: { select: { id: true, name: true } },
        _count: { select: { items: true, returns: true } },
      },
      orderBy: { number: 'desc' },
      ...toSkipTake(filters),
    }),
    prisma.sale.count({ where }),
  ]);
  res.json(
    paginated(
      data.map((sale) => saleWithoutCost(req, sale)),
      total,
      filters,
    ),
  );
});

/** Botões rápidos da tela de venda (marcados no cadastro + mais vendidos). */
salesRoutes.get('/quick-products', requirePermission('sales:create'), async (req, res) => {
  const warehouseId = typeof req.query.warehouseId === 'string' ? req.query.warehouseId : undefined;
  res.json(await getQuickProducts(warehouseId));
});

/** Usado pelo caixa: identifica o produto pelo código bipado (código de barras, etiqueta da balança ou SKU). */
salesRoutes.get('/resolve', requirePermission('sales:create'), async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const warehouseId = typeof req.query.warehouseId === 'string' ? req.query.warehouseId : undefined;
  res.json(await resolveCode(code, warehouseId));
});

salesRoutes.get('/:id', async (req, res) => {
  const sale = await getSale(param(req, 'id'));
  // Quanto de cada item ainda pode ser devolvido: vendido menos o que já voltou (as devoluções já vêm na venda).
  const returned = new Map<string, number>();
  for (const saleReturn of sale.returns) {
    for (const item of saleReturn.items)
      returned.set(item.saleItemId, (returned.get(item.saleItemId) ?? 0) + item.quantity);
  }
  res.json(
    saleWithoutCost(req, {
      ...sale,
      items: sale.items.map((item) => ({
        ...item,
        returnable: roundQty(item.quantity - (returned.get(item.id) ?? 0)),
      })),
    }),
  );
});

salesRoutes.post('/:id/returns', requirePermission('sales:cancel'), async (req, res) => {
  const input = returnSchema.parse(req.body);
  const saleReturn = await createReturn(param(req, 'id'), input, currentUser(req).id);
  await recordAudit(actorOf(req), {
    action: 'UPDATE',
    entity: 'Sale',
    entityId: saleReturn.saleId,
    summary: `Devolução na venda nº ${saleReturn.saleNumber}: ${input.reason}`,
  });
  res.status(201).json(canSeeFinancials(req) ? saleReturn : { ...saleReturn, costCents: null });
});

salesRoutes.post('/', requirePermission('sales:create'), async (req, res) => {
  res.status(201).json(saleWithoutCost(req, await createSale(saleSchema.parse(req.body), currentUser(req).id)));
});

salesRoutes.post('/:id/cancel', requirePermission('sales:cancel'), async (req, res) => {
  const { reason } = cancelSchema.parse(req.body);
  const sale = await cancelSale(param(req, 'id'), reason, currentUser(req).id);
  await recordAudit(actorOf(req), {
    action: 'UPDATE',
    entity: 'Sale',
    entityId: sale.id,
    summary: `Venda nº ${sale.number} cancelada: ${reason}`,
  });
  res.json(saleWithoutCost(req, sale));
});
