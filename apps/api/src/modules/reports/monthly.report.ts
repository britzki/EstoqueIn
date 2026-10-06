import { prisma } from '../../lib/prisma.js';
import { getSalesReport } from '../sales/sales.report.js';
import { listDebtors } from '../customers/account.js';
import { getStaleProducts } from './purchasing.report.js';
import { getStockPosition } from './reports.service.js';

/**
 * Fechamento do mês (ou de qualquer período): o resumo de uma página para o dono ou o contador.
 * Vendas e lucro já descontam devoluções; "resultado" é o lucro bruto menos as contas pagas no período.
 * Os números de "hoje" (fiado a receber, estoque, contas em aberto) são da data em que o relatório é gerado.
 */
export async function getMonthlyReport({ from, to }: { from: Date; to: Date }) {
  const period = { gte: from, lte: to };
  const [
    sales,
    returns,
    accountSold,
    accountReceived,
    debtors,
    billsPaid,
    billsOpen,
    cashSessions,
    stock,
    stale,
    orders,
  ] = await Promise.all([
    getSalesReport({ from, to }),
    prisma.saleReturn.findMany({ where: { createdAt: period }, select: { refundCents: true, costCents: true } }),
    prisma.salePayment.aggregate({
      where: { method: 'ACCOUNT', sale: { status: 'COMPLETED', createdAt: period } },
      _sum: { amountCents: true },
    }),
    prisma.customerPayment.aggregate({
      where: { createdAt: period, cancelledAt: null },
      _sum: { amountCents: true },
    }),
    listDebtors(),
    prisma.bill.findMany({
      where: { status: 'PAID', paidAt: period },
      select: { description: true, paidAmountCents: true, supplier: { select: { name: true } } },
      orderBy: { paidAmountCents: 'desc' },
    }),
    prisma.bill.aggregate({ where: { status: 'OPEN' }, _sum: { amountCents: true }, _count: { _all: true } }),
    prisma.cashSession.findMany({
      where: { status: 'CLOSED', closedAt: period },
      select: { expectedCents: true, countedCents: true },
    }),
    getStockPosition({}),
    getStaleProducts({ days: 60 }),
    prisma.purchaseOrder.findMany({
      where: { createdAt: period, status: { not: 'CANCELLED' } },
      select: { items: { select: { quantity: true, unitCostCents: true } } },
    }),
  ]);

  const refundsCents = returns.reduce((sum, r) => sum + r.refundCents, 0);
  const returnedCostCents = returns.reduce((sum, r) => sum + r.costCents, 0);
  const revenueCents = sales.totals.revenueCents - refundsCents;
  const grossProfitCents = sales.totals.profitCents - (refundsCents - returnedCostCents);
  const expensesCents = billsPaid.reduce((sum, bill) => sum + (bill.paidAmountCents ?? 0), 0);
  const cashDifferences = cashSessions
    .filter((session) => session.countedCents !== null && session.expectedCents !== null)
    .map((session) => session.countedCents! - session.expectedCents!);

  return {
    period: { from, to },
    sales: {
      count: sales.totals.sales,
      cancelled: sales.totals.cancelled,
      returns: returns.length,
      revenueCents,
      refundsCents,
      discountCents: sales.totals.discountCents,
      grossProfitCents,
      averageTicketCents: sales.totals.sales ? Math.round(revenueCents / sales.totals.sales) : 0,
      byPayment: sales.byPayment,
      topProducts: sales.products.slice(0, 10),
    },
    expenses: {
      paidCents: expensesCents,
      bills: billsPaid.map((bill) => ({
        description: bill.description,
        supplier: bill.supplier?.name ?? null,
        amountCents: bill.paidAmountCents ?? 0,
      })),
      openCount: billsOpen._count._all,
      openCents: billsOpen._sum.amountCents ?? 0,
    },
    /** Lucro bruto das vendas menos as contas pagas no período. */
    resultCents: grossProfitCents - expensesCents,
    account: {
      soldCents: accountSold._sum.amountCents ?? 0,
      receivedCents: accountReceived._sum.amountCents ?? 0,
      outstandingCents: debtors.totalCents,
      debtors: debtors.debtors.length,
    },
    cash: {
      sessions: cashSessions.length,
      differenceCents: cashDifferences.reduce((sum, value) => sum + value, 0),
      withDifference: cashDifferences.filter((value) => value !== 0).length,
    },
    stock: {
      valueCents: stock.summary.totalValueCents,
      products: stock.summary.products,
      outOfStock: stock.summary.outOfStock,
      staleProducts: stale.summary.products,
      staleValueCents: stale.summary.valueCents,
    },
    purchases: {
      orders: orders.length,
      estimatedCents: orders.reduce(
        (sum, order) => sum + order.items.reduce((s, item) => s + Math.round(item.quantity * item.unitCostCents), 0),
        0,
      ),
    },
  };
}
