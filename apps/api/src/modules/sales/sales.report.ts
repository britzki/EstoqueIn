import { prisma } from '../../lib/prisma.js';
import { dayKey } from '../../lib/dates.js';
import { roundQty } from '../../lib/quantity.js';

interface Filters {
  from: Date;
  to: Date;
  warehouseId?: string;
}

/**
 * Vendas do período: faturamento, lucro (pelo custo médio na hora da venda), formas de pagamento e produtos.
 * Devoluções feitas no período são descontadas (no dia, na forma de pagamento e no produto em que aconteceram),
 * do mesmo jeito que no fechamento do caixa e no fechamento do mês.
 */
export async function getSalesReport({ from, to, warehouseId }: Filters) {
  const where = { createdAt: { gte: from, lte: to }, warehouseId };
  const [sales, cancelled, returns] = await Promise.all([
    prisma.sale.findMany({
      where: { ...where, status: 'COMPLETED' },
      include: { items: true, payments: true, user: { select: { name: true } } },
      orderBy: { number: 'asc' },
    }),
    prisma.sale.count({ where: { ...where, status: 'CANCELLED' } }),
    prisma.saleReturn.findMany({
      where: { createdAt: { gte: from, lte: to }, ...(warehouseId && { sale: { warehouseId } }) },
      include: {
        items: {
          include: { saleItem: { select: { productId: true, description: true, unit: true, unitCostCents: true } } },
        },
      },
    }),
  ]);

  const byPayment: Record<string, number> = {};
  const byDay = new Map<string, { date: string; sales: number; revenueCents: number; profitCents: number }>();
  const byProduct = new Map<
    string,
    { productId: string; name: string; unit: string; quantity: number; revenueCents: number; costCents: number }
  >();

  for (const sale of sales) {
    // O troco sai do dinheiro: o que conta como recebido em dinheiro é o valor líquido.
    let change = sale.changeCents;
    for (const payment of sale.payments) {
      let amount = payment.amountCents;
      if (payment.method === 'CASH' && change > 0) {
        const deducted = Math.min(change, amount);
        amount -= deducted;
        change -= deducted;
      }
      byPayment[payment.method] = (byPayment[payment.method] ?? 0) + amount;
    }

    const key = dayKey(sale.createdAt);
    const day = byDay.get(key) ?? { date: key, sales: 0, revenueCents: 0, profitCents: 0 };
    day.sales += 1;
    day.revenueCents += sale.totalCents;
    day.profitCents += sale.totalCents - sale.costCents;
    byDay.set(key, day);

    for (const item of sale.items) {
      const row = byProduct.get(item.productId) ?? {
        productId: item.productId,
        name: item.description,
        unit: item.unit,
        quantity: 0,
        revenueCents: 0,
        costCents: 0,
      };
      row.quantity = roundQty(row.quantity + item.quantity);
      row.revenueCents += item.totalCents;
      row.costCents += Math.round(item.quantity * item.unitCostCents);
      byProduct.set(item.productId, row);
    }
  }

  for (const saleReturn of returns) {
    byPayment[saleReturn.refundMethod] = (byPayment[saleReturn.refundMethod] ?? 0) - saleReturn.refundCents;
    const key = dayKey(saleReturn.createdAt);
    const day = byDay.get(key) ?? { date: key, sales: 0, revenueCents: 0, profitCents: 0 };
    day.revenueCents -= saleReturn.refundCents;
    day.profitCents -= saleReturn.refundCents - saleReturn.costCents;
    byDay.set(key, day);
    for (const item of saleReturn.items) {
      const { productId, description, unit, unitCostCents } = item.saleItem;
      const row = byProduct.get(productId) ?? {
        productId,
        name: description,
        unit,
        quantity: 0,
        revenueCents: 0,
        costCents: 0,
      };
      row.quantity = roundQty(row.quantity - item.quantity);
      row.revenueCents -= item.refundCents;
      row.costCents -= Math.round(item.quantity * unitCostCents);
      byProduct.set(productId, row);
    }
  }

  const refundsCents = returns.reduce((sum, r) => sum + r.refundCents, 0);
  const revenueCents = sales.reduce((sum, sale) => sum + sale.totalCents, 0) - refundsCents;
  const costCents =
    sales.reduce((sum, sale) => sum + sale.costCents, 0) - returns.reduce((sum, r) => sum + r.costCents, 0);

  return {
    totals: {
      sales: sales.length,
      cancelled,
      returns: returns.length,
      refundsCents,
      revenueCents,
      discountCents: sales.reduce((sum, sale) => sum + sale.discountCents, 0),
      costCents,
      profitCents: revenueCents - costCents,
      averageTicketCents: sales.length ? Math.round(revenueCents / sales.length) : 0,
    },
    byPayment,
    byDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    products: [...byProduct.values()]
      .map((row) => ({ ...row, profitCents: row.revenueCents - row.costCents }))
      .sort((a, b) => b.revenueCents - a.revenueCents),
    sales: sales.map((sale) => ({
      number: sale.number,
      createdAt: sale.createdAt,
      totalCents: sale.totalCents,
      discountCents: sale.discountCents,
      profitCents: sale.totalCents - sale.costCents,
      payments: sale.payments.map((payment) => payment.method).join(' + '),
      user: sale.user.name,
      items: sale.items.length,
    })),
  };
}

/** Resumo de hoje para o dashboard. */
export async function getTodaySales() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const result = await prisma.sale.aggregate({
    where: { status: 'COMPLETED', createdAt: { gte: start } },
    _sum: { totalCents: true },
    _count: { _all: true },
  });
  return { count: result._count._all, totalCents: result._sum.totalCents ?? 0 };
}
