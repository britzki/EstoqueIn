import { z } from 'zod';
import type { PaymentMethod } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { getStoreSettings } from '../settings/settings.routes.js';
import { conflict, notFound, unprocessable } from '../../lib/errors.js';
import { id, nonNegativeInt, optionalText, positiveInt } from '../../lib/validation.js';

export const openSchema = z.object({ warehouseId: id, openingCents: nonNegativeInt });
export const movementSchema = z.object({
  type: z.enum(['WITHDRAWAL', 'DEPOSIT']),
  amountCents: positiveInt,
  reason: z.string().trim().min(3, 'Informe o motivo').max(160),
});
export const closeSchema = z.object({
  countedCents: nonNegativeInt,
  /** Quanto fica na gaveta para o próximo caixa; o resto é retirado. Padrão: o troco fixo da loja. */
  keptCents: nonNegativeInt.optional(),
  notes: optionalText(500),
});

const METHODS: PaymentMethod[] = ['CASH', 'PIX', 'DEBIT', 'CREDIT', 'OTHER'];

/**
 * Resumo do caixa. O dinheiro esperado na gaveta é:
 * troco inicial + vendas em dinheiro (já sem o troco dado) + suprimentos − sangrias − devoluções em dinheiro.
 * Vendas canceladas não entram (o dinheiro voltou ao cliente).
 */
