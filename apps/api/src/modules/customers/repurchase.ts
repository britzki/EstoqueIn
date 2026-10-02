import { prisma } from '../../lib/prisma.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Intervalos menores que isso não são "recompra" (ex.: duas compras no mesmo fim de semana). */
const MIN_INTERVAL_DAYS = 5;
/** Depois de tanto tempo sem comprar, o cliente provavelmente mudou de hábito. */
const MAX_OVERDUE_DAYS = 60;

export interface RepurchaseReminder {
  customer: { id: string; name: string; phone: string | null };
  product: { id: string; name: string; unit: string };
  purchases: number;
  averageIntervalDays: number;
  lastPurchaseAt: Date;
  expectedAt: Date;
  /** Negativo = atrasado (já devia ter voltado). */
  daysUntil: number;
}

/**
 * Lembrete de recompra: para cada cliente e produto comprado pelo menos duas vezes, calcula
 * o intervalo médio entre as compras e prevê a próxima. Útil para ração e remédios de uso contínuo:
 * o dono avisa o cliente antes que o produto acabe.
 *
 * @param horizonDays mostra o que vence até essa quantidade de dias (inclui os atrasados).
 */
export async function getRepurchaseReminders(horizonDays: number): Promise<RepurchaseReminder[]> {
  const sales = await prisma.sale.findMany({
    where: { status: 'COMPLETED', customerId: { not: null } },
    select: {
      createdAt: true,
      customer: { select: { id: true, name: true, phone: true, active: true } },
      items: { select: { product: { select: { id: true, name: true, unit: true, active: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  });

  // Datas de compra por cliente + produto (uma por dia, mesmo que tenha levado duas vezes).
  const groups = new Map<
    string,
    { customer: RepurchaseReminder['customer']; product: RepurchaseReminder['product']; days: number[] }
  >();
  for (const sale of sales) {
    if (!sale.customer?.active) continue;
    const day = Math.floor(sale.createdAt.getTime() / DAY_MS);
    for (const { product } of sale.items) {
      if (!product.active) continue;
      const key = `${sale.customer.id}:${product.id}`;
      const group = groups.get(key) ?? {
        customer: { id: sale.customer.id, name: sale.customer.name, phone: sale.customer.phone },
        product: { id: product.id, name: product.name, unit: product.unit },
        days: [],
      };
      if (group.days.at(-1) !== day) group.days.push(day);
      groups.set(key, group);
    }
  }

  const today = Math.floor(Date.now() / DAY_MS);
  const reminders: RepurchaseReminder[] = [];
  for (const { customer, product, days } of groups.values()) {
    if (days.length < 2) continue;
    const average = (days.at(-1)! - days[0]) / (days.length - 1);
    if (average < MIN_INTERVAL_DAYS) continue;

    const expectedDay = Math.round(days.at(-1)! + average);
    const daysUntil = expectedDay - today;
    if (daysUntil > horizonDays || daysUntil < -MAX_OVERDUE_DAYS) continue;

    reminders.push({
      customer,
      product,
      purchases: days.length,
      averageIntervalDays: Math.round(average),
      lastPurchaseAt: new Date(days.at(-1)! * DAY_MS),
      expectedAt: new Date(expectedDay * DAY_MS),
      daysUntil,
    });
  }
  return reminders.sort((a, b) => a.daysUntil - b.daysUntil);
}
