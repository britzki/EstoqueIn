import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { notFound } from '../../lib/errors.js';
import { param } from '../../lib/http.js';
import { paginated, paginationSchema, toSkipTake } from '../../lib/pagination.js';
import { optionalText } from '../../lib/validation.js';
import { actorOf, diff, recordAudit, recordUpdate } from '../../lib/audit.js';
import { requirePermission } from '../../middleware/auth.js';
import { getRepurchaseReminders } from './repurchase.js';

export const customersRoutes = Router();

const customerSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  phone: z.preprocess(
    (value) => (typeof value === 'string' ? value.replace(/\D/g, '') || null : value),
    z
      .string()
      .regex(/^\d{10,13}$/, 'Telefone com DDD, só números')
      .nullable()
      .optional(),
  ),
  notes: optionalText(500),
  active: z.boolean().optional(),
});

customersRoutes.get('/', async (req, res) => {
  const filters = paginationSchema.extend({ search: z.string().trim().optional() }).parse(req.query);
  const digits = filters.search?.replace(/\D/g, '');
  const where: Prisma.CustomerWhereInput = {
    active: true,
    ...(filters.search && {
      OR: [{ name: { contains: filters.search } }, ...(digits ? [{ phone: { contains: digits } }] : [])],
    }),
  };
  const [data, total] = await prisma.$transaction([
    prisma.customer.findMany({
      where,
      include: { _count: { select: { sales: { where: { status: 'COMPLETED' } } } } },
      orderBy: { name: 'asc' },
      ...toSkipTake(filters),
    }),
    prisma.customer.count({ where }),
  ]);
  res.json(paginated(data, total, filters));
});

/** Recompras previstas: clientes que costumam levar um produto de tempos em tempos. */
customersRoutes.get('/reminders', async (req, res) => {
  const days = z.coerce.number().int().min(0).max(60).default(7).parse(req.query.days);
  res.json(await getRepurchaseReminders(days));
});

customersRoutes.get('/:id', async (req, res) => {
  const customer = await prisma.customer.findUnique({
    where: { id: param(req, 'id') },
    include: {
      sales: {
        where: { status: 'COMPLETED' },
        include: { items: { select: { description: true, quantity: true, unit: true, totalCents: true } } },
        orderBy: { createdAt: 'desc' },
        take: 30,
      },
    },
  });
  if (!customer) throw notFound('Cliente');
  const reminders = (await getRepurchaseReminders(365)).filter((reminder) => reminder.customer.id === customer.id);
  res.json({ ...customer, reminders });
});

customersRoutes.post('/', requirePermission('sales:create'), async (req, res) => {
  const customer = await prisma.customer.create({ data: customerSchema.parse(req.body) });
  await recordAudit(actorOf(req), {
    action: 'CREATE',
    entity: 'Customer',
    entityId: customer.id,
    summary: `Cliente ${customer.name} cadastrado`,
  });
  res.status(201).json(customer);
});

customersRoutes.patch('/:id', requirePermission('sales:create'), async (req, res) => {
  const data = customerSchema.partial().parse(req.body);
  const before = await prisma.customer.findUnique({ where: { id: param(req, 'id') } });
  if (!before) throw notFound('Cliente');
  const customer = await prisma.customer.update({ where: { id: before.id }, data });
  await recordUpdate(actorOf(req), {
    entity: 'Customer',
    entityId: customer.id,
    summary: `Cliente ${customer.name} alterado`,
    changes: diff(before, data, ['name', 'phone', 'notes', 'active']),
  });
  res.json(customer);
});
