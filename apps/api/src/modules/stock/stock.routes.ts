import { Router } from 'express';
import { canSeeFinancials, movementsWithoutCost } from '../../lib/visibility.js';
import { localDateTime } from '../../lib/dates.js';
import type { MovementType, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { currentUser, requirePermission } from '../../middleware/auth.js';
import { paginated, toSkipTake } from '../../lib/pagination.js';
import { centsToDecimal, sendCsv, toCsv } from '../../lib/csv.js';
import { adjustStock, fractionate, registerEntry, registerExit, transferStock } from './stock.service.js';
import {
  adjustmentSchema,
  entrySchema,
  exitSchema,
  fractionSchema,
  movementFiltersSchema,
  transferSchema,
} from './stock.schemas.js';

export const stockRoutes = Router();

const MOVEMENT_LABELS: Record<MovementType, string> = {
  ENTRY: 'Entrada',
  EXIT: 'Saída',
  TRANSFER_IN: 'Transferência (entrada)',
  TRANSFER_OUT: 'Transferência (saída)',
  ADJUSTMENT: 'Ajuste',
  FRACTION_OUT: 'Aberto para granel',
  FRACTION_IN: 'Granel recebido',
  SALE_CANCEL: 'Venda cancelada',
  SALE_RETURN: 'Devolução de cliente',
};

stockRoutes.post('/entries', requirePermission('stock:move'), async (req, res) => {
  const result = await registerEntry(entrySchema.parse(req.body), currentUser(req).id);
  res.status(201).json(movementsWithoutCost(req, result));
});

stockRoutes.post('/exits', requirePermission('stock:move'), async (req, res) => {
  const result = await registerExit(exitSchema.parse(req.body), currentUser(req).id);
  res.status(201).json(movementsWithoutCost(req, result));
});

stockRoutes.post('/transfers', requirePermission('stock:move'), async (req, res) => {
  const result = await transferStock(transferSchema.parse(req.body), currentUser(req).id);
  res.status(201).json(movementsWithoutCost(req, result));
});

stockRoutes.post('/adjustments', requirePermission('stock:adjust'), async (req, res) => {
  const result = await adjustStock(adjustmentSchema.parse(req.body), currentUser(req).id);
  res.status(201).json(movementsWithoutCost(req, result));
});

stockRoutes.post('/fractions', requirePermission('stock:move'), async (req, res) => {
  const result = await fractionate(fractionSchema.parse(req.body), currentUser(req).id);
  res.status(201).json(movementsWithoutCost(req, result));
});

stockRoutes.get('/movements', async (req, res) => {
  const filters = movementFiltersSchema.parse(req.query);

  const where: Prisma.StockMovementWhereInput = {
    productId: filters.productId,
    warehouseId: filters.warehouseId,
    userId: filters.userId,
    type: filters.type,
    createdAt: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined,
  };
  const include = {
    product: { select: { id: true, sku: true, name: true, unit: true } },
    warehouse: { select: { id: true, code: true, name: true } },
    supplier: { select: { id: true, name: true } },
    user: { select: { id: true, name: true } },
  } satisfies Prisma.StockMovementInclude;
  const orderBy = [{ createdAt: 'desc' }, { id: 'desc' }] satisfies Prisma.StockMovementOrderByWithRelationInput[];

  if (filters.format === 'csv') {
    const rows = await prisma.stockMovement.findMany({ where, include, orderBy, take: 50_000 });
    const csv = toCsv(rows, [
      { header: 'Data', value: (m) => localDateTime(m.createdAt) },
      { header: 'Tipo', value: (m) => MOVEMENT_LABELS[m.type] },
      { header: 'SKU', value: (m) => m.product.sku },
      { header: 'Produto', value: (m) => m.product.name },
      { header: 'Estoque', value: (m) => m.warehouse.name },
      { header: 'Quantidade', value: (m) => m.quantity },
      { header: 'Saldo após', value: (m) => m.balanceAfter },
      ...(canSeeFinancials(req)
        ? [{ header: 'Custo unitário', value: (m: (typeof rows)[number]) => centsToDecimal(m.unitCostCents) }]
        : []),
      { header: 'Fornecedor', value: (m) => m.supplier?.name },
      { header: 'Documento', value: (m) => m.documentRef },
      { header: 'Motivo', value: (m) => m.reason },
      { header: 'Usuário', value: (m) => m.user.name },
    ]);
    sendCsv(res, 'movimentacoes.csv', csv);
    return;
  }

  const [data, total] = await prisma.$transaction([
    prisma.stockMovement.findMany({ where, include, orderBy, ...toSkipTake(filters) }),
    prisma.stockMovement.count({ where }),
  ]);
  res.json(paginated(movementsWithoutCost(req, data), total, filters));
});

stockRoutes.get('/levels', async (req, res) => {
  const warehouseId = typeof req.query.warehouseId === 'string' ? req.query.warehouseId : undefined;
  const productId = typeof req.query.productId === 'string' ? req.query.productId : undefined;

  const levels = await prisma.stockLevel.findMany({
    where: { warehouseId, productId },
    include: {
      product: { select: { id: true, sku: true, name: true, unit: true, minStock: true } },
      warehouse: { select: { id: true, code: true, name: true } },
    },
    orderBy: { product: { name: 'asc' } },
  });
  res.json(levels.map((level) => ({ ...level, effectiveMin: level.minQuantity ?? level.product.minStock })));
});
