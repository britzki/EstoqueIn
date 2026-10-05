import { prisma } from '../../lib/prisma.js';
import { roundQty } from '../../lib/quantity.js';
import { quantitiesOnOrder } from '../purchasing/purchase-orders.routes.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Consumo por produto desde `since`: saídas e pacotes abertos para granel,
 * descontando o que voltou por cancelamento ou devolução de venda.
 */
async function consumptionSince(since: Date, warehouseId?: string) {
  const groups = await prisma.stockMovement.groupBy({
    by: ['productId'],
    where: {
      createdAt: { gte: since },
      warehouseId,
      type: { in: ['EXIT', 'FRACTION_OUT', 'SALE_CANCEL', 'SALE_RETURN'] },
    },
    _sum: { quantity: true },
  });
  return new Map(groups.map((group) => [group.productId, Math.max(0, -(group._sum.quantity ?? 0))]));
}

export interface PurchaseSuggestionFilters {
  /** Período usado para calcular o consumo médio. */
  days: number;
  /** Quantos dias de estoque a compra deve cobrir. */
  coverDays: number;
  warehouseId?: string;
}

/**
 * Sugestão de compra: com base no consumo médio diário, mostra o que acaba antes da próxima compra
 * e quanto comprar para cobrir `coverDays` dias (sem deixar abaixo do mínimo), descontando o que já foi pedido.
 * Produtos a granel ficam de fora: quem se compra é o pacote de origem, que já soma o consumo do granel.
 */
export async function getPurchaseSuggestion({ days, coverDays, warehouseId }: PurchaseSuggestionFilters) {
  const since = new Date(Date.now() - days * DAY_MS);
  const [products, consumption, onOrderMap] = await Promise.all([
    prisma.product.findMany({
      where: { active: true, sourceProductId: null },
      include: {
        stockLevels: { where: { warehouseId } },
        supplier: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    }),
    consumptionSince(since, warehouseId),
    quantitiesOnOrder(),
  ]);

  const rows = products.flatMap((product) => {
    // O que já foi pedido e ainda não chegou conta como estoque a caminho.
    const onOrder = onOrderMap.get(product.id) ?? 0;
    const consumed = consumption.get(product.id) ?? 0;
    const quantity = roundQty(product.stockLevels.reduce((sum, level) => sum + level.quantity, 0));
    const minStock = warehouseId ? (product.stockLevels[0]?.minQuantity ?? product.minStock) : product.minStock;
    const dailyAverage = consumed / days;
    const target = Math.max(dailyAverage * coverDays, 0) + minStock;
    if (quantity + onOrder >= target || (consumed === 0 && quantity + onOrder > minStock)) return [];

    const rawSuggestion = target - quantity - onOrder;
    const suggested = product.fractional ? roundQty(rawSuggestion) : Math.ceil(rawSuggestion - 1e-9);
    if (suggested <= 0) return [];
    return [
      {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        unit: product.unit,
        fractional: product.fractional,
        supplier: product.supplier,
        quantity,
        minStock,
        onOrder,
        consumed: roundQty(consumed),
        dailyAverage: roundQty(dailyAverage),
        /** Dias até zerar no ritmo atual (null quando não houve consumo). */
        daysLeft: dailyAverage > 0 ? Math.max(0, Math.floor(quantity / dailyAverage)) : null,
        suggested,
        costCents: product.costCents,
        estimatedCents: Math.round(suggested * product.costCents),
      },
    ];
  });

  rows.sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity) || a.name.localeCompare(b.name));

  const bySupplier = new Map<
    string,
    { supplier: { id: string; name: string } | null; items: number; estimatedCents: number }
  >();
  for (const row of rows) {
    const key = row.supplier?.id ?? '';
    const group = bySupplier.get(key) ?? { supplier: row.supplier, items: 0, estimatedCents: 0 };
    group.items += 1;
    group.estimatedCents += row.estimatedCents;
    bySupplier.set(key, group);
  }

  return {
    days,
    coverDays,
    rows,
    suppliers: [...bySupplier.values()].sort((a, b) => b.estimatedCents - a.estimatedCents),
    summary: { products: rows.length, estimatedCents: rows.reduce((sum, row) => sum + row.estimatedCents, 0) },
  };
}

/**
 * Produtos parados: têm saldo mas não saíram nos últimos `days` dias.
 * Mostra o dinheiro empatado e a data da última saída, para decidir promoção ou não recomprar.
 */
export async function getStaleProducts({ days, warehouseId }: { days: number; warehouseId?: string }) {
  const since = new Date(Date.now() - days * DAY_MS);
  const [products, consumption, lastExits] = await Promise.all([
    prisma.product.findMany({
      where: { active: true },
      include: { stockLevels: { where: { warehouseId } } },
      orderBy: { name: 'asc' },
    }),
    consumptionSince(since, warehouseId),
    prisma.stockMovement.groupBy({
      by: ['productId'],
      where: { warehouseId, type: { in: ['EXIT', 'FRACTION_OUT'] } },
      _max: { createdAt: true },
    }),
  ]);
  const lastExit = new Map(lastExits.map((group) => [group.productId, group._max.createdAt]));

  const rows = products.flatMap((product) => {
    const quantity = roundQty(product.stockLevels.reduce((sum, level) => sum + level.quantity, 0));
    if (quantity <= 0 || (consumption.get(product.id) ?? 0) > 0) return [];
    const last = lastExit.get(product.id) ?? null;
    return [
      {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        category: product.category,
        unit: product.unit,
        quantity,
        costCents: product.costCents,
        valueCents: Math.round(quantity * product.costCents),
        lastExitAt: last,
        /** Dias desde a última saída (null = nunca saiu). */
        daysSinceExit: last ? Math.floor((Date.now() - last.getTime()) / DAY_MS) : null,
      },
    ];
  });
  rows.sort((a, b) => b.valueCents - a.valueCents);

  return {
    days,
    rows,
    summary: { products: rows.length, valueCents: rows.reduce((sum, row) => sum + row.valueCents, 0) },
  };
}
