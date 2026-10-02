import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { param } from '../../lib/http.js';
import { actorOf, diff, recordAudit, recordUpdate } from '../../lib/audit.js';
import { notFound } from '../../lib/errors.js';
import { paginated, paginationSchema, toSkipTake } from '../../lib/pagination.js';
import { optionalText, queryBoolean } from '../../lib/validation.js';
import { requirePermission } from '../../middleware/auth.js';

export const suppliersRoutes = Router();

const supplierSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(150),
  document: optionalText(20),
  email: z.preprocess((value) => (value === '' ? null : value), z.email('E-mail inválido').nullable().optional()),
  phone: optionalText(30),
  contactName: optionalText(120),
  notes: optionalText(1000),
  active: z.boolean().optional(),
});

const filtersSchema = paginationSchema.extend({
  search: z.string().trim().optional(),
  active: queryBoolean.optional(),
});

suppliersRoutes.get('/', async (req, res) => {
  const filters = filtersSchema.parse(req.query);
  const where: Prisma.SupplierWhereInput = {
    active: filters.active,
    ...(filters.search && {
      OR: [{ name: { contains: filters.search } }, { document: { contains: filters.search } }],
    }),
  };

  const [data, total] = await prisma.$transaction([
    prisma.supplier.findMany({
      where,
      include: { _count: { select: { products: true } } },
      orderBy: { name: 'asc' },
      ...toSkipTake(filters),
    }),
    prisma.supplier.count({ where }),
  ]);
  res.json(paginated(data, total, filters));
});

suppliersRoutes.get('/:id', async (req, res) => {
  const supplier = await prisma.supplier.findUnique({
    where: { id: param(req, 'id') },
    include: { products: { select: { id: true, sku: true, name: true }, orderBy: { name: 'asc' } } },
  });
  if (!supplier) throw notFound('Fornecedor');
  res.json(supplier);
});

suppliersRoutes.post('/', requirePermission('suppliers:write'), async (req, res) => {
  const supplier = await prisma.supplier.create({ data: supplierSchema.parse(req.body) });
  await recordAudit(actorOf(req), {
    action: 'CREATE',
    entity: 'Supplier',
    entityId: supplier.id,
    summary: `Fornecedor ${supplier.name} cadastrado`,
  });
  res.status(201).json(supplier);
});

suppliersRoutes.patch('/:id', requirePermission('suppliers:write'), async (req, res) => {
  const data = supplierSchema.partial().parse(req.body);
  const before = await prisma.supplier.findUnique({ where: { id: param(req, 'id') } });
  if (!before) throw notFound('Fornecedor');
  const supplier = await prisma.supplier.update({ where: { id: before.id }, data });
  await recordUpdate(actorOf(req), {
    entity: 'Supplier',
    entityId: supplier.id,
    summary: `Fornecedor ${supplier.name} alterado`,
    changes: diff(before, data, ['name', 'document', 'email', 'phone', 'contactName', 'notes', 'active']),
  });
  res.json(supplier);
});
