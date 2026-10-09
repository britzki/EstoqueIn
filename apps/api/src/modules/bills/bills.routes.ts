import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { conflict, notFound, unprocessable } from '../../lib/errors.js';
import { param } from '../../lib/http.js';
import { formatCents } from '../../lib/money.js';
import { paginated, paginationSchema, toSkipTake } from '../../lib/pagination.js';
import { id, optionalId, optionalText, positiveInt } from '../../lib/validation.js';
import { actorOf, diff, recordAudit, recordUpdate } from '../../lib/audit.js';
import { currentUser, requirePermission } from '../../middleware/auth.js';
import { DAY_MS, startOfToday } from '../../lib/dates.js';
import { receivingMethodSchema } from '../../lib/payments.js';
import { findOpenCashSession } from '../cash/cash.service.js';

/**
 * Contas a pagar: boletos de fornecedor, aluguel, luz...
 * Conta mensal: ao pagar, a do mês seguinte é criada sozinha.
 * Paga com dinheiro da gaveta: vira uma sangria no caixa aberto, para o fechamento bater.
 */
export const billsRoutes = Router();

const billSchema = z.object({
  description: z.string().trim().min(2, 'Descreva a conta').max(120),
  supplierId: optionalId,
  purchaseOrderId: optionalId,
  amountCents: positiveInt,
  dueDate: z.coerce.date(),
  monthly: z.boolean().default(false),
  notes: optionalText(300),
});
// No Zod 4, .partial() ainda aplica os .default(): sem tirar o padrão, um PATCH sem o campo o zeraria.
const billUpdateSchema = billSchema.extend({ monthly: z.boolean() }).partial();

const paySchema = z.object({
  paidAt: z.coerce.date().optional(),
  /** Valor pago, se diferente (juros, desconto). */
  amountCents: positiveInt.optional(),
  method: receivingMethodSchema,
  /** Saiu da gaveta do caixa (só para dinheiro): registra a sangria no caixa aberto deste estoque. */
  fromCash: z.boolean().default(false),
  warehouseId: id.optional(),
});

const include = {
  supplier: { select: { id: true, name: true } },
  purchaseOrder: { select: { id: true, number: true } },
  createdBy: { select: { id: true, name: true } },
  paidBy: { select: { id: true, name: true } },
} as const;

/** Mesmo dia no mês seguinte (31/01 → 28 ou 29/02). */
function nextMonth(date: Date) {
  const next = new Date(date);
  const day = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + 1);
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, lastDay));
  return next;
}

/** Resumo para a tela inicial: vencidas e vencendo nos próximos dias. */
async function getBillsSummary(days: number) {
  const today = startOfToday();
  const limit = new Date(today.getTime() + (days + 1) * DAY_MS);
  const open = await prisma.bill.findMany({
    where: { status: 'OPEN', dueDate: { lt: limit } },
    include: { supplier: { select: { name: true } } },
    orderBy: { dueDate: 'asc' },
  });
  const overdue = open.filter((bill) => bill.dueDate < today);
  const upcoming = open.filter((bill) => bill.dueDate >= today);
  return {
    overdue: { count: overdue.length, totalCents: overdue.reduce((sum, bill) => sum + bill.amountCents, 0) },
    upcoming: { count: upcoming.length, totalCents: upcoming.reduce((sum, bill) => sum + bill.amountCents, 0) },
    bills: open.slice(0, 8),
  };
}

billsRoutes.get('/summary', async (req, res) => {
  const days = z.coerce.number().int().min(1).max(60).default(7).parse(req.query.days);
  res.json(await getBillsSummary(days));
});

billsRoutes.get('/', async (req, res) => {
  const filters = paginationSchema
    .extend({
      status: z.enum(['OPEN', 'PAID', 'CANCELLED']).optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    })
    .parse(req.query);
  const where: Prisma.BillWhereInput = {
    status: filters.status,
    ...((filters.from || filters.to) && { dueDate: { gte: filters.from, lte: filters.to } }),
  };
  const [data, total, openTotal] = await prisma.$transaction([
    prisma.bill.findMany({
      where,
      include,
      orderBy: filters.status === 'PAID' ? { paidAt: 'desc' } : { dueDate: 'asc' },
      ...toSkipTake(filters),
    }),
    prisma.bill.count({ where }),
    prisma.bill.aggregate({ where: { status: 'OPEN' }, _sum: { amountCents: true } }),
  ]);
  res.json({ ...paginated(data, total, filters), openTotalCents: openTotal._sum.amountCents ?? 0 });
});

