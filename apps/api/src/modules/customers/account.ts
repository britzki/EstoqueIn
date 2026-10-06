import { z } from 'zod';
import { prisma, type Tx } from '../../lib/prisma.js';
import { notFound, unprocessable } from '../../lib/errors.js';
import { id, optionalText, positiveInt } from '../../lib/validation.js';
import { formatCents } from '../../lib/money.js';
import { getStoreSettings } from '../settings/settings.routes.js';

/**
 * Fiado (conta do cliente). O saldo nunca é gravado: é sempre recalculado a partir de
 *   fiado anterior ao sistema (passado do caderno)
 *   + vendas pagas no fiado (que não foram canceladas)
 *   − devoluções abatidas do fiado
 *   − pagamentos recebidos.
 * Assim, cancelar uma venda ou devolver um item já corrige a dívida sozinho.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AccountEntry {
  date: Date;
  kind: 'OPENING' | 'SALE' | 'RETURN' | 'PAYMENT' | 'PAYMENT_CANCEL';
  description: string;
  /** Positivo aumenta a dívida; negativo abate. */
  amountCents: number;
  balanceCents: number;
  saleId?: string;
  paymentId?: string;
  /** Pagamento estornado e o próprio estorno: um anula o outro. */
  voided?: boolean;
}

async function loadEntries(client: Tx, customerIds?: string[]) {
  const customerFilter = customerIds ? { in: customerIds } : { not: null };
  const [opening, salePayments, returns, payments] = await Promise.all([
    client.customer.findMany({
      where: { openingBalanceCents: { not: 0 }, ...(customerIds && { id: { in: customerIds } }) },
      select: { id: true, openingBalanceCents: true, createdAt: true },
    }),
    client.salePayment.findMany({
      where: { method: 'ACCOUNT', sale: { status: 'COMPLETED', customerId: customerFilter } },
      select: {
        amountCents: true,
        sale: { select: { id: true, number: true, createdAt: true, customerId: true } },
      },
    }),
    client.saleReturn.findMany({
      where: { refundMethod: 'ACCOUNT', sale: { customerId: customerFilter } },
      select: { refundCents: true, createdAt: true, sale: { select: { id: true, number: true, customerId: true } } },
    }),
    client.customerPayment.findMany({
      where: customerIds ? { customerId: { in: customerIds } } : {},
      select: {
        id: true,
        customerId: true,
        amountCents: true,
        method: true,
        createdAt: true,
        notes: true,
        cancelledAt: true,
        cancelReason: true,
      },
    }),
  ]);

  const entries = new Map<string, Omit<AccountEntry, 'balanceCents'>[]>();
  const push = (customerId: string | null, entry: Omit<AccountEntry, 'balanceCents'>) => {
    if (!customerId) return;
    entries.set(customerId, [...(entries.get(customerId) ?? []), entry]);
  };
  for (const customer of opening) {
    push(customer.id, {
      date: customer.createdAt,
      kind: 'OPENING',
      description: 'Fiado anterior (caderno)',
      amountCents: customer.openingBalanceCents,
    });
  }
  for (const payment of salePayments) {
    push(payment.sale.customerId, {
      date: payment.sale.createdAt,
      kind: 'SALE',
      description: `Venda nº ${payment.sale.number}`,
      amountCents: payment.amountCents,
      saleId: payment.sale.id,
    });
  }
  for (const saleReturn of returns) {
    push(saleReturn.sale.customerId, {
      date: saleReturn.createdAt,
      kind: 'RETURN',
      description: `Devolução da venda nº ${saleReturn.sale.number}`,
      amountCents: -saleReturn.refundCents,
      saleId: saleReturn.sale.id,
    });
  }
  for (const payment of payments) {
    push(payment.customerId, {
      date: payment.createdAt,
      kind: 'PAYMENT',
      description: payment.notes ? `Pagamento (${payment.notes})` : 'Pagamento',
      amountCents: -payment.amountCents,
      paymentId: payment.id,
      voided: Boolean(payment.cancelledAt),
    });
    // O estorno entra como lançamento próprio: o histórico mostra o pagamento e a correção.
    if (payment.cancelledAt) {
      push(payment.customerId, {
        date: payment.cancelledAt,
        kind: 'PAYMENT_CANCEL',
        description: `Estorno do pagamento: ${payment.cancelReason ?? ''}`.trim(),
        amountCents: payment.amountCents,
        paymentId: payment.id,
        voided: true,
      });
    }
  }
  return entries;
}

/** Extrato em ordem cronológica, com o saldo após cada lançamento e a data da dívida mais antiga em aberto. */
function buildStatement(raw: Omit<AccountEntry, 'balanceCents'>[]) {
  const sorted = [...raw].sort((a, b) => a.date.getTime() - b.date.getTime());
  let balance = 0;
  const entries: AccountEntry[] = sorted.map((entry) => {
    balance += entry.amountCents;
    return { ...entry, balanceCents: balance };
  });

  // Débito mais antigo ainda não coberto pelos abatimentos (primeiro a entrar, primeiro a ser pago).
  // Pagamento estornado e seu estorno se anulam e ficam de fora dessa conta.
  const valid = sorted.filter((e) => !e.voided);
  let credits = -valid.filter((e) => e.amountCents < 0).reduce((sum, e) => sum + e.amountCents, 0);
  let openSince: Date | null = null;
  for (const entry of valid.filter((e) => e.amountCents > 0)) {
    if (credits >= entry.amountCents) {
      credits -= entry.amountCents;
      continue;
    }
    openSince = entry.date;
    break;
  }
  return { balanceCents: balance, openSince: balance > 0 ? openSince : null, entries };
}

