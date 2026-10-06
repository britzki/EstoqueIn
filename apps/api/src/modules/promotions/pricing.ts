import type { Promotion } from '@prisma/client';
import { prisma, type Tx } from '../../lib/prisma.js';

/**
 * Preço de uma linha da venda com promoção. A mesma conta existe na tela de venda
 * (apps/web/src/lib/pricing.ts) para mostrar o valor; quem decide é sempre o servidor.
 *
 * - PRICE: o preço unitário vira o preço promocional.
 * - BUY_X_PAY_Y: a cada X unidades, Y são cobradas (ex.: leve 3, pague 2 → 1 a cada 3 sai de graça).
 * `promoDiscountCents` é quanto o cliente economizou nesta linha.
 */
export function priceLine(
  regularPriceCents: number,
  quantity: number,
  promotion: Pick<Promotion, 'id' | 'type' | 'priceCents' | 'buyQuantity' | 'payQuantity'> | null,
) {
  const regularTotal = Math.round(quantity * regularPriceCents);
  if (promotion?.type === 'PRICE' && promotion.priceCents !== null && promotion.priceCents < regularPriceCents) {
    const totalCents = Math.round(quantity * promotion.priceCents);
    return {
      unitPriceCents: promotion.priceCents,
      totalCents,
      promoDiscountCents: regularTotal - totalCents,
      promotionId: promotion.id,
    };
  }
  if (
    promotion?.type === 'BUY_X_PAY_Y' &&
    promotion.buyQuantity &&
    promotion.payQuantity !== null &&
    promotion.payQuantity < promotion.buyQuantity
  ) {
    const free = Math.floor(quantity / promotion.buyQuantity + 1e-9) * (promotion.buyQuantity - promotion.payQuantity);
    if (free > 0) {
      const promoDiscountCents = free * regularPriceCents;
      return {
        unitPriceCents: regularPriceCents,
        totalCents: regularTotal - promoDiscountCents,
        promoDiscountCents,
        promotionId: promotion.id,
      };
    }
  }
  return { unitPriceCents: regularPriceCents, totalCents: regularTotal, promoDiscountCents: 0, promotionId: null };
}

/** Promoções valendo agora para os produtos (a mais recente, se houver mais de uma). */
export async function activePromotions(productIds?: string[], client: Tx = prisma, now = new Date()) {
  const promotions = await client.promotion.findMany({
    where: {
      active: true,
      startsAt: { lte: now },
      endsAt: { gte: now },
      ...(productIds && { productId: { in: productIds } }),
    },
    orderBy: { createdAt: 'desc' },
  });
  const byProduct = new Map<string, Promotion>();
  for (const promotion of promotions)
    if (!byProduct.has(promotion.productId)) byProduct.set(promotion.productId, promotion);
  return byProduct;
}
