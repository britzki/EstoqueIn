import { randomUUID } from 'node:crypto';
import type { MovementType } from '@prisma/client';
import { prisma, type Tx } from '../../lib/prisma.js';
import { AppError, badRequest, notFound, unprocessable } from '../../lib/errors.js';
import { isWholeNumber, roundQty } from '../../lib/quantity.js';
import { evaluateStockAlert, publishAlertChanges } from '../alerts/alerts.service.js';
import type { AdjustmentInput, EntryInput, ExitInput, FractionInput, TransferInput } from './stock.schemas.js';

interface MovementInput {
  type: MovementType;
  productId: string;
  warehouseId: string;
  /** Variação com sinal: positivo entra, negativo sai. */
  delta: number;
  userId: string;
  unitCostCents?: number | null;
  supplierId?: string | null;
  documentRef?: string | null;
  reason?: string | null;
  transferId?: string | null;
  inventoryId?: string | null;
  nfeImportId?: string | null;
  saleId?: string | null;
  /** Data da movimentação (usado pelo seed para gerar histórico retroativo). */
  occurredAt?: Date;
  /** Venda com a opção "permitir vender sem estoque": o saldo pode ficar negativo. */
  allowNegative?: boolean;
}

/**
 * Aplica uma movimentação dentro de uma transação já aberta:
 * 1. calcula o novo saldo (arredondado a 3 casas) e recusa saldo negativo;
 * 2. grava o saldo só se ele não mudou desde a leitura (comparar-e-gravar);
 * 3. grava o registro imutável no histórico com o saldo resultante;
 * 4. reavalia o alerta de estoque mínimo.
 */
export async function applyMovement(tx: Tx, input: MovementInput) {
  const { productId, warehouseId } = input;
  const delta = roundQty(input.delta);
  if (!Number.isFinite(delta) || delta === 0) throw badRequest('Quantidade deve ser diferente de zero');

  const product = await tx.product.findUnique({ where: { id: productId }, select: { name: true, fractional: true } });
  if (!product) throw notFound('Produto');
  if (!product.fractional && !isWholeNumber(delta)) {
    throw unprocessable(
      `${product.name} é controlado em unidades inteiras e não aceita quantidade fracionada (${delta})`,
      'FRACTION_NOT_ALLOWED',
    );
  }

  const key = { productId_warehouseId: { productId, warehouseId } };
  const current = await tx.stockLevel.findUnique({ where: key });
  const before = current?.quantity ?? 0;
  // O saldo é calculado aqui, e não com incremento no SQL, para poder arredondar o resultado.
  const after = roundQty(before + delta);

  if (after < 0 && !input.allowNegative) {
    throw unprocessable(`Estoque insuficiente: disponível ${before}, solicitado ${-delta}`, 'INSUFFICIENT_STOCK', {
      available: before,
      requested: -delta,
    });
  }

  if (!current) {
    // Se outra operação criar o saldo ao mesmo tempo, a restrição de unicidade recusa esta.
    await tx.stockLevel.create({ data: { productId, warehouseId, quantity: after } });
  } else {
    // Comparar-e-gravar: só atualiza se o saldo ainda for o que foi lido. Duas saídas
    // simultâneas nunca "gastam" o mesmo saldo nem o deixam negativo.
    const { count } = await tx.stockLevel.updateMany({
      where: { id: current.id, quantity: before },
      data: { quantity: after },
    });
    if (count === 0) {
      throw new AppError(409, 'O saldo deste produto mudou durante a operação. Tente novamente.', 'CONCURRENT_UPDATE');
    }
  }

  const movement = await tx.stockMovement.create({
    data: {
      type: input.type,
      productId,
      warehouseId,
      quantity: delta,
      balanceAfter: after,
      unitCostCents: input.unitCostCents ?? null,
      supplierId: input.supplierId ?? null,
      documentRef: input.documentRef ?? null,
      reason: input.reason ?? null,
      transferId: input.transferId ?? null,
      inventoryId: input.inventoryId ?? null,
      nfeImportId: input.nfeImportId ?? null,
      saleId: input.saleId ?? null,
      userId: input.userId,
      createdAt: input.occurredAt,
    },
  });

  const alert = await evaluateStockAlert(tx, productId, warehouseId, input.occurredAt);

  return { movement, balance: after, alert };
}

