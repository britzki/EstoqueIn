import type { LoyaltyRule } from '@prisma/client';
import { prisma, type Tx } from '../../lib/prisma.js';
import { roundQty } from '../../lib/quantity.js';

/**
 * Cartão fidelidade. Nada é "carimbado": o progresso é calculado a partir das vendas do cliente.
 *   comprado = itens que contam para a regra (produto ou categoria), desde a criação da regra,
 *              em vendas concluídas, descontadas as devoluções e sem contar os próprios brindes;
 *   ganhos   = comprado ÷ quantidade exigida (parte inteira);
 *   usados   = brindes já levados (itens de brinde em vendas concluídas);
 *   disponíveis = ganhos − usados.
 * Cancelar a venda tira a compra do cartão (e devolve o brinde, se ele saiu nela).
 */

export interface LoyaltyProgress {
  rule: Pick<LoyaltyRule, 'id' | 'name' | 'requiredQuantity' | 'rewardQuantity'> & {
    rewardProduct: { id: string; sku: string; name: string; unit: string; fractional: boolean; priceCents: number };
    unit: string;
  };
  purchased: number;
  /** Quanto falta comprar para o próximo brinde. */
  missing: number;
  /** Progresso até o próximo brinde (0 a requiredQuantity). */
  progress: number;
  available: number;
}

const ruleInclude = {
  rewardProduct: { select: { id: true, sku: true, name: true, unit: true, fractional: true, priceCents: true } },
  product: { select: { unit: true } },
} as const;

export async function getCustomerLoyalty(customerId: string, client: Tx = prisma): Promise<LoyaltyProgress[]> {
  const rules = await client.loyaltyRule.findMany({ where: { active: true }, include: ruleInclude });
  if (rules.length === 0) return [];

  const items = await client.saleItem.findMany({
    where: { sale: { customerId, status: 'COMPLETED' } },
    select: {
      quantity: true,
      loyaltyRuleId: true,
      productId: true,
      product: { select: { category: true } },
      sale: { select: { createdAt: true } },
      returnItems: { select: { quantity: true } },
    },
  });

  return rules.map((rule) => {
    let purchased = 0;
    let usedQuantity = 0;
    for (const item of items) {
      if (item.loyaltyRuleId === rule.id) {
        usedQuantity += item.quantity;
        continue;
      }
      if (item.loyaltyRuleId || item.sale.createdAt < rule.createdAt) continue;
      const matches = rule.productId ? item.productId === rule.productId : item.product.category === rule.category;
      if (!matches) continue;
      purchased += item.quantity - item.returnItems.reduce((sum, r) => sum + r.quantity, 0);
    }
    purchased = roundQty(Math.max(purchased, 0));
    const earned = Math.floor(purchased / rule.requiredQuantity + 1e-9);
    const used = Math.round(usedQuantity / rule.rewardQuantity);
    const progress = roundQty(purchased - earned * rule.requiredQuantity);
    return {
      rule: {
        id: rule.id,
        name: rule.name,
        requiredQuantity: rule.requiredQuantity,
        rewardQuantity: rule.rewardQuantity,
        rewardProduct: rule.rewardProduct,
        unit: rule.product?.unit ?? 'UN',
      },
      purchased,
      progress,
      missing: roundQty(rule.requiredQuantity - progress),
      available: Math.max(earned - used, 0),
    };
  });
}
