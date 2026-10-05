import { z } from 'zod';
import { prisma, type Tx } from '../../lib/prisma.js';
import { AppError, badRequest, conflict, notFound, unprocessable } from '../../lib/errors.js';
import { id, nonNegativeInt, optionalId, optionalText, positiveInt } from '../../lib/validation.js';
import { positiveQty, roundQty } from '../../lib/quantity.js';
import { normalizeScaleCode, parseScaleLabel } from '../../lib/scale.js';
import { applyMovement } from '../stock/stock.service.js';
import { publishAlertChanges, type AlertChange } from '../alerts/alerts.service.js';
import { getStoreSettings } from '../settings/settings.routes.js';
import { assertAccountSale, getCustomerBalance } from '../customers/account.js';

/** ACCOUNT = fiado: o valor fica na conta do cliente e é pago depois. */
export const paymentMethods = ['CASH', 'PIX', 'DEBIT', 'CREDIT', 'OTHER', 'ACCOUNT'] as const;

export const saleSchema = z.object({
  warehouseId: id,
  items: z.array(z.object({ productId: id, quantity: positiveQty })).min(1, 'Adicione pelo menos um item'),
  discountCents: nonNegativeInt.default(0),
  payments: z
    .array(z.object({ method: z.enum(paymentMethods), amountCents: positiveInt }))
    .min(1, 'Informe a forma de pagamento'),
  customerName: optionalText(120),
  customerId: optionalId,
  notes: optionalText(255),
});

export type SaleInput = z.infer<typeof saleSchema>;