billsRoutes.post('/', requirePermission('bills:manage'), async (req, res) => {
  const data = billSchema.parse(req.body);
  if (data.supplierId && !(await prisma.supplier.findUnique({ where: { id: data.supplierId } }))) {
    throw notFound('Fornecedor');
  }
  if (data.purchaseOrderId && !(await prisma.purchaseOrder.findUnique({ where: { id: data.purchaseOrderId } }))) {
    throw notFound('Pedido');
  }
  const bill = await prisma.bill.create({ data: { ...data, createdById: currentUser(req).id }, include });
  await recordAudit(actorOf(req), {
    action: 'CREATE',
    entity: 'Bill',
    entityId: bill.id,
    summary: `Conta a pagar: ${bill.description}, ${formatCents(bill.amountCents)}, vence ${bill.dueDate.toLocaleDateString('pt-BR')}`,
  });
  res.status(201).json(bill);
});

billsRoutes.patch('/:id', requirePermission('bills:manage'), async (req, res) => {
  const data = billUpdateSchema.parse(req.body);
  const before = await prisma.bill.findUnique({ where: { id: param(req, 'id') } });
  if (!before) throw notFound('Conta');
  if (before.status !== 'OPEN') throw conflict('Só dá para alterar conta em aberto');
  const bill = await prisma.bill.update({ where: { id: before.id }, data, include });
  await recordUpdate(actorOf(req), {
    entity: 'Bill',
    entityId: bill.id,
    summary: `Conta a pagar "${bill.description}" alterada`,
    changes: diff(before, data, ['description', 'amountCents', 'dueDate', 'monthly', 'supplierId', 'notes']),
  });
  res.json(bill);
});

billsRoutes.post('/:id/pay', requirePermission('bills:manage'), async (req, res) => {
  const input = paySchema.parse(req.body);
  const userId = currentUser(req).id;
  const { bill, next } = await prisma.$transaction(async (tx) => {
    const current = await tx.bill.findUnique({ where: { id: param(req, 'id') } });
    if (!current) throw notFound('Conta');
    if (current.status !== 'OPEN') throw conflict('Esta conta não está em aberto');
    const amountCents = input.amountCents ?? current.amountCents;

    if (input.fromCash) {
      if (input.method !== 'CASH') throw unprocessable('Só pagamento em dinheiro sai da gaveta do caixa');
      const session = await findOpenCashSession(tx, input.warehouseId);
      if (!session)
        throw unprocessable('O caixa está fechado. Abra o caixa para pagar com o dinheiro da gaveta.', 'CASH_CLOSED');
      await tx.cashMovement.create({
        data: {
          sessionId: session.id,
          type: 'WITHDRAWAL',
          amountCents,
          reason: `Conta paga: ${current.description}`.slice(0, 160),
          userId,
        },
      });
    }

    const paid = await tx.bill.update({
      where: { id: current.id },
      data: {
        status: 'PAID',
        paidAt: input.paidAt ?? new Date(),
        paidAmountCents: amountCents,
        paidMethod: input.method,
        paidFromCash: input.fromCash,
        paidById: userId,
      },
      include,
    });
    // Conta mensal: já deixa lançada a do mês seguinte, com o valor de referência.
    const following = current.monthly
      ? await tx.bill.create({
          data: {
            description: current.description,
            supplierId: current.supplierId,
            amountCents: current.amountCents,
            dueDate: nextMonth(current.dueDate),
            monthly: true,
            notes: current.notes,
            createdById: userId,
          },
        })
      : null;
    return { bill: paid, next: following };
  });
  await recordAudit(actorOf(req), {
    action: 'UPDATE',
    entity: 'Bill',
    entityId: bill.id,
    summary:
      `Conta paga: ${bill.description}, ${formatCents(bill.paidAmountCents ?? 0)}` +
      (bill.paidFromCash ? ' (dinheiro da gaveta)' : '') +
      (next ? `; próxima vence ${next.dueDate.toLocaleDateString('pt-BR')}` : ''),
  });
  res.json({ ...bill, next });
});

billsRoutes.post('/:id/cancel', requirePermission('bills:manage'), async (req, res) => {
  const current = await prisma.bill.findUnique({ where: { id: param(req, 'id') } });
  if (!current) throw notFound('Conta');
  // Só cancela se ainda estiver em aberto (um pagamento ao mesmo tempo não pode virar cancelamento).
  const { count } = await prisma.bill.updateMany({
    where: { id: current.id, status: 'OPEN' },
    data: { status: 'CANCELLED' },
  });
  if (count === 0) throw conflict('Esta conta não está em aberto');
  const bill = await prisma.bill.findUniqueOrThrow({ where: { id: current.id }, include });
  await recordAudit(actorOf(req), {
    action: 'UPDATE',
    entity: 'Bill',
    entityId: bill.id,
    summary: `Conta a pagar "${bill.description}" cancelada`,
  });
  res.json(bill);
});
