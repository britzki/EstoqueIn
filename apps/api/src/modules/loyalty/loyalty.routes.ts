import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { param } from '../../lib/http.js';
import { positiveQty } from '../../lib/quantity.js';
import { id, optionalId, optionalText } from '../../lib/validation.js';
import { actorOf, diff, recordAudit, recordUpdate } from '../../lib/audit.js';
import { requirePermission } from '../../middleware/auth.js';

/** Regras do cartão fidelidade ("a cada 10 sacos de ração, ganha 1"). */
export const loyaltyRoutes = Router();

const ruleSchema = z.object({
  name: z.string().trim().min(3, 'Dê um nome ao cartão').max(80),
  /** Conta um produto específico... */
  productId: optionalId,
  /** ...ou todos os produtos de uma categoria. */
  category: optionalText(60),
  requiredQuantity: positiveQty,
  rewardProductId: id,
  rewardQuantity: positiveQty.default(1),
  active: z.boolean().optional(),
});
// No Zod 4, .partial() ainda aplica os .default(): sem tirar o padrão, um PATCH sem o campo o zeraria.
const ruleUpdateSchema = ruleSchema.extend({ rewardQuantity: positiveQty }).partial();

const include = {
  product: { select: { id: true, name: true, unit: true } },
  rewardProduct: { select: { id: true, name: true, unit: true } },
} as const;

async function validate(data: { productId?: string | null; category?: string | null; rewardProductId?: string }) {
  if (!data.productId === !data.category)
    throw badRequest('Escolha um produto OU uma categoria para contar as compras');
  if (data.productId && !(await prisma.product.findUnique({ where: { id: data.productId } })))
    throw notFound('Produto');
  if (data.rewardProductId && !(await prisma.product.findUnique({ where: { id: data.rewardProductId } }))) {
    throw notFound('Produto do brinde');
  }
}

loyaltyRoutes.get('/', async (_req, res) => {
  res.json(await prisma.loyaltyRule.findMany({ include, orderBy: [{ active: 'desc' }, { name: 'asc' }] }));
});

loyaltyRoutes.post('/', requirePermission('settings:manage'), async (req, res) => {
  const data = ruleSchema.parse(req.body);
  await validate(data);
  const rule = await prisma.loyaltyRule.create({
    data: { ...data, productId: data.productId ?? null, category: data.category ?? null },
    include,
  });
  await recordAudit(actorOf(req), {
    action: 'CREATE',
    entity: 'LoyaltyRule',
    entityId: rule.id,
    summary: `Cartão fidelidade "${rule.name}": a cada ${rule.requiredQuantity} de ${rule.product?.name ?? `categoria ${rule.category}`}, ganha ${rule.rewardQuantity} ${rule.rewardProduct.name}`,
  });
  res.status(201).json(rule);
});

/** Alterar a regra não apaga o histórico: as compras continuam contando. */
loyaltyRoutes.patch('/:id', requirePermission('settings:manage'), async (req, res) => {
  const data = ruleUpdateSchema.parse(req.body);
  const before = await prisma.loyaltyRule.findUnique({ where: { id: param(req, 'id') } });
  if (!before) throw notFound('Cartão fidelidade');
  // Confere a regra como ela vai ficar (o que foi enviado sobre o que já existe).
  await validate({
    productId: data.productId !== undefined ? data.productId : before.productId,
    category: data.category !== undefined ? data.category : before.category,
    rewardProductId: data.rewardProductId,
  });
  const rule = await prisma.loyaltyRule.update({ where: { id: before.id }, data, include });
  await recordUpdate(actorOf(req), {
    entity: 'LoyaltyRule',
    entityId: rule.id,
    summary: `Cartão fidelidade "${rule.name}" alterado`,
    changes: diff(before, data, [
      'name',
      'productId',
      'category',
      'requiredQuantity',
      'rewardProductId',
      'rewardQuantity',
      'active',
    ]),
  });
  res.json(rule);
});
