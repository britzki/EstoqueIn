import { Router } from 'express';
import multer from 'multer';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { param } from '../../lib/http.js';
import { badRequest, conflict, notFound, unprocessable } from '../../lib/errors.js';
import { generateInternalEan13 } from '../../lib/barcode.js';
import { paginated, toSkipTake } from '../../lib/pagination.js';
import { queryBoolean } from '../../lib/validation.js';
import { FRACTIONAL_UNITS, isWholeNumber, roundQty } from '../../lib/quantity.js';
import { currentUser, requirePermission } from '../../middleware/auth.js';
import { actorOf, diff, recordAudit, recordUpdate } from '../../lib/audit.js';
import { evaluateStockAlert, publishAlertChanges } from '../alerts/alerts.service.js';
import { decodeCsv, IMPORT_TEMPLATE, importProducts } from './products.import.js';
import { minQuantitySchema, productFiltersSchema, productSchema, productUpdateSchema } from './products.schemas.js';
import { sendCsv } from '../../lib/csv.js';

export const productsRoutes = Router();

const PRODUCT_AUDIT_FIELDS = [
  'sku',
  'name',
  'barcode',
  'category',
  'unit',
  'costCents',
  'priceCents',
  'minStock',
  'active',
  'fractional',
  'scaleCode',
  'quickSale',
  'supplierId',
  'sourceProductId',
  'sourceYield',
  'description',
] as const;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const isCsv = file.originalname.toLowerCase().endsWith('.csv') || file.mimetype.includes('csv');
    if (!isCsv) return callback(badRequest('Envie um arquivo .csv'));
    callback(null, true);
  },
});

/** Reavalia os alertas de um produto em todos os estoques (ex.: depois de mudar o mínimo). */
async function reevaluateProductAlerts(productId: string, warehouseId?: string) {
  const changes = await prisma.$transaction(async (tx) => {
    const levels = await tx.stockLevel.findMany({ where: { productId, warehouseId }, select: { warehouseId: true } });
    const results = [];
    for (const level of levels) results.push(await evaluateStockAlert(tx, productId, level.warehouseId));
    return results;
  });
  publishAlertChanges(changes);
}

productsRoutes.get('/', async (req, res) => {
  const filters = productFiltersSchema.parse(req.query);
  const where: Prisma.ProductWhereInput = {
    active: filters.active,
    category: filters.category,
    supplierId: filters.supplierId,
    ...(filters.withAlerts && { alerts: { some: { status: 'OPEN' } } }),
    ...(filters.search && {
      OR: [
        { name: { contains: filters.search } },
        { sku: { contains: filters.search.toUpperCase() } },
        { barcode: { contains: filters.search } },
      ],
    }),
  };

  const [products, total] = await prisma.$transaction([
    prisma.product.findMany({
      where,
      include: {
        supplier: { select: { id: true, name: true } },
        stockLevels: { select: { quantity: true } },
        _count: { select: { alerts: { where: { status: 'OPEN' } } } },
      },
      orderBy: { name: 'asc' },
      ...toSkipTake(filters),
    }),
    prisma.product.count({ where }),
  ]);

  const data = products.map(({ stockLevels, _count, ...product }) => ({
    ...product,
    totalQuantity: roundQty(stockLevels.reduce((sum, level) => sum + level.quantity, 0)),
    openAlerts: _count.alerts,
  }));
  res.json(paginated(data, total, filters));
});

productsRoutes.get('/categories', async (_req, res) => {
  const rows = await prisma.product.findMany({
    where: { category: { not: null } },
    distinct: ['category'],
    select: { category: true },
    orderBy: { category: 'asc' },
  });
  res.json(rows.map((row) => row.category));
});

productsRoutes.get('/import/template', (_req, res) => {
  sendCsv(res, 'modelo-importacao-produtos.csv', IMPORT_TEMPLATE);
});

productsRoutes.post('/import', requirePermission('products:import'), upload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('Envie o arquivo no campo "file"');
  const dryRun = queryBoolean.default(false).parse(req.query.dryRun);
  const warehouseId =
    typeof req.query.warehouseId === 'string' && req.query.warehouseId ? req.query.warehouseId : undefined;
  const report = await importProducts(decodeCsv(req.file.buffer), { dryRun, warehouseId, userId: currentUser(req).id });
  if (!dryRun) {
    await recordAudit(actorOf(req), {
      action: 'IMPORT',
      entity: 'Product',
      summary:
        `Importação de planilha: ${report.created} produto(s) criado(s), ${report.updated} atualizado(s)` +
        (report.stockRows ? `, ${report.stockRows} saldo(s) informado(s)` : ''),
    });
  }
  res.status(dryRun ? 200 : 201).json(report);
});

productsRoutes.get('/by-barcode/:code', async (req, res) => {
  const product = await prisma.product.findUnique({
    where: { barcode: param(req, 'code') },
    include: { stockLevels: { include: { warehouse: { select: { id: true, name: true } } } } },
  });
  if (!product) throw notFound('Produto com este código de barras');
  res.json(product);
});