async function ensureActiveProduct(tx: Tx, productId: string) {
  const product = await tx.product.findUnique({ where: { id: productId } });
  if (!product) throw notFound('Produto');
  if (!product.active) throw unprocessable('Produto inativo não pode ser movimentado');
  return product;
}

async function ensureActiveWarehouse(tx: Tx, warehouseId: string) {
  const warehouse = await tx.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) throw notFound('Estoque');
  if (!warehouse.active) throw unprocessable(`Estoque "${warehouse.name}" está inativo`);
  return warehouse;
}

/** Custo médio ponderado considerando o saldo somado de todos os estoques. */
async function weightedAverageCost(tx: Tx, productId: string, currentCost: number, quantity: number, unitCost: number) {
  const { _sum } = await tx.stockLevel.aggregate({ where: { productId }, _sum: { quantity: true } });
  const onHand = _sum.quantity ?? 0;
  if (onHand <= 0) return unitCost;
  return Math.round((onHand * currentCost + quantity * unitCost) / (onHand + quantity));
}

interface Options {
  occurredAt?: Date;
}

interface EntryOptions extends Options {
  nfeImportId?: string;
}

/**
 * Entrada dentro de uma transação já aberta (usada também pela importação de NF-e,
 * que registra vários itens de uma vez).
 */
export async function applyEntry(tx: Tx, input: EntryInput, userId: string, options: EntryOptions = {}) {
  const product = await ensureActiveProduct(tx, input.productId);
  await ensureActiveWarehouse(tx, input.warehouseId);
  if (input.supplierId && !(await tx.supplier.findUnique({ where: { id: input.supplierId } }))) {
    throw notFound('Fornecedor');
  }

  if (input.unitCostCents !== undefined && input.unitCostCents !== null) {
    const costCents = await weightedAverageCost(tx, product.id, product.costCents, input.quantity, input.unitCostCents);
    await tx.product.update({ where: { id: product.id }, data: { costCents } });
  }

  return applyMovement(tx, {
    type: 'ENTRY',
    productId: input.productId,
    warehouseId: input.warehouseId,
    delta: input.quantity,
    unitCostCents: input.unitCostCents,
    supplierId: input.supplierId,
    documentRef: input.documentRef,
    reason: input.reason,
    userId,
    nfeImportId: options.nfeImportId,
    occurredAt: options.occurredAt,
  });
}

/** Produto chegou → entrada registrada → saldo atualizado → custo médio recalculado → alerta reavaliado. */
export async function registerEntry(input: EntryInput, userId: string, options: Options = {}) {
  const result = await prisma.$transaction((tx) => applyEntry(tx, input, userId, options));
  publishAlertChanges([result.alert]);
  return result;
}

export async function registerExit(input: ExitInput, userId: string, options: Options = {}) {
  const result = await prisma.$transaction(async (tx) => {
    const product = await ensureActiveProduct(tx, input.productId);
    await ensureActiveWarehouse(tx, input.warehouseId);

    return applyMovement(tx, {
      type: 'EXIT',
      productId: input.productId,
      warehouseId: input.warehouseId,
      delta: -input.quantity,
      unitCostCents: product.costCents,
      documentRef: input.documentRef,
      reason: input.reason,
      userId,
      occurredAt: options.occurredAt,
    });
  });

  publishAlertChanges([result.alert]);
  return result;
}