export async function getCashSummary(sessionId: string) {
  const session = await prisma.cashSession.findUnique({
    where: { id: sessionId },
    include: {
      warehouse: { select: { id: true, name: true } },
      openedBy: { select: { id: true, name: true } },
      closedBy: { select: { id: true, name: true } },
      movements: { include: { user: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
      sales: { include: { payments: true } },
      returns: true,
    },
  });
  if (!session) throw notFound('Caixa');

  const byMethod = Object.fromEntries(METHODS.map((method) => [method, 0])) as Record<PaymentMethod, number>;
  const completed = session.sales.filter((sale) => sale.status === 'COMPLETED');
  for (const sale of completed) {
    let change = sale.changeCents;
    for (const payment of sale.payments) {
      let amount = payment.amountCents;
      if (payment.method === 'CASH' && change > 0) {
        const deducted = Math.min(change, amount);
        amount -= deducted;
        change -= deducted;
      }
      byMethod[payment.method] += amount;
    }
  }
  const refunds = Object.fromEntries(METHODS.map((method) => [method, 0])) as Record<PaymentMethod, number>;
  for (const saleReturn of session.returns) refunds[saleReturn.refundMethod] += saleReturn.refundCents;

  const withdrawals = session.movements
    .filter((m) => m.type === 'WITHDRAWAL')
    .reduce((sum, m) => sum + m.amountCents, 0);
  const deposits = session.movements.filter((m) => m.type === 'DEPOSIT').reduce((sum, m) => sum + m.amountCents, 0);
  const expectedCashCents = session.openingCents + byMethod.CASH - refunds.CASH + deposits - withdrawals;

  // O que ficou na gaveta no fechamento anterior deste estoque: deve ser o troco desta abertura.
  const previous = await prisma.cashSession.findFirst({
    where: { warehouseId: session.warehouseId, status: 'CLOSED', number: { lt: session.number } },
    orderBy: { number: 'desc' },
    select: { keptCents: true },
  });
  const previousKeptCents = previous?.keptCents ?? null;

  const { sales, returns, ...rest } = session;
  return {
    ...rest,
    summary: {
      salesCount: completed.length,
      cancelledCount: sales.length - completed.length,
      returnsCount: returns.length,
      revenueCents:
        completed.reduce((sum, sale) => sum + sale.totalCents, 0) - returns.reduce((sum, r) => sum + r.refundCents, 0),
      // Recebido por forma de pagamento, já descontadas as devoluções.
      byMethod: Object.fromEntries(METHODS.map((method) => [method, byMethod[method] - refunds[method]])),
      withdrawalsCents: withdrawals,
      depositsCents: deposits,
      expectedCashCents,
      differenceCents:
        session.countedCents === null ? null : session.countedCents - (session.expectedCents ?? expectedCashCents),
      // Retirado da gaveta no fechamento (o lucro do dia em dinheiro, que vai para o cofre ou o banco).
      closingWithdrawalCents:
        session.countedCents === null || session.keptCents === null ? null : session.countedCents - session.keptCents,
      previousKeptCents,
      // Troco da abertura diferente do que ficou na gaveta no fechamento anterior.
      openingDifferenceCents: previousKeptCents === null ? null : session.openingCents - previousKeptCents,
    },
  };
}

export async function getOpenSession(warehouseId: string) {
  const session = await prisma.cashSession.findFirst({ where: { warehouseId, status: 'OPEN' } });
  return session ? getCashSummary(session.id) : null;
}

export async function openCash(input: z.infer<typeof openSchema>, userId: string) {
  const session = await prisma.$transaction(async (tx) => {
    const warehouse = await tx.warehouse.findUnique({ where: { id: input.warehouseId } });
    if (!warehouse?.active) throw notFound('Estoque');
    if (await tx.cashSession.findFirst({ where: { warehouseId: warehouse.id, status: 'OPEN' } })) {
      throw conflict(`Já existe um caixa aberto em ${warehouse.name}`);
    }
    const last = await tx.cashSession.aggregate({ _max: { number: true } });
    return tx.cashSession.create({
      data: {
        number: (last._max.number ?? 0) + 1,
        warehouseId: warehouse.id,
        openedById: userId,
        openingCents: input.openingCents,
      },
    });
  });
  return getCashSummary(session.id);
}

/** Troco sugerido para abrir: o que ficou na gaveta no último fechamento ou, sem histórico, o troco fixo da loja. */
export async function getOpeningSuggestion(warehouseId: string) {
  const [settings, previous] = await Promise.all([
    getStoreSettings(),
    prisma.cashSession.findFirst({
      where: { warehouseId, status: 'CLOSED' },
      orderBy: { number: 'desc' },
      select: { keptCents: true, closedAt: true },
    }),
  ]);
  return {
    suggestedCents: previous?.keptCents ?? settings.cashFloatCents,
    previousKeptCents: previous?.keptCents ?? null,
    cashFloatCents: settings.cashFloatCents,
  };
}

async function getOpen(sessionId: string) {
  const session = await prisma.cashSession.findUnique({ where: { id: sessionId } });
  if (!session) throw notFound('Caixa');
  if (session.status !== 'OPEN') throw conflict('Este caixa já foi fechado');
  return session;
}

export async function addCashMovement(sessionId: string, input: z.infer<typeof movementSchema>, userId: string) {
  await getOpen(sessionId);
  await prisma.cashMovement.create({ data: { sessionId, ...input, userId } });
  return getCashSummary(sessionId);
}

/** Fecha o caixa guardando o esperado e o contado: a diferença fica registrada para sempre. */
export async function closeCash(sessionId: string, input: z.infer<typeof closeSchema>, userId: string) {
  await getOpen(sessionId);
  const { summary } = await getCashSummary(sessionId);
  const settings = await getStoreSettings();
  // Sem troco fixo configurado e sem valor informado, o fechamento não registra retirada.
  const keptCents =
    input.keptCents ?? (settings.cashFloatCents > 0 ? Math.min(settings.cashFloatCents, input.countedCents) : null);
  if (keptCents !== null && keptCents > input.countedCents) {
    throw unprocessable('O valor que fica na gaveta não pode ser maior que o dinheiro contado', 'KEPT_EXCEEDS_COUNTED');
  }
  await prisma.cashSession.update({
    where: { id: sessionId },
    data: {
      status: 'CLOSED',
      closedAt: new Date(),
      closedById: userId,
      expectedCents: summary.expectedCashCents,
      countedCents: input.countedCents,
      keptCents,
      notes: input.notes ?? null,
    },
  });
  return getCashSummary(sessionId);
}
