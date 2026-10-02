import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { roundQty } from '../../lib/quantity.js';
import { getTodaySales } from '../sales/sales.report.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Data no fuso da empresa no formato AAAA-MM-DD (agrupamento por dia nos gráficos). */
const dayKey = (date: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: env.APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

export async function getDashboard() {
  const since = new Date(Date.now() - 29 * DAY_MS);
  since.setHours(0, 0, 0, 0);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [products, warehouses, levels, openAlerts, movementsToday, periodMovements, recentMovements, topExitGroups] =
    await Promise.all([
      prisma.product.count({ where: { active: true } }),
      prisma.warehouse.count({ where: { active: true } }),
      prisma.stockLevel.findMany({
        where: { quantity: { gt: 0 } },
        select: { quantity: true, product: { select: { costCents: true } } },
      }),
      prisma.stockAlert.count({ where: { status: 'OPEN' } }),
      prisma.stockMovement.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.stockMovement.findMany({
        where: { createdAt: { gte: since }, type: { in: ['ENTRY', 'EXIT'] } },
        select: { type: true, quantity: true, createdAt: true },
      }),
      prisma.stockMovement.findMany({
        include: {
          product: { select: { id: true, name: true, unit: true } },
          warehouse: { select: { id: true, name: true } },
          user: { select: { id: true, name: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 8,
      }),
      prisma.stockMovement.groupBy({
        by: ['productId'],
        where: { type: 'EXIT', createdAt: { gte: since } },
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: 'asc' } }, // saídas são negativas
        take: 5,
      }),
    ]);

  const salesToday = await getTodaySales();

  const byDay = new Map<string, { date: string; entries: number; exits: number }>();
  for (let i = 0; i < 30; i++) {
    const key = dayKey(new Date(since.getTime() + i * DAY_MS + DAY_MS / 2));
    byDay.set(key, { date: key, entries: 0, exits: 0 });
  }
  for (const movement of periodMovements) {
    const bucket = byDay.get(dayKey(movement.createdAt));
    if (!bucket) continue;
    if (movement.type === 'ENTRY') bucket.entries += movement.quantity;
    else bucket.exits += Math.abs(movement.quantity);
  }

  const topProducts = await prisma.product.findMany({
    where: { id: { in: topExitGroups.map((group) => group.productId) } },
    select: { id: true, name: true, unit: true },
  });

  return {
    totals: {
      products,
      warehouses,
      stockUnits: roundQty(levels.reduce((sum, level) => sum + level.quantity, 0)),
      stockValueCents: Math.round(levels.reduce((sum, level) => sum + level.quantity * level.product.costCents, 0)),
      openAlerts,
      movementsToday,
      salesToday,
    },
    movementsByDay: [...byDay.values()].map((day) => ({
      ...day,
      entries: roundQty(day.entries),
      exits: roundQty(day.exits),
    })),
    recentMovements,
    topExits: topExitGroups.map((group) => ({
      product: topProducts.find((product) => product.id === group.productId),
      quantity: roundQty(Math.abs(group._sum.quantity ?? 0)),
    })),
  };
}

export type StockStatus = 'OK' | 'LOW' | 'OUT';

export async function getStockPosition({ warehouseId, category }: { warehouseId?: string; category?: string }) {
  const products = await prisma.product.findMany({
    where: { active: true, category },
    include: {
      stockLevels: { where: { warehouseId } },
      _count: { select: { alerts: { where: { status: 'OPEN', warehouseId } } } },
    },
    orderBy: { name: 'asc' },
  });

  const rows = products.map((product) => {
    const quantity = roundQty(product.stockLevels.reduce((sum, level) => sum + level.quantity, 0));
    // Com estoque filtrado, usa o mínimo daquele estoque; no consolidado, o padrão do produto.
    const minStock = warehouseId ? (product.stockLevels[0]?.minQuantity ?? product.minStock) : product.minStock;
    const status: StockStatus = quantity <= 0 ? 'OUT' : product._count.alerts > 0 ? 'LOW' : 'OK';
    return {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      category: product.category,
      unit: product.unit,
      quantity,
      minStock,
      costCents: product.costCents,
      priceCents: product.priceCents,
      valueCents: Math.round(quantity * product.costCents),
      status,
    };
  });

  return {
    rows,
    summary: {
      products: rows.length,
      totalUnits: roundQty(rows.reduce((sum, row) => sum + row.quantity, 0)),
      totalValueCents: rows.reduce((sum, row) => sum + row.valueCents, 0),
      outOfStock: rows.filter((row) => row.status === 'OUT').length,
      low: rows.filter((row) => row.status === 'LOW').length,
    },
  };
}

interface PeriodFilters {
  from: Date;
  to: Date;
  warehouseId?: string;
}

export async function getMovementSummary({ from, to, warehouseId }: PeriodFilters) {
  const movements = await prisma.stockMovement.findMany({
    where: { createdAt: { gte: from, lte: to }, warehouseId },
    select: {
      type: true,
      quantity: true,
      unitCostCents: true,
      product: { select: { id: true, sku: true, name: true, unit: true } },
    },
  });

  const byProduct = new Map<
    string,
    {
      productId: string;
      sku: string;
      name: string;
      unit: string;
      entries: number;
      exits: number;
      transfersIn: number;
      transfersOut: number;
      adjustments: number;
      entryValueCents: number;
      exitValueCents: number;
    }
  >();
  const byType = {
    ENTRY: 0,
    EXIT: 0,
    TRANSFER_IN: 0,
    TRANSFER_OUT: 0,
    ADJUSTMENT: 0,
    FRACTION_OUT: 0,
    FRACTION_IN: 0,
    SALE_CANCEL: 0,
    SALE_RETURN: 0,
  };

  for (const movement of movements) {
    const { product } = movement;
    const row =
      byProduct.get(product.id) ??
      byProduct
        .set(product.id, {
          productId: product.id,
          sku: product.sku,
          name: product.name,
          unit: product.unit,
          entries: 0,
          exits: 0,
          transfersIn: 0,
          transfersOut: 0,
          adjustments: 0,
          entryValueCents: 0,
          exitValueCents: 0,
        })
        .get(product.id)!;

    const qty = Math.abs(movement.quantity);
    const value = Math.round(qty * (movement.unitCostCents ?? 0));
    byType[movement.type] += qty;

    switch (movement.type) {
      case 'ENTRY':
        row.entries += qty;
        row.entryValueCents += value;
        break;
      case 'EXIT':
        row.exits += qty;
        row.exitValueCents += value;
        break;
      case 'TRANSFER_IN':
        row.transfersIn += qty;
        break;
      case 'TRANSFER_OUT':
        row.transfersOut += qty;
        break;
      case 'ADJUSTMENT':
        row.adjustments += movement.quantity;
        break;
    }
  }

  // As somas são feitas em ponto flutuante; arredonda o resultado para 3 casas.
  for (const row of byProduct.values()) {
    for (const field of ['entries', 'exits', 'transfersIn', 'transfersOut', 'adjustments'] as const)
      row[field] = roundQty(row[field]);
  }
  for (const type of Object.keys(byType) as Array<keyof typeof byType>) byType[type] = roundQty(byType[type]);

  const rows = [...byProduct.values()].sort((a, b) => b.exits - a.exits || a.name.localeCompare(b.name));
  return {
    rows,
    totals: {
      ...byType,
      movements: movements.length,
      entryValueCents: rows.reduce((sum, row) => sum + row.entryValueCents, 0),
      exitValueCents: rows.reduce((sum, row) => sum + row.exitValueCents, 0),
    },
  };
}

/**
 * Curva ABC pelo valor de saída (consumo) no período:
 * A = itens que somam até 80% do valor, B = até 95%, C = o restante.
 */
export async function getAbcCurve(filters: PeriodFilters) {
  const { rows } = await getMovementSummary(filters);
  const ranked = rows.filter((row) => row.exitValueCents > 0).sort((a, b) => b.exitValueCents - a.exitValueCents);
  const total = ranked.reduce((sum, row) => sum + row.exitValueCents, 0);

  let accumulated = 0;
  const items = ranked.map((row) => {
    const previousShare = total ? accumulated / total : 0;
    accumulated += row.exitValueCents;
    const share = total ? row.exitValueCents / total : 0;
    const cumulativeShare = total ? accumulated / total : 0;
    // A classe é definida por onde o item começa na curva, para o primeiro item nunca cair em B/C.
    const curveClass = previousShare < 0.8 ? 'A' : previousShare < 0.95 ? 'B' : 'C';
    return {
      productId: row.productId,
      sku: row.sku,
      name: row.name,
      exits: row.exits,
      exitValueCents: row.exitValueCents,
      share,
      cumulativeShare,
      class: curveClass,
    };
  });

  const summarize = (curveClass: string) => {
    const group = items.filter((item) => item.class === curveClass);
    return {
      items: group.length,
      valueCents: group.reduce((sum, item) => sum + item.exitValueCents, 0),
    };
  };

  return { items, totalValueCents: total, classes: { A: summarize('A'), B: summarize('B'), C: summarize('C') } };
}