/** Transferência = saída no estoque de origem + entrada no destino, na mesma transação. */
export async function transferStock(input: TransferInput, userId: string, options: Options = {}) {
  if (input.fromWarehouseId === input.toWarehouseId) {
    throw badRequest('Origem e destino da transferência devem ser diferentes');
  }

  const result = await prisma.$transaction(async (tx) => {
    const product = await ensureActiveProduct(tx, input.productId);
    const from = await ensureActiveWarehouse(tx, input.fromWarehouseId);
    const to = await ensureActiveWarehouse(tx, input.toWarehouseId);
    const transferId = randomUUID();

    const common = {
      productId: input.productId,
      userId,
      transferId,
      unitCostCents: product.costCents,
      occurredAt: options.occurredAt,
    };

    const out = await applyMovement(tx, {
      ...common,
      type: 'TRANSFER_OUT',
      warehouseId: from.id,
      delta: -input.quantity,
      reason: input.reason ?? `Transferência para ${to.name}`,
    });
    const inbound = await applyMovement(tx, {
      ...common,
      type: 'TRANSFER_IN',
      warehouseId: to.id,
      delta: input.quantity,
      reason: input.reason ?? `Transferência de ${from.name}`,
    });

    return { transferId, from: out, to: inbound };
  });

  publishAlertChanges([result.from.alert, result.to.alert]);
  return result;
}

/** Ajuste manual: informa o saldo correto e o sistema calcula a diferença. */
export async function adjustStock(input: AdjustmentInput, userId: string) {
  const result = await prisma.$transaction(async (tx) => {
    const product = await ensureActiveProduct(tx, input.productId);
    await ensureActiveWarehouse(tx, input.warehouseId);

    const level = await tx.stockLevel.findUnique({
      where: { productId_warehouseId: { productId: input.productId, warehouseId: input.warehouseId } },
    });
    const delta = roundQty(input.newQuantity - (level?.quantity ?? 0));
    if (delta === 0) throw new AppError(422, 'O saldo informado é igual ao saldo atual', 'NOTHING_TO_ADJUST');

    return applyMovement(tx, {
      type: 'ADJUSTMENT',
      productId: input.productId,
      warehouseId: input.warehouseId,
      delta,
      unitCostCents: product.costCents,
      reason: input.reason,
      userId,
    });
  });

  publishAlertChanges([result.alert]);
  return result;
}

/**
 * Fracionamento: abre unidades de um produto fechado (ex.: saco de 15 kg) e transforma em
 * granel (ex.: +15 kg de "ração a granel"). Sai do pacote e entra no granel na mesma transação,
 * levando o custo junto: se o saco custa R$ 150, o granel entra a R$ 10 por kg.
 */
export async function fractionate(input: FractionInput, userId: string) {
  const result = await prisma.$transaction(async (tx) => {
    const bulk = await ensureActiveProduct(tx, input.bulkProductId);
    if (!bulk.sourceProductId || !bulk.sourceYield) {
      throw unprocessable(`${bulk.name} não está configurado como granel de nenhum produto`, 'NOT_A_BULK_PRODUCT');
    }
    const pack = await ensureActiveProduct(tx, bulk.sourceProductId);
    await ensureActiveWarehouse(tx, input.warehouseId);

    const yieldPerPack = input.yieldPerPack ?? bulk.sourceYield;
    const bulkQuantity = roundQty(input.packs * yieldPerPack);
    const bulkUnitCost = Math.round(pack.costCents / yieldPerPack);
    const groupId = randomUUID();

    const out = await applyMovement(tx, {
      type: 'FRACTION_OUT',
      productId: pack.id,
      warehouseId: input.warehouseId,
      delta: -input.packs,
      unitCostCents: pack.costCents,
      transferId: groupId,
      reason: input.reason ?? `Aberto para granel: ${bulk.name}`,
      userId,
    });

    const costCents = await weightedAverageCost(tx, bulk.id, bulk.costCents, bulkQuantity, bulkUnitCost);
    await tx.product.update({ where: { id: bulk.id }, data: { costCents } });

    const inbound = await applyMovement(tx, {
      type: 'FRACTION_IN',
      productId: bulk.id,
      warehouseId: input.warehouseId,
      delta: bulkQuantity,
      unitCostCents: bulkUnitCost,
      transferId: groupId,
      reason: input.reason ?? `Granel de ${input.packs} × ${pack.name}`,
      userId,
    });

    return {
      groupId,
      pack: { id: pack.id, name: pack.name, unit: pack.unit },
      bulk: { id: bulk.id, name: bulk.name, unit: bulk.unit },
      bulkQuantity,
      from: out,
      to: inbound,
    };
  });

  publishAlertChanges([result.from.alert, result.to.alert]);
  return result;
}
