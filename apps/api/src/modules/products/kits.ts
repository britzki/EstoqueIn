import { z } from 'zod';
import { prisma, type Tx } from '../../lib/prisma.js';
import { notFound, unprocessable } from '../../lib/errors.js';
import { isWholeNumber, positiveQty, roundQty } from '../../lib/quantity.js';
import { id } from '../../lib/validation.js';

/**
 * Kit: produto com preço próprio formado por outros (ex.: ração + petisco + brinquedo).
 * Não tem estoque próprio: vender o kit baixa o estoque de cada componente.
 */

export const kitSchema = z.object({
  items: z
    .array(z.object({ productId: id, quantity: positiveQty }))
    .min(1, 'Inclua pelo menos um produto no kit')
    .max(20),
});

export async function setKitItems(kitId: string, input: z.infer<typeof kitSchema>) {
  return prisma.$transaction(async (tx) => {
    const kit = await tx.product.findUnique({ where: { id: kitId } });
    if (!kit) throw notFound('Produto');
    if (!kit.isKit) throw unprocessable('Marque o produto como kit antes de escolher os itens');

    const ids = input.items.map((item) => item.productId);
    if (new Set(ids).size !== ids.length) throw unprocessable('Cada produto aparece uma vez só no kit');
    const components = await tx.product.findMany({ where: { id: { in: ids } } });
    for (const item of input.items) {
      const component = components.find((p) => p.id === item.productId);
      if (!component) throw notFound('Produto do kit');
      if (component.id === kit.id) throw unprocessable('O kit não pode conter ele mesmo');
      if (component.isKit) throw unprocessable(`${component.name} é um kit e não pode estar dentro de outro`);
      if (!component.fractional && !isWholeNumber(item.quantity)) {
        throw unprocessable(`${component.name} é vendido por unidade: use quantidade inteira`);
      }
    }

    await tx.kitItem.deleteMany({ where: { kitId } });
    await tx.kitItem.createMany({
      data: input.items.map((item) => ({ kitId, productId: item.productId, quantity: roundQty(item.quantity) })),
    });
    return tx.kitItem.findMany({ where: { kitId }, include: { product: { select: kitComponentSelect } } });
  });
}

export const kitComponentSelect = {
  id: true,
  sku: true,
  name: true,
  unit: true,
  costCents: true,
  priceCents: true,
  fractional: true,
} as const;

/**
 * Quantos kits dá para montar com o estoque atual (o componente que acabar primeiro limita).
 * Sem `warehouseId`, soma todos os estoques.
 */
export async function kitAvailability(kitIds: string[], warehouseId?: string, client: Tx = prisma) {
  if (kitIds.length === 0) return new Map<string, number>();
  const items = await client.kitItem.findMany({
    where: { kitId: { in: kitIds } },
    include: { product: { select: { stockLevels: { where: { warehouseId }, select: { quantity: true } } } } },
  });
  const result = new Map<string, number>();
  for (const kitId of kitIds) {
    const parts = items.filter((item) => item.kitId === kitId);
    const counts = parts.map((part) =>
      Math.floor(part.product.stockLevels.reduce((sum, level) => sum + level.quantity, 0) / part.quantity + 1e-9),
    );
    result.set(kitId, counts.length ? Math.max(0, Math.min(...counts)) : 0);
  }
  return result;
}

/** Custo do kit: soma do custo médio dos componentes. */
export const kitCostCents = (items: Array<{ quantity: number; product: { costCents: number } }>) =>
  Math.round(items.reduce((sum, item) => sum + item.quantity * item.product.costCents, 0));