const saleInclude = {
  items: true,
  payments: true,
  warehouse: { select: { id: true, name: true } },
  user: { select: { id: true, name: true } },
  cancelledBy: { select: { id: true, name: true } },
  customer: { select: { id: true, name: true, phone: true } },
  returns: {
    include: { items: true, user: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
} as const;

/**
 * Registra uma venda: grava a venda, os itens e os pagamentos e baixa o estoque de cada item,
 * tudo numa única transação. Se faltar estoque de qualquer item, nada é gravado.
 * O preço vem sempre do cadastro do produto, nunca do navegador.
 */
export async function createSale(input: SaleInput, userId: string) {
  const result = await prisma.$transaction(
    async (tx) => {
      const warehouse = await tx.warehouse.findUnique({ where: { id: input.warehouseId } });
      if (!warehouse?.active) throw notFound('Estoque');

      const settings = await getStoreSettings(tx);
      const cashSession = await tx.cashSession.findFirst({ where: { warehouseId: warehouse.id, status: 'OPEN' } });
      if (settings.requireCashSession && !cashSession) {
        throw unprocessable('O caixa está fechado. Abra o caixa para registrar vendas.', 'CASH_CLOSED');
      }
      const customer = input.customerId ? await tx.customer.findUnique({ where: { id: input.customerId } }) : null;
      if (input.customerId && !customer) throw notFound('Cliente');

      const products = await tx.product.findMany({ where: { id: { in: input.items.map((item) => item.productId) } } });
      const lines = input.items.map((item) => {
        const product = products.find((p) => p.id === item.productId);
        if (!product) throw notFound('Produto');
        if (!product.active) throw unprocessable(`${product.name} está inativo e não pode ser vendido`);
        if (product.priceCents <= 0) throw unprocessable(`${product.name} está sem preço de venda`, 'MISSING_PRICE');
        return { product, quantity: item.quantity, totalCents: Math.round(item.quantity * product.priceCents) };
      });

      const subtotalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
      if (input.discountCents > subtotalCents) throw unprocessable('O desconto não pode ser maior que o total');
      const totalCents = subtotalCents - input.discountCents;

      const paidCents = input.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
      if (paidCents < totalCents) {
        throw unprocessable('O valor pago é menor que o total da venda', 'INSUFFICIENT_PAYMENT', {
          totalCents,
          paidCents,
        });
      }
      const changeCents = paidCents - totalCents;
      const cashCents = input.payments.filter((p) => p.method === 'CASH').reduce((sum, p) => sum + p.amountCents, 0);
      if (changeCents > cashCents)
        throw unprocessable('Só é possível dar troco sobre pagamento em dinheiro', 'INVALID_CHANGE');
      const accountCents = input.payments
        .filter((p) => p.method === 'ACCOUNT')
        .reduce((sum, p) => sum + p.amountCents, 0);
      if (accountCents > 0) await assertAccountSale(tx, customer, accountCents, totalCents);

      const last = await tx.sale.aggregate({ _max: { number: true } });
      const number = (last._max.number ?? 0) + 1;

      const sale = await tx.sale.create({
        data: {
          number,
          warehouseId: warehouse.id,
          userId,
          customerName: input.customerName ?? customer?.name ?? null,
          customerId: customer?.id ?? null,
          cashSessionId: cashSession?.id ?? null,
          notes: input.notes ?? null,
          subtotalCents,
          discountCents: input.discountCents,
          totalCents,
          paidCents,
          changeCents,
          costCents: lines.reduce((sum, line) => sum + Math.round(line.quantity * line.product.costCents), 0),
          items: {
            create: lines.map((line) => ({
              productId: line.product.id,
              description: line.product.name,
              unit: line.product.unit,
              quantity: line.quantity,
              unitPriceCents: line.product.priceCents,
              totalCents: line.totalCents,
              unitCostCents: line.product.costCents,
            })),
          },
          payments: { create: input.payments },
        },
        include: saleInclude,
      });

      const alerts: AlertChange[] = [];
      for (const line of lines) {
        try {
          const { alert } = await applyMovement(tx, {
            type: 'EXIT',
            productId: line.product.id,
            warehouseId: warehouse.id,
            delta: -line.quantity,
            unitCostCents: line.product.costCents,
            documentRef: `Venda ${number}`,
            reason: 'Venda',
            saleId: sale.id,
            userId,
            allowNegative: settings.allowNegativeStock,
          });
          alerts.push(alert);
        } catch (error) {
          // Deixa claro qual produto faltou, já que a venda tem vários.
          if (error instanceof AppError && error.code === 'INSUFFICIENT_STOCK') {
            const details = error.details as { available: number };
            throw unprocessable(
              `Estoque insuficiente de ${line.product.name}: disponível ${details.available} ${line.product.unit}`,
              'INSUFFICIENT_STOCK',
              { ...details, productId: line.product.id },
            );
          }
          throw error;
        }
      }

      // Na notinha de venda fiada sai o total que o cliente ficou devendo.
      const customerBalanceCents = accountCents > 0 && customer ? await getCustomerBalance(customer.id, tx) : undefined;
      return { sale, alerts, customerBalanceCents };
    },
    { timeout: 30_000 },
  );

  publishAlertChanges(result.alerts);
  return {
    ...result.sale,
    customerBalanceCents: result.customerBalanceCents,
    alertsOpened: result.alerts.filter((alert) => alert.kind === 'opened' || alert.kind === 'escalated').length,
  };
}

/** Cancela a venda: os itens voltam ao estoque e a venda sai dos relatórios, mas fica no histórico. */
export async function cancelSale(saleId: string, reason: string, userId: string) {
  const result = await prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findUnique({ where: { id: saleId }, include: { items: true } });
    if (!sale) throw notFound('Venda');
    if (sale.status === 'CANCELLED') throw conflict('Esta venda já foi cancelada');
    if (await tx.saleReturn.count({ where: { saleId: sale.id } })) {
      throw conflict('Esta venda já tem devolução. Para desfazer o restante, use "Devolver itens".');
    }

    const alerts: AlertChange[] = [];
    for (const item of sale.items) {
      const { alert } = await applyMovement(tx, {
        type: 'SALE_CANCEL',
        productId: item.productId,
        warehouseId: sale.warehouseId,
        delta: item.quantity,
        unitCostCents: item.unitCostCents,
        documentRef: `Venda ${sale.number}`,
        reason: `Cancelamento da venda ${sale.number}: ${reason}`,
        saleId: sale.id,
        userId,
      });
      alerts.push(alert);
    }

    const updated = await tx.sale.update({
      where: { id: sale.id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: userId, cancelReason: reason },
      include: saleInclude,
    });
    return { sale: updated, alerts };
  });

  publishAlertChanges(result.alerts);
  return result.sale;
}

export const getSale = async (saleId: string) => {
  const sale = await prisma.sale.findUnique({ where: { id: saleId }, include: saleInclude });
  if (!sale) throw notFound('Venda');
  return sale;
};

