import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { formatMoney } from './format';
import type { Promotion } from './types';

/**
 * Preço de uma linha com promoção: a mesma conta do servidor (apps/api/src/modules/promotions/pricing.ts).
 * Aqui serve só para mostrar o valor na tela; quem decide o preço é o servidor.
 */
export function priceLine(regularPriceCents: number, quantity: number, promotion: Promotion | undefined) {
  const regularTotal = Math.round(quantity * regularPriceCents);
  if (promotion?.type === 'PRICE' && promotion.priceCents !== null && promotion.priceCents < regularPriceCents) {
    const totalCents = Math.round(quantity * promotion.priceCents);
    return { unitPriceCents: promotion.priceCents, totalCents, savingsCents: regularTotal - totalCents };
  }
  if (
    promotion?.type === 'BUY_X_PAY_Y' &&
    promotion.buyQuantity &&
    promotion.payQuantity !== null &&
    promotion.payQuantity < promotion.buyQuantity
  ) {
    const free = Math.floor(quantity / promotion.buyQuantity + 1e-9) * (promotion.buyQuantity - promotion.payQuantity);
    if (free > 0) {
      return {
        unitPriceCents: regularPriceCents,
        totalCents: regularTotal - free * regularPriceCents,
        savingsCents: free * regularPriceCents,
      };
    }
  }
  return { unitPriceCents: regularPriceCents, totalCents: regularTotal, savingsCents: 0 };
}

/** Texto curto: "por R$ 85,00" ou "leve 3, pague 2". */
export const promotionLabel = (promotion: Promotion) =>
  promotion.type === 'PRICE'
    ? `por ${formatMoney(promotion.priceCents ?? 0)}`
    : `leve ${promotion.buyQuantity}, pague ${promotion.payQuantity}`;

/** Promoções valendo agora, por produto. Atualiza a cada minuto (promoções começam e terminam sozinhas). */
export function useActivePromotions() {
  return useQuery({
    queryKey: ['promotions', 'active'],
    queryFn: () => api.get<Promotion[]>('/promotions/active'),
    select: (list) => new Map(list.map((promotion) => [promotion.productId, promotion])),
    refetchInterval: 60_000,
  });
}
