import { Router, type Request } from 'express';
import { canSeeFinancials } from '../../lib/visibility.js';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { conflict, notFound, unprocessable } from '../../lib/errors.js';
import { param } from '../../lib/http.js';
import { paginated, paginationSchema, toSkipTake } from '../../lib/pagination.js';
import { positiveQty, roundQty } from '../../lib/quantity.js';
import { id, optionalId, optionalText } from '../../lib/validation.js';
import { actorOf, recordAudit } from '../../lib/audit.js';
import { currentUser, requirePermission } from '../../middleware/auth.js';

/**
 * Pedidos de compra: o que foi pedido a cada fornecedor e ainda não chegou.
 * A mercadoria entra no estoque pela NF-e ou pela entrada manual; o pedido só registra o que foi pedido
 * (e evita que a sugestão de compra peça de novo o que já está a caminho).
 */
export const purchaseOrdersRoutes = Router();

const orderSchema = z.object({
  supplierId: optionalId,
  items: z.array(z.object({ productId: id, quantity: positiveQty })).min(1, 'Inclua pelo menos um produto'),
  notes: optionalText(500),
});

const include = {
  supplier: { select: { id: true, name: true, phone: true, email: true, contactName: true } },
  createdBy: { select: { id: true, name: true } },
  items: { orderBy: { description: 'asc' as const } },
} as const;

/** Total estimado pelo último custo; sem permissão de números do negócio, sem custos. */
const withTotal = <T extends { items: Array<{ quantity: number; unitCostCents: number }> }>(order: T, req: Request) =>
  canSeeFinancials(req)
    ? {
        ...order,
        totalCents: order.items.reduce((sum, item) => sum + Math.round(item.quantity * item.unitCostCents), 0),
      }
    : { ...order, totalCents: null, items: order.items.map((item) => ({ ...item, unitCostCents: null })) };

/** Quantidade já pedida (pedidos em aberto) por produto. */
export async function quantitiesOnOrder() {
  const items = await prisma.purchaseOrderItem.groupBy({
    by: ['productId'],
    where: { order: { status: 'OPEN' } },
    _sum: { quantity: true },
  });
  return new Map(items.map((item) => [item.productId, roundQty(item._sum.quantity ?? 0)]));
}

purchaseOrdersRoutes.get('/', async (req, res) => {
  const filters = paginationSchema
    .extend({ status: z.enum(['OPEN', 'RECEIVED', 'CANCELLED']).optional() })
    .parse(req.query);
  const where: Prisma.PurchaseOrderWhereInput = { status: filters.status };
  const [data, total] = await prisma.$transaction([
    prisma.purchaseOrder.findMany({ where, include, orderBy: { number: 'desc' }, ...toSkipTake(filters) }),
    prisma.purchaseOrder.count({ where }),
  ]);
  res.json(
    paginated(
      data.map((order) => withTotal(order, req)),
      total,
      filters,
    ),
  );
});

purchaseOrdersRoutes.get('/:id', async (req, res) => {
  const order = await prisma.purchaseOrder.findUnique({ where: { id: param(req, 'id') }, include });
  if (!order) throw notFound('Pedido');
  res.json(withTotal(order, req));
});

purchaseOrdersRoutes.post('/', requirePermission('products:write'), async (req, res) => {
  const input = orderSchema.parse(req.body);
  const order = await prisma.$transaction(async (tx) => {
    if (input.supplierId && !(await tx.supplier.findUnique({ where: { id: input.supplierId } }))) {
      throw notFound('Fornecedor');
    }
    const products = await tx.product.findMany({ where: { id: { in: input.items.map((item) => item.productId) } } });
    const items = input.items.map((item) => {
      const product = products.find((p) => p.id === item.productId);
      if (!product) throw notFound('Produto');
      if (!product.fractional && !Number.isInteger(item.quantity)) {
        throw unprocessable(`${product.name} é vendido por unidade: use quantidade inteira`);
      }
      return {
        productId: product.id,
        description: product.name,
        unit: product.unit,
        quantity: item.quantity,
        unitCostCents: product.costCents,
      };
    });
    const last = await tx.purchaseOrder.aggregate({ _max: { number: true } });
    return tx.purchaseOrder.create({
      data: {
        number: (last._max.number ?? 0) + 1,
        supplierId: input.supplierId ?? null,
        notes: input.notes ?? null,
        createdById: currentUser(req).id,
        items: { create: items },
      },
      include,
    });
  });
  await recordAudit(actorOf(req), {
    action: 'CREATE',
    entity: 'PurchaseOrder',
    entityId: order.id,
    summary: `Pedido de compra nº ${order.number}${order.supplier ? ` para ${order.supplier.name}` : ''} (${order.items.length} produto(s))`,
  });
  res.status(201).json(withTotal(order, req));
});

const STATUS_LABEL = { RECEIVED: 'recebido', CANCELLED: 'cancelado' } as const;

/** Marca o pedido como recebido ou cancelado: deixa de contar como "já pedido" na sugestão de compra. */
purchaseOrdersRoutes.post('/:id/status', requirePermission('products:write'), async (req, res) => {
  const { status } = z.object({ status: z.enum(['RECEIVED', 'CANCELLED']) }).parse(req.body);
  const current = await prisma.purchaseOrder.findUnique({ where: { id: param(req, 'id') } });
  if (!current) throw notFound('Pedido');
  if (current.status !== 'OPEN') throw conflict('Este pedido já foi encerrado');
  const order = await prisma.purchaseOrder.update({
    where: { id: current.id },
    data: { status, closedAt: new Date() },
    include,
  });
  await recordAudit(actorOf(req), {
    action: 'UPDATE',
    entity: 'PurchaseOrder',
    entityId: order.id,
    summary: `Pedido de compra nº ${order.number} marcado como ${STATUS_LABEL[status]}`,
  });
  res.json(withTotal(order, req));
});