/**
 * Descobre o que foi bipado ou digitado no caixa:
 * 1. código de barras do produto;
 * 2. etiqueta da balança (código do produto + peso ou preço);
 * 3. SKU digitado.
 */
export async function resolveCode(rawCode: string, warehouseId?: string) {
  const code = rawCode.trim();
  if (!code) throw badRequest('Informe o código');

  const select = {
    id: true,
    sku: true,
    name: true,
    unit: true,
    fractional: true,
    priceCents: true,
    active: true,
    stockLevels: { where: { warehouseId }, select: { quantity: true } },
  } as const;
  type Found = NonNullable<Awaited<ReturnType<typeof prisma.product.findFirst<{ select: typeof select }>>>>;

  const present = (
    { stockLevels, ...product }: Found,
    quantity: number | null,
    source: string,
    labelTotalCents?: number,
  ) => ({
    product: { ...product, stock: roundQty(stockLevels.reduce((sum, level) => sum + level.quantity, 0)) },
    // null = a tela pergunta a quantidade (produto por peso sem etiqueta).
    quantity,
    source,
    labelTotalCents,
  });

  const byBarcode = await prisma.product.findUnique({ where: { barcode: code }, select });
  if (byBarcode?.active) return present(byBarcode, byBarcode.fractional ? null : 1, 'barcode');

  const label = parseScaleLabel(code, await getStoreSettings());
  if (label) {
    const candidates = await prisma.product.findMany({
      where: { scaleCode: { not: null }, active: true },
      select: { ...select, scaleCode: true },
    });
    const match = candidates.find((product) => normalizeScaleCode(product.scaleCode!) === label.scaleCode);
    if (!match) throw notFound(`Produto com o código de balança ${label.scaleCode}`);
    const { scaleCode: _scaleCode, ...product } = match;

    if (label.weightKg !== undefined) return present(product, roundQty(label.weightKg), 'scale');
    if (product.priceCents <= 0) throw unprocessable(`${product.name} está sem preço de venda`, 'MISSING_PRICE');
    // Etiqueta com preço: a quantidade é deduzida pelo preço por kg cadastrado.
    return present(product, roundQty(label.totalCents! / product.priceCents), 'scale', label.totalCents);
  }

  const bySku = await prisma.product.findUnique({ where: { sku: code.toUpperCase() }, select });
  if (bySku?.active) return present(bySku, bySku.fractional ? null : 1, 'sku');

  throw notFound('Produto com este código');
}

export const returnSchema = z.object({
  items: z.array(z.object({ saleItemId: id, quantity: positiveQty })).min(1, 'Escolha pelo menos um item'),
  reason: z.string().trim().min(3, 'Informe o motivo da devolução').max(255),
  refundMethod: z.enum(paymentMethods),
});

export type ReturnInput = z.infer<typeof returnSchema>;

/** Quanto de cada item ainda pode ser devolvido (vendido menos o que já voltou). */
export async function returnableQuantities(saleId: string, client: Tx = prisma) {
  const items = await client.saleItem.findMany({ where: { saleId }, include: { returnItems: true } });
  return new Map(
    items.map((item) => [item.id, roundQty(item.quantity - item.returnItems.reduce((sum, r) => sum + r.quantity, 0))]),
  );
}

/**
 * Devolução parcial: os itens voltam ao estoque e o valor é estornado pela forma escolhida.
 * Se a venda teve desconto, o estorno é proporcional (o cliente recebe o que de fato pagou).
 */
