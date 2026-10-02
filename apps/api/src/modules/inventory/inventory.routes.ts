import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { param } from '../../lib/http.js';
import { notFound } from '../../lib/errors.js';
import { id, optionalText } from '../../lib/validation.js';
import { nonNegativeQty, positiveQty } from '../../lib/quantity.js';
import { currentUser, requirePermission } from '../../middleware/auth.js';
import { cancelInventory, completeInventory, countByBarcode, openInventory, setCount } from './inventory.service.js';

export const inventoryRoutes = Router();

const createSchema = z.object({
  warehouseId: id,
  category: optionalText(60),
  notes: optionalText(500),
});

const countSchema = z.object({ countedQuantity: nonNegativeQty.nullable() });

const scanSchema = z.object({
  barcode: z.string().trim().min(1, 'Informe o código'),
  quantity: positiveQty.default(1),
  mode: z.enum(['add', 'set']).default('add'),
});

inventoryRoutes.get('/', async (_req, res) => {
  const inventories = await prisma.inventory.findMany({
    include: {
      warehouse: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const counted = await prisma.inventoryItem.groupBy({
    by: ['inventoryId'],
    where: { countedQuantity: { not: null } },
    _count: { _all: true },
  });

  res.json(
    inventories.map(({ _count, ...inventory }) => ({
      ...inventory,
      totalItems: _count.items,
      countedItems: counted.find((c) => c.inventoryId === inventory.id)?._count._all ?? 0,
    })),
  );
});

inventoryRoutes.get('/:id', async (req, res) => {
  const inventory = await prisma.inventory.findUnique({
    where: { id: param(req, 'id') },
    include: {
      warehouse: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      items: {
        include: {
          product: { select: { id: true, sku: true, name: true, barcode: true, unit: true, category: true } },
        },
        orderBy: { product: { name: 'asc' } },
      },
    },
  });
  if (!inventory) throw notFound('Inventário');
  res.json(inventory);
});

inventoryRoutes.post('/', requirePermission('inventory:manage'), async (req, res) => {
  const inventory = await openInventory(createSchema.parse(req.body), currentUser(req).id);
  res.status(201).json(inventory);
});

inventoryRoutes.patch('/:id/items/:itemId', requirePermission('inventory:count'), async (req, res) => {
  const { countedQuantity } = countSchema.parse(req.body);
  res.json(await setCount(param(req, 'id'), param(req, 'itemId'), countedQuantity));
});

inventoryRoutes.post('/:id/scan', requirePermission('inventory:count'), async (req, res) => {
  const { barcode, quantity, mode } = scanSchema.parse(req.body);
  res.json(await countByBarcode(param(req, 'id'), barcode, quantity, mode));
});

inventoryRoutes.post('/:id/complete', requirePermission('inventory:manage'), async (req, res) => {
  res.json(await completeInventory(param(req, 'id'), currentUser(req).id));
});

inventoryRoutes.post('/:id/cancel', requirePermission('inventory:manage'), async (req, res) => {
  res.json(await cancelInventory(param(req, 'id')));
});