export async function getCustomerBalance(customerId: string, client: Tx = prisma) {
  const entries = await loadEntries(client, [customerId]);
  return buildStatement(entries.get(customerId) ?? []).balanceCents;
}

/** Saldo de fiado de vários clientes de uma vez (para listas). */
export async function getBalances(customerIds: string[]) {
  const entries = await loadEntries(prisma, customerIds);
  return new Map(customerIds.map((id) => [id, buildStatement(entries.get(id) ?? []).balanceCents]));
}

export async function getAccountStatement(customerId: string) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw notFound('Cliente');
  const entries = await loadEntries(prisma, [customerId]);
  const statement = buildStatement(entries.get(customerId) ?? []);
  return {
    ...statement,
    creditLimitCents: customer.creditLimitCents,
    entries: statement.entries.reverse(), // mais recentes primeiro
  };
}

/** Quem está devendo: maior dívida primeiro, com a data da dívida mais antiga. */
export async function listDebtors() {
  const entries = await loadEntries(prisma);
  const customers = await prisma.customer.findMany({
    where: { id: { in: [...entries.keys()] } },
    select: { id: true, name: true, phone: true, creditLimitCents: true },
  });
  const now = Date.now();
  const debtors = customers
    .map((customer) => {
      const { balanceCents, openSince, entries: list } = buildStatement(entries.get(customer.id) ?? []);
      const lastPayment = list.filter((e) => e.kind === 'PAYMENT' && !e.voided).at(-1)?.date ?? null;
      return {
        customer,
        balanceCents,
        openSince,
        daysOpen: openSince ? Math.floor((now - openSince.getTime()) / DAY_MS) : null,
        lastPaymentAt: lastPayment,
      };
    })
    .filter((debtor) => debtor.balanceCents > 0)
    .sort((a, b) => b.balanceCents - a.balanceCents);
  return {
    debtors,
    totalCents: debtors.reduce((sum, debtor) => sum + debtor.balanceCents, 0),
  };
}

/**
 * Confere uma venda no fiado: precisa de cliente cadastrado e respeita o limite dele.
 * Chamado dentro da transação da venda.
 */
export async function assertAccountSale(
  tx: Tx,
  customer: { id: string; name: string; creditLimitCents: number | null } | null,
  accountCents: number,
  totalCents: number,
) {
  if (!customer) {
    throw unprocessable('Para vender fiado, escolha o cliente da venda', 'ACCOUNT_NEEDS_CUSTOMER');
  }
  if (accountCents > totalCents) throw unprocessable('O valor no fiado não pode passar do total da venda');
  if (customer.creditLimitCents === null) return;
  const balance = await getCustomerBalance(customer.id, tx);
  if (balance + accountCents > customer.creditLimitCents) {
    throw unprocessable(
      `${customer.name} passaria do limite de fiado (limite ${formatCents(customer.creditLimitCents)}, ` +
        `em aberto ${formatCents(balance)})`,
      'CREDIT_LIMIT',
      { balanceCents: balance, creditLimitCents: customer.creditLimitCents },
    );
  }
}

export const accountPaymentSchema = z.object({
  amountCents: positiveInt,
  method: z.enum(['CASH', 'PIX', 'DEBIT', 'CREDIT', 'OTHER']),
  /** Caixa onde o dinheiro entra (o estoque de onde a loja vende). */
  warehouseId: id.optional(),
  notes: optionalText(160),
});

/** Recebe um pagamento de fiado (total ou parcial). Em dinheiro, entra no caixa aberto. */
export async function receiveAccountPayment(
  customerId: string,
  input: z.infer<typeof accountPaymentSchema>,
  userId: string,
) {
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw notFound('Cliente');
    const balance = await getCustomerBalance(customer.id, tx);
    if (balance <= 0) throw unprocessable(`${customer.name} não tem fiado em aberto`, 'NO_DEBT');
    if (input.amountCents > balance) {
      throw unprocessable(
        `O pagamento é maior que o fiado em aberto (${formatCents(balance)})`,
        'PAYMENT_EXCEEDS_DEBT',
        { balanceCents: balance },
      );
    }

    const settings = await getStoreSettings(tx);
    const cashSession = input.warehouseId
      ? await tx.cashSession.findFirst({ where: { warehouseId: input.warehouseId, status: 'OPEN' } })
      : await tx.cashSession.findFirst({ where: { status: 'OPEN' }, orderBy: { openedAt: 'desc' } });
    if (input.method === 'CASH' && settings.requireCashSession && !cashSession) {
      throw unprocessable('O caixa está fechado. Abra o caixa para receber em dinheiro.', 'CASH_CLOSED');
    }

    const payment = await tx.customerPayment.create({
      data: {
        customerId: customer.id,
        amountCents: input.amountCents,
        method: input.method,
        notes: input.notes ?? null,
        cashSessionId: cashSession?.id ?? null,
        userId,
      },
    });
    return { payment, customer, balanceCents: balance - input.amountCents };
  });
}

/** Estorna um pagamento de fiado lançado por engano. A dívida volta e o estorno fica no extrato. */
export async function cancelAccountPayment(customerId: string, paymentId: string, reason: string, userId: string) {
  const payment = await prisma.customerPayment.findUnique({ where: { id: paymentId }, include: { customer: true } });
  if (!payment || payment.customerId !== customerId) throw notFound('Pagamento');
  if (payment.cancelledAt) throw unprocessable('Este pagamento já foi estornado', 'ALREADY_CANCELLED');
  const updated = await prisma.customerPayment.update({
    where: { id: payment.id },
    data: { cancelledAt: new Date(), cancelledById: userId, cancelReason: reason },
  });
  return { payment: updated, customer: payment.customer, balanceCents: await getCustomerBalance(customerId) };
}