export async function createReturn(saleId: string, input: ReturnInput, userId: string) {
  const result = await prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findUnique({ where: { id: saleId }, include: { items: true } });
    if (!sale) throw notFound('Venda');
    if (sale.status === 'CANCELLED') throw conflict('Venda cancelada não aceita devolução');

    // "Abater do fiado" só faz sentido se a venda tem cliente (a dívida é dele).
    if (input.refundMethod === 'ACCOUNT' && !sale.customerId) {
      throw unprocessable(
        'Esta venda não tem cliente: escolha outra forma de devolver o dinheiro',
        'ACCOUNT_NEEDS_CUSTOMER',
      );
    }

    const remaining = await returnableQuantities(sale.id, tx);
    const discountFactor = sale.subtotalCents > 0 ? sale.totalCents / sale.subtotalCents : 1;

    const lines = input.items.map((line) => {
      const item = sale.items.find((saleItem) => saleItem.id === line.saleItemId);
      if (!item) throw notFound('Item da venda');
      const available = remaining.get(item.id) ?? 0;
      if (line.quantity > available + 1e-9) {
        throw unprocessable(
          `${item.description}: só é possível devolver ${available} ${item.unit}`,
          'RETURN_EXCEEDS_SOLD',
        );
      }
      return {
        item,
        quantity: line.quantity,
        refundCents: Math.round(line.quantity * item.unitPriceCents * discountFactor),
        costCents: Math.round(line.quantity * item.unitCostCents),
      };
    });

    const settings = await getStoreSettings(tx);
    const cashSession = await tx.cashSession.findFirst({ where: { warehouseId: sale.warehouseId, status: 'OPEN' } });
    if (input.refundMethod === 'CASH' && settings.requireCashSession && !cashSession) {
      throw unprocessable('O caixa está fechado. Abra o caixa para devolver em dinheiro.', 'CASH_CLOSED');
    }

    const saleReturn = await tx.saleReturn.create({
      data: {
        saleId: sale.id,
        userId,
        cashSessionId: cashSession?.id ?? null,
        reason: input.reason,
        refundMethod: input.refundMethod,
        refundCents: lines.reduce((sum, line) => sum + line.refundCents, 0),
        costCents: lines.reduce((sum, line) => sum + line.costCents, 0),
        items: {
          create: lines.map((line) => ({
            saleItemId: line.item.id,
            quantity: line.quantity,
            refundCents: line.refundCents,
          })),
        },
      },
      include: { items: true },
    });

    const alerts: AlertChange[] = [];
    for (const line of lines) {
      const { alert } = await applyMovement(tx, {
        type: 'SALE_RETURN',
        productId: line.item.productId,
        warehouseId: sale.warehouseId,
        delta: line.quantity,
        unitCostCents: line.item.unitCostCents,
        documentRef: `Venda ${sale.number}`,
        reason: `Devolução da venda ${sale.number}: ${input.reason}`,
        saleId: sale.id,
        userId,
      });
      alerts.push(alert);
    }
    return { saleReturn, sale, alerts };
  });

  publishAlertChanges(result.alerts);
  return { ...result.saleReturn, saleNumber: result.sale.number };
}

const QUICK_LIMIT = 8;
const QUICK_DAYS = 30;

/**
 * Botões rápidos da tela de venda: primeiro os produtos marcados no cadastro;
 * se sobrar espaço, completa com os mais vendidos dos últimos 30 dias.
 */
export async function getQuickProducts(warehouseId?: string) {
  const select = {
    id: true,
    sku: true,
    name: true,
    unit: true,
    fractional: true,
    priceCents: true,
    quickSale: true,
    stockLevels: { where: { warehouseId }, select: { quantity: true } },
  } as const;
  const sellable = { active: true, priceCents: { gt: 0 } };

  const pinned = await prisma.product.findMany({
    where: { ...sellable, quickSale: true },
    select,
    orderBy: { name: 'asc' },
    take: QUICK_LIMIT,
  });

  let best: typeof pinned = [];
  if (pinned.length < QUICK_LIMIT) {
    const since = new Date(Date.now() - QUICK_DAYS * 24 * 60 * 60 * 1000);
    const ranking = await prisma.saleItem.groupBy({
      by: ['productId'],
      where: {
        sale: { status: 'COMPLETED', createdAt: { gte: since } },
        productId: { notIn: pinned.map((p) => p.id) },
      },
      _count: { _all: true },
      orderBy: { _count: { productId: 'desc' } },
      take: QUICK_LIMIT * 2,
    });
    const found = await prisma.product.findMany({
      where: { ...sellable, id: { in: ranking.map((row) => row.productId) } },
      select,
    });
    best = ranking
      .map((row) => found.find((product) => product.id === row.productId))
      .filter((product): product is (typeof found)[number] => Boolean(product))
      .slice(0, QUICK_LIMIT - pinned.length);
  }

  return [...pinned, ...best].map(({ stockLevels, ...product }) => ({
    ...product,
    stock: roundQty(stockLevels.reduce((sum, level) => sum + level.quantity, 0)),
  }));
}
