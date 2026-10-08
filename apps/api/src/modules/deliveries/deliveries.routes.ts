import { Router } from 'express';
import type { DeliveryStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { conflict, notFound } from '../../lib/errors.js';
import { param } from '../../lib/http.js';
import { optionalId } from '../../lib/validation.js';
import { actorOf, diff, recordAudit, recordUpdate } from '../../lib/audit.js';
import { requirePermission } from '../../middleware/auth.js';

/**
 * Painel de entregas: separar → saiu (com o entregador) → entregue.
 * Não entregue (cliente ausente, endereço errado) volta para o painel: dá para mandar de novo
 * ou cancelar a venda (o estoque volta e a entrega é cancelada junto).
 */
export const deliveriesRoutes = Router();

const OPEN: DeliveryStatus[] = ['PENDING', 'OUT', 'FAILED'];

/** O que o painel e a guia do entregador precisam (sem custo de mercadoria). */
const deliveryInclude = {
  customer: { select: { id: true, name: true, phone: true } },
  courier: { select: { id: true, name: true, phone: true } },
  createdBy: { select: { id: true, name: true } },
  sale: {
    select: {
      id: true,
      number: true,
      status: true,
      subtotalCents: true,
      discountCents: true,
      deliveryFeeCents: true,
      totalCents: true,
      paidCents: true,
      changeCents: true,
      createdAt: true,
      items: { select: { id: true, description: true, quantity: true, unit: true, totalCents: true } },
      payments: { select: { method: true, amountCents: true } },
    },
  },
} satisfies Prisma.DeliveryInclude;

const startOfToday = () => {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  return day;
};

/** Sem filtro: as que estão em aberto e as concluídas hoje. Com data: as criadas no período. */
deliveriesRoutes.get('/', async (req, res) => {
  const filters = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }).parse(req.query);
  const where: Prisma.DeliveryWhereInput =
    filters.from || filters.to
      ? { createdAt: { gte: filters.from, lte: filters.to } }
      : { OR: [{ status: { in: OPEN } }, { finishedAt: { gte: startOfToday() } }] };
  const deliveries = await prisma.delivery.findMany({
    where,
    include: deliveryInclude,
    orderBy: [{ dueAt: 'asc' }],
    take: 500,
  });
  res.json(deliveries);
});

/** Acerto com os entregadores: quantas entregas cada um fez no período e quanto dá a pagar. */
deliveriesRoutes.get('/couriers-report', requirePermission('reports:read'), async (req, res) => {
  const { from, to } = z.object({ from: z.coerce.date(), to: z.coerce.date() }).parse(req.query);
  const delivered = await prisma.delivery.findMany({
    where: { status: 'DELIVERED', finishedAt: { gte: from, lte: to } },
    select: { courierId: true, feeCents: true, collectOnDelivery: true, sale: { select: { totalCents: true } } },
  });
  const couriers = await prisma.courier.findMany({ orderBy: { name: 'asc' } });
  const rows = [...new Set(delivered.map((d) => d.courierId))].map((courierId) => {
    const mine = delivered.filter((d) => d.courierId === courierId);
    const courier = couriers.find((c) => c.id === courierId) ?? null;
    return {
      courier: courier && { id: courier.id, name: courier.name, feePerDeliveryCents: courier.feePerDeliveryCents },
      deliveries: mine.length,
      feesChargedCents: mine.reduce((sum, d) => sum + d.feeCents, 0),
      collectedCents: mine.filter((d) => d.collectOnDelivery).reduce((sum, d) => sum + d.sale.totalCents, 0),
      toPayCents: (courier?.feePerDeliveryCents ?? 0) * mine.length,
    };
  });
  res.json(rows.sort((a, b) => b.deliveries - a.deliveries));
});

deliveriesRoutes.get('/:id', async (req, res) => {
  const delivery = await prisma.delivery.findUnique({ where: { id: param(req, 'id') }, include: deliveryInclude });
  if (!delivery) throw notFound('Entrega');
  res.json(delivery);
});