productsRoutes.get('/:id', async (req, res) => {
  const product = await prisma.product.findUnique({
    where: { id: param(req, 'id') },
    include: {
      supplier: { select: { id: true, name: true } },
      stockLevels: true,
      alerts: { where: { status: 'OPEN' }, include: { warehouse: { select: { id: true, name: true } } } },
      sourceProduct: { select: { id: true, sku: true, name: true, unit: true, costCents: true } },
      bulkProducts: { select: { id: true, sku: true, name: true, unit: true, sourceYield: true, active: true } },
      supplierProducts: { include: { supplier: { select: { id: true, name: true } } }, orderBy: { updatedAt: 'desc' } },
    },
  });
  if (!product) throw notFound('Produto');

  // Mostra o saldo em todos os estoques ativos, inclusive onde o produto ainda não tem saldo.
  const warehouses = await prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
  const stock = warehouses.map((warehouse) => {
    const level = product.stockLevels.find((l) => l.warehouseId === warehouse.id);
    return {
      warehouse: { id: warehouse.id, code: warehouse.code, name: warehouse.name },
      quantity: level?.quantity ?? 0,
      minQuantity: level?.minQuantity ?? null,
      effectiveMin: level?.minQuantity ?? product.minStock,
    };
  });

  const { stockLevels, ...rest } = product;
  res.json({ ...rest, stock, totalQuantity: roundQty(stockLevels.reduce((sum, l) => sum + l.quantity, 0)) });
});

/** Regras do vínculo "granel de um produto fechado" e da troca para unidades inteiras. */
async function validateProductRules(
  data: { fractional?: boolean; sourceProductId?: string | null; sourceYield?: number | null },
  productId?: string,
) {
  if (data.sourceProductId) {
    if (data.sourceProductId === productId) throw unprocessable('Um produto não pode ser granel dele mesmo');
    if (!data.sourceYield) throw badRequest('Informe quanto cada unidade do produto de origem rende a granel');
    const source = await prisma.product.findUnique({ where: { id: data.sourceProductId } });
    if (!source) throw notFound('Produto de origem');
    if (source.sourceProductId)
      throw unprocessable(`${source.name} já é um produto a granel e não pode ser origem de outro`);
  }
  if (data.fractional === false && productId) {
    const levels = await prisma.stockLevel.findMany({ where: { productId }, select: { quantity: true } });
    if (levels.some((level) => !isWholeNumber(level.quantity))) {
      throw unprocessable(
        'Este produto tem saldo fracionado. Ajuste o saldo para um número inteiro antes de desmarcar.',
      );
    }
  }
}

productsRoutes.post('/', requirePermission('products:write'), async (req, res) => {
  const data = productSchema.parse(req.body);
  await validateProductRules(data);
  const product = await prisma.product.create({
    data: {
      ...data,
      // Sem indicação explícita, unidades de peso/volume/comprimento já nascem fracionadas.
      fractional: data.fractional ?? FRACTIONAL_UNITS.includes(data.unit ?? 'UN'),
      sourceYield: data.sourceProductId ? data.sourceYield : null,
    },
  });
  await recordAudit(actorOf(req), {
    action: 'CREATE',
    entity: 'Product',
    entityId: product.id,
    summary: `Produto ${product.name} (${product.sku}) cadastrado`,
  });
  res.status(201).json(product);
});

productsRoutes.patch('/:id', requirePermission('products:write'), async (req, res) => {
  const data = productUpdateSchema.parse(req.body);
  await validateProductRules(data, param(req, 'id'));
  const before = await prisma.product.findUnique({ where: { id: param(req, 'id') } });
  if (!before) throw notFound('Produto');
  const product = await prisma.product.update({
    where: { id: before.id },
    data: { ...data, ...(data.sourceProductId === null && { sourceYield: null }) },
  });
  await recordUpdate(actorOf(req), {
    entity: 'Product',
    entityId: product.id,
    summary: `Produto ${product.name} (${product.sku}) alterado`,
    changes: diff(before, data, [...PRODUCT_AUDIT_FIELDS]),
  });
  if (data.minStock !== undefined) await reevaluateProductAlerts(product.id);
  res.json(product);
});

productsRoutes.post('/:id/barcode', requirePermission('products:write'), async (req, res) => {
  const product = await prisma.product.findUnique({ where: { id: param(req, 'id') } });
  if (!product) throw notFound('Produto');
  if (product.barcode) throw conflict('Este produto já possui código de barras');

  for (let attempt = 0; attempt < 5; attempt++) {
    const barcode = generateInternalEan13();
    if (await prisma.product.findUnique({ where: { barcode } })) continue;
    res.json(await prisma.product.update({ where: { id: product.id }, data: { barcode } }));
    return;
  }
  throw conflict('Não foi possível gerar um código único, tente novamente');
});

/** Define (ou remove, com null) um mínimo específico para o produto em um estoque. */
productsRoutes.put('/:id/stock/:warehouseId/min', requirePermission('products:write'), async (req, res) => {
  const { minQuantity } = minQuantitySchema.parse(req.body);
  const productId = param(req, 'id');
  const warehouseId = param(req, 'warehouseId');

  const level = await prisma.stockLevel.upsert({
    where: { productId_warehouseId: { productId, warehouseId } },
    create: { productId, warehouseId, minQuantity },
    update: { minQuantity },
  });
  await reevaluateProductAlerts(productId, warehouseId);
  res.json(level);
});

/** Desfaz o vínculo com o código de um fornecedor (ex.: item da NF-e associado ao produto errado). */
productsRoutes.delete('/:id/supplier-codes/:mappingId', requirePermission('products:write'), async (req, res) => {
  const { count } = await prisma.supplierProduct.deleteMany({
    where: { id: param(req, 'mappingId'), productId: param(req, 'id') },
  });
  if (count === 0) throw notFound('Vínculo');
  res.status(204).end();
});
