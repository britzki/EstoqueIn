import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError, notFound } from '../../lib/errors.js';
import { param } from '../../lib/http.js';
import { formatCents } from '../../lib/money.js';
import { paginated, paginationSchema, toSkipTake } from '../../lib/pagination.js';
import { optionalText } from '../../lib/validation.js';
import { actorOf, diff, recordAudit, recordUpdate } from '../../lib/audit.js';
import { can } from '../../auth/permissions.js';
import { currentUser, requirePermission } from '../../middleware/auth.js';
import { getRepurchaseReminders } from './repurchase.js';
import { getCustomerLoyalty } from '../loyalty/loyalty.service.js';
import {
  accountPaymentSchema,
  cancelAccountPayment,
  getAccountStatement,
  getBalances,
  getCustomerBalance,
  listDebtors,
  receiveAccountPayment,
} from './account.js';

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
  /** Limite de fiado em centavos; null = sem limite. */
  creditLimitCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  /** Fiado que já devia antes do sistema (do caderno), em centavos. */
  openingBalanceCents: z.number().int().min(0).max(100_000_000).optional(),
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
  const balances = await getBalances(data.map((customer) => customer.id));
  res.json(
    paginated(
      data.map((customer) => ({ ...customer, balanceCents: balances.get(customer.id) ?? 0 })),
      total,
      filters,
    ),
  );
});

/** Recompras previstas: clientes que costumam levar um produto de tempos em tempos. */
customersRoutes.get('/reminders', async (req, res) => {
  const days = z.coerce.number().int().min(0).max(60).default(7).parse(req.query.days);
  res.json(await getRepurchaseReminders(days));
});

/** Fiado: quem está devendo, quanto e desde quando. */
customersRoutes.get('/debtors', async (_req, res) => {
  res.json(await listDebtors());
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
  res.json({ ...customer, reminders, balanceCents: await getCustomerBalance(customer.id) });
});

/** Cartão fidelidade do cliente: progresso e brindes disponíveis. */
customersRoutes.get('/:id/loyalty', async (req, res) => {
  res.json(await getCustomerLoyalty(param(req, 'id')));
});

/** Extrato do fiado: vendas, devoluções e pagamentos, com o saldo após cada lançamento. */
customersRoutes.get('/:id/account', async (req, res) => {
  res.json(await getAccountStatement(param(req, 'id')));
});

customersRoutes.post('/:id/payments', requirePermission('sales:create'), async (req, res) => {
  const input = accountPaymentSchema.parse(req.body);
  const result = await receiveAccountPayment(param(req, 'id'), input, currentUser(req).id);
  await recordAudit(actorOf(req), {
    action: 'CREATE',
    entity: 'CustomerPayment',
    entityId: result.payment.id,
    summary:
      `Fiado de ${result.customer.name}: recebido ${formatCents(input.amountCents)} ` +
      `(${input.method}), em aberto ${formatCents(result.balanceCents)}`,
  });
  res.status(201).json(result);
});

/** Estorno de pagamento de fiado lançado por engano (gerente ou administrador). */
customersRoutes.post('/:id/payments/:paymentId/cancel', requirePermission('sales:cancel'), async (req, res) => {
  const { reason } = z
    .object({ reason: z.string().trim().min(3, 'Informe o motivo do estorno').max(160) })
    .parse(req.body);
  const result = await cancelAccountPayment(param(req, 'id'), param(req, 'paymentId'), reason, currentUser(req).id);
  await recordAudit(actorOf(req), {
    action: 'UPDATE',
    entity: 'CustomerPayment',
    entityId: result.payment.id,
    summary:
      `Fiado de ${result.customer.name}: pagamento de ${formatCents(result.payment.amountCents)} estornado (${reason}), ` +
      `em aberto ${formatCents(result.balanceCents)}`,
  });
  res.json(result);
});

/** Limite de fiado é decisão do gerente: o operador cadastra clientes, mas não mexe no limite. */
function assertCanSetLimit(
  req: Parameters<typeof currentUser>[0],
  data: { creditLimitCents?: number | null; openingBalanceCents?: number },
) {
  if (
    (data.creditLimitCents !== undefined || data.openingBalanceCents !== undefined) &&
    !can(currentUser(req).role, 'sales:cancel')
  ) {
    throw new AppError(403, 'Só gerente ou administrador define o limite e o fiado anterior', 'FORBIDDEN');
  }
}

customersRoutes.post('/', requirePermission('sales:create'), async (req, res) => {
  const data = customerSchema.parse(req.body);
  assertCanSetLimit(req, data);
  const customer = await prisma.customer.create({ data });
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
  if (
    (data.creditLimitCents !== undefined && data.creditLimitCents !== before.creditLimitCents) ||
    (data.openingBalanceCents !== undefined && data.openingBalanceCents !== before.openingBalanceCents)
  ) {
    assertCanSetLimit(req, data);
  }
  const customer = await prisma.customer.update({ where: { id: before.id }, data });
  await recordUpdate(actorOf(req), {
    entity: 'Customer',
    entityId: customer.id,
    summary: `Cliente ${customer.name} alterado`,
    changes: diff(before, data, ['name', 'phone', 'notes', 'creditLimitCents', 'openingBalanceCents', 'active']),
  });
  res.json(customer);
});
