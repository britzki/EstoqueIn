import { prisma } from '../../lib/prisma.js';
import { conflict, notFound, unprocessable } from '../../lib/errors.js';
import { isWholeNumber, roundQty } from '../../lib/quantity.js';
import { adjustTo } from '../stock/stock.service.js';
import { publishAlertChanges, type AlertChange } from '../alerts/alerts.service.js';

interface CreateInventoryInput {
  warehouseId: string;
  category?: string | null;
  notes?: string | null;
}

/**
 * Abre um inventário: tira uma "foto" do saldo esperado de cada produto ativo no estoque.
 * Só é permitido um inventário aberto por estoque ao mesmo tempo.
 */
export async function openInventory(input: CreateInventoryInput, userId: string) {
  return prisma.$transaction(async (tx) => {
    const warehouse = await tx.warehouse.findUnique({ where: { id: input.warehouseId } });
    if (!warehouse?.active) throw notFound('Estoque');

    const alreadyOpen = await tx.inventory.findFirst({ where: { warehouseId: warehouse.id, status: 'OPEN' } });
    if (alreadyOpen) throw conflict(`Já existe um inventário aberto para ${warehouse.name}`);

    const products = await tx.product.findMany({
      where: {
        isKit: false,
        active: true,
        category: input.category ?? undefined,
      },
      select: { id: true, stockLevels: { where: { warehouseId: warehouse.id }, select: { quantity: true } } },
    });
    if (products.length === 0) throw unprocessable('Nenhum produto ativo para inventariar');

    return tx.inventory.create({
      data: {
        warehouseId: warehouse.id,
        notes: input.notes ?? (input.category ? `Categoria: ${input.category}` : null),
        createdById: userId,
        items: {
          create: products.map((product) => ({
            productId: product.id,
            expectedQuantity: product.stockLevels[0]?.quantity ?? 0,
          })),
        },
      },
    });
  });
}

/** Produtos controlados em unidades inteiras não aceitam contagem fracionada. */
function assertCountable(product: { name: string; fractional: boolean }, quantity: number) {
  if (!product.fractional && !isWholeNumber(quantity)) {
    throw unprocessable(`${product.name} é controlado em unidades inteiras`, 'FRACTION_NOT_ALLOWED');
  }
}

async function getOpenInventory(inventoryId: string) {
  const inventory = await prisma.inventory.findUnique({ where: { id: inventoryId } });
  if (!inventory) throw notFound('Inventário');
  if (inventory.status !== 'OPEN') throw conflict('Este inventário já foi encerrado');
  return inventory;
}

export async function setCount(inventoryId: string, itemId: string, countedQuantity: number | null) {
  await getOpenInventory(inventoryId);
  const item = await prisma.inventoryItem.findFirst({
    where: { id: itemId, inventoryId },
    include: { product: { select: { name: true, fractional: true } } },
  });
  if (!item) throw notFound('Item do inventário');
  if (countedQuantity !== null) assertCountable(item.product, countedQuantity);

  return prisma.inventoryItem.update({
    where: { id: item.id },
    data: { countedQuantity, countedAt: countedQuantity === null ? null : new Date() },
  });
}

/** Contagem com leitor: cada bipe soma a quantidade informada (ou define, no modo "set"). */
export async function countByBarcode(inventoryId: string, barcode: string, quantity: number, mode: 'add' | 'set') {
  await getOpenInventory(inventoryId);
  const product = await prisma.product.findUnique({
    where: { barcode },
    select: { id: true, name: true, fractional: true },
  });
  if (!product) throw notFound('Produto com este código de barras');

  // No modo "somar", só grava se a contagem não mudou desde a leitura (dois bipes ao mesmo tempo
  // não podem virar um só); se mudou, lê de novo e soma outra vez.
  for (let attempt = 0; attempt < 5; attempt++) {
    const item = await prisma.inventoryItem.findUnique({
      where: { inventoryId_productId: { inventoryId, productId: product.id } },
    });
    if (!item) throw unprocessable(`${product.name} não faz parte deste inventário`);

    const countedQuantity = roundQty(mode === 'add' ? (item.countedQuantity ?? 0) + quantity : quantity);
    assertCountable(product, countedQuantity);
    const { count } = await prisma.inventoryItem.updateMany({
      where: { id: item.id, countedQuantity: item.countedQuantity },
      data: { countedQuantity, countedAt: new Date() },
    });
    if (count === 1) {
      return prisma.inventoryItem.findUniqueOrThrow({
        where: { id: item.id },
        include: { product: { select: { id: true, sku: true, name: true, unit: true } } },
      });
    }
  }
  throw conflict('A contagem deste produto mudou ao mesmo tempo. Bipe de novo.');
}

/**
 * Conclui o inventário: para cada item contado, ajusta o saldo para a quantidade contada.
 * A diferença é calculada sobre o saldo *atual* (não sobre a foto), para não desfazer
 * movimentações que aconteceram durante a contagem. Itens não contados são ignorados.
 */
export async function completeInventory(inventoryId: string, userId: string) {
  await getOpenInventory(inventoryId);

  const result = await prisma.$transaction(async (tx) => {
    // Marca como concluído primeiro e só se ainda estiver aberto: dois cliques (ou dois computadores)
    // não aplicam os ajustes duas vezes.
    const { count } = await tx.inventory.updateMany({
      where: { id: inventoryId, status: 'OPEN' },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    if (count === 0) throw conflict('Este inventário já foi concluído ou cancelado');

    const items = await tx.inventoryItem.findMany({ where: { inventoryId }, include: { inventory: true } });
    const alertChanges: AlertChange[] = [];
    let adjusted = 0;
    let netDifference = 0;

    for (const item of items) {
      if (item.countedQuantity === null) continue;

      const adjustment = await adjustTo(tx, {
        productId: item.productId,
        warehouseId: item.inventory.warehouseId,
        target: item.countedQuantity,
        inventoryId,
        reason: 'Ajuste de inventário',
        userId,
      });
      const difference = adjustment?.movement.quantity ?? 0;
      if (adjustment) {
        alertChanges.push(adjustment.alert);
        adjusted++;
        netDifference = roundQty(netDifference + difference);
      }
      await tx.inventoryItem.update({ where: { id: item.id }, data: { difference } });
    }

    const inventory = await tx.inventory.findUniqueOrThrow({ where: { id: inventoryId } });

    const uncounted = items.filter((item) => item.countedQuantity === null).length;
    return { inventory, summary: { totalItems: items.length, adjusted, uncounted, netDifference }, alertChanges };
  });

  publishAlertChanges(result.alertChanges);
  return { inventory: result.inventory, summary: result.summary };
}

export async function cancelInventory(inventoryId: string) {
  await getOpenInventory(inventoryId);
  const { count } = await prisma.inventory.updateMany({
    where: { id: inventoryId, status: 'OPEN' },
    data: { status: 'CANCELLED', completedAt: new Date() },
  });
  if (count === 0) throw conflict('Este inventário já foi concluído ou cancelado');
  return prisma.inventory.findUniqueOrThrow({ where: { id: inventoryId } });
}