async function changeStatus(
  req: Parameters<typeof actorOf>[0],
  allowed: DeliveryStatus[],
  data: Prisma.DeliveryUncheckedUpdateInput,
  summary: (delivery: { number: number; courier: { name: string } | null }) => string,
) {
  const delivery = await prisma.delivery.findUnique({ where: { id: param(req, 'id') } });
  if (!delivery) throw notFound('Entrega');
  if (!allowed.includes(delivery.status)) {
    throw conflict(
      delivery.status === 'CANCELLED'
        ? 'Esta entrega foi cancelada junto com a venda'
        : delivery.status === 'DELIVERED'
          ? 'Esta entrega já foi concluída'
          : 'A entrega não está nesta etapa',
    );
  }
  const updated = await prisma.delivery.update({ where: { id: delivery.id }, data, include: deliveryInclude });
  await recordAudit(actorOf(req), {
    action: 'UPDATE',
    entity: 'Delivery',
    entityId: updated.id,
    summary: summary(updated),
  });
  return updated;
}

/** Saiu para entrega (pode mandar de novo uma que não foi entregue). */
deliveriesRoutes.post('/:id/dispatch', requirePermission('sales:create'), async (req, res) => {
  const { courierId } = z.object({ courierId: optionalId }).parse(req.body);
  if (courierId && !(await prisma.courier.findUnique({ where: { id: courierId } }))) throw notFound('Entregador');
  res.json(
    await changeStatus(
      req,
      ['PENDING', 'FAILED'],
      { status: 'OUT', courierId: courierId ?? null, outAt: new Date(), failReason: null, finishedAt: null },
      (d) => `Entrega nº ${d.number} saiu${d.courier ? ` com ${d.courier.name}` : ''}`,
    ),
  );
});

deliveriesRoutes.post('/:id/deliver', requirePermission('sales:create'), async (req, res) => {
  res.json(
    await changeStatus(
      req,
      ['PENDING', 'OUT'],
      { status: 'DELIVERED', finishedAt: new Date() },
      (d) => `Entrega nº ${d.number} concluída`,
    ),
  );
});

deliveriesRoutes.post('/:id/fail', requirePermission('sales:create'), async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Informe o que aconteceu').max(160) }).parse(req.body);
  res.json(
    await changeStatus(
      req,
      ['PENDING', 'OUT'],
      { status: 'FAILED', failReason: reason, finishedAt: null },
      (d) => `Entrega nº ${d.number} não entregue: ${reason}`,
    ),
  );
});

/** Entregadores (motoboy próprio ou terceirizado). */
export const couriersRoutes = Router();

const courierSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(80),
  phone: z.preprocess(
    (value) => (typeof value === 'string' ? value.replace(/\D/g, '') || null : value),
    z
      .string()
      .regex(/^\d{10,13}$/, 'Telefone com DDD, só números')
      .nullable()
      .optional(),
  ),
  /** Quanto a loja paga ao entregador por entrega (para o acerto). */
  feePerDeliveryCents: z.number().int().min(0).max(100_000).default(0),
  active: z.boolean().optional(),
});

couriersRoutes.get('/', async (_req, res) => {
  res.json(await prisma.courier.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] }));
});

couriersRoutes.post('/', requirePermission('settings:manage'), async (req, res) => {
  const courier = await prisma.courier.create({ data: courierSchema.parse(req.body) });
  await recordAudit(actorOf(req), {
    action: 'CREATE',
    entity: 'Courier',
    entityId: courier.id,
    summary: `Entregador ${courier.name} cadastrado`,
  });
  res.status(201).json(courier);
});

couriersRoutes.patch('/:id', requirePermission('settings:manage'), async (req, res) => {
  const data = courierSchema.partial().parse(req.body);
  const before = await prisma.courier.findUnique({ where: { id: param(req, 'id') } });
  if (!before) throw notFound('Entregador');
  const courier = await prisma.courier.update({ where: { id: before.id }, data });
  await recordUpdate(actorOf(req), {
    entity: 'Courier',
    entityId: courier.id,
    summary: `Entregador ${courier.name} alterado`,
    changes: diff(before, data, ['name', 'phone', 'feePerDeliveryCents', 'active']),
  });
  res.json(courier);
});
