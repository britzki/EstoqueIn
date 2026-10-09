import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { badRequest, notFound, unprocessable } from '../../lib/errors.js';
import { param } from '../../lib/http.js';
import { formatCents } from '../../lib/money.js';
import { id, positiveInt } from '../../lib/validation.js';
import { actorOf, recordAudit } from '../../lib/audit.js';
import { currentUser, requirePermission } from '../../middleware/auth.js';
import { activePromotions } from './pricing.js';

/** Promoções com prazo: preço promocional ou "leve X, pague Y", entre duas datas. */
export const promotionsRoutes = Router();

const promotionSchema = z
  .object({
    productId: id,
    type: z.enum(['PRICE', 'BUY_X_PAY_Y']),
    priceCents: positiveInt.optional(),
    buyQuantity: z.number().int().min(2).max(100).optional(),
    payQuantity: z.number().int().min(1).max(99).optional(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })
  .refine((value) => value.endsAt > value.startsAt, { message: 'O fim deve ser depois do início', path: ['endsAt'] });

const include = { product: { select: { id: true, sku: true, name: true, unit: true, priceCents: true } } } as const;

/** Texto curto da promoção, usado no registro de alterações e na tela. */
function describePromotion(promotion: {
  type: string;
  priceCents: number | null;
  buyQuantity: number | null;
  payQuantity: number | null;
}) {
  return promotion.type === 'PRICE'
    ? `por ${formatCents(promotion.priceCents ?? 0)}`
    : `leve ${promotion.buyQuantity}, pague ${promotion.payQuantity}`;
}

/** Valendo agora: a tela de venda usa para mostrar o preço promocional. */
promotionsRoutes.get('/active', async (_req, res) => {
  res.json([...(await activePromotions()).values()]);
});

promotionsRoutes.get('/', async (req, res) => {
  const status = z.enum(['current', 'scheduled', 'ended', 'all']).default('current').parse(req.query.status);
  const now = new Date();
  const where =
    status === 'current'
      ? { active: true, startsAt: { lte: now }, endsAt: { gte: now } }
      : status === 'scheduled'
        ? { active: true, startsAt: { gt: now } }
        : status === 'ended'
          ? { OR: [{ endsAt: { lt: now } }, { active: false }] }
          : {};
  res.json(await prisma.promotion.findMany({ where, include, orderBy: { startsAt: 'desc' }, take: 200 }));
});

promotionsRoutes.post('/', requirePermission('products:write'), async (req, res) => {
  const input = promotionSchema.parse(req.body);
  const product = await prisma.product.findUnique({ where: { id: input.productId } });
  if (!product) throw notFound('Produto');
  if (input.type === 'PRICE') {
    if (!input.priceCents) throw badRequest('Informe o preço promocional');
    if (input.priceCents >= product.priceCents) {
      throw unprocessable(
        `O preço promocional precisa ser menor que o preço normal (${formatCents(product.priceCents)})`,
      );
    }
  } else {
    if (!input.buyQuantity || !input.payQuantity) throw badRequest('Informe o "leve" e o "pague"');
    if (input.payQuantity >= input.buyQuantity) throw unprocessable('O "pague" precisa ser menor que o "leve"');
    if (product.fractional) throw unprocessable('"Leve X, pague Y" vale para produtos vendidos por unidade');
  }
  const promotion = await prisma.promotion.create({
    data: {
      productId: product.id,
      type: input.type,
      priceCents: input.type === 'PRICE' ? input.priceCents : null,
      buyQuantity: input.type === 'BUY_X_PAY_Y' ? input.buyQuantity : null,
      payQuantity: input.type === 'BUY_X_PAY_Y' ? input.payQuantity : null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      createdById: currentUser(req).id,
    },
    include,
  });
  await recordAudit(actorOf(req), {
    action: 'CREATE',
    entity: 'Promotion',
    entityId: promotion.id,
    summary: `Promoção de ${product.name}: ${describePromotion(promotion)} de ${input.startsAt.toLocaleDateString('pt-BR')} a ${input.endsAt.toLocaleDateString('pt-BR')}`,
  });
  res.status(201).json(promotion);
});

/** Encerra a promoção antes do prazo (o preço volta ao normal na hora). */
promotionsRoutes.post('/:id/end', requirePermission('products:write'), async (req, res) => {
  const current = await prisma.promotion.findUnique({ where: { id: param(req, 'id') }, include });
  if (!current) throw notFound('Promoção');
  const promotion = await prisma.promotion.update({ where: { id: current.id }, data: { active: false }, include });
  await recordAudit(actorOf(req), {
    action: 'UPDATE',
    entity: 'Promotion',
    entityId: promotion.id,
    summary: `Promoção de ${current.product.name} (${describePromotion(current)}) encerrada`,
  });
  res.json(promotion);
});
