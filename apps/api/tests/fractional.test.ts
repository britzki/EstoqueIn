import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { roundQty } from '../src/lib/quantity.js';
import { api, createScenario, resetDatabase, stockOf } from './helpers.js';

let s: Awaited<ReturnType<typeof createScenario>>;
let sack: { id: string };
let bulk: { id: string };

// Cenário de pet shop: saco fechado de 15 kg e a mesma ração vendida a granel.
beforeEach(async () => {
  await resetDatabase();
  s = await createScenario();
  sack = await prisma.product.create({
    data: { sku: 'RAC-15KG', name: 'Ração Premium 15kg', unit: 'SC', costCents: 15000, minStock: 2 },
  });
  bulk = await prisma.product.create({
    data: {
      sku: 'RAC-GRANEL',
      name: 'Ração Premium a granel',
      unit: 'KG',
      fractional: true,
      minStock: 5,
      sourceProductId: sack.id,
      sourceYield: 15,
    },
  });
});

const post = (path: string, body: object, auth = s.operator.auth) =>
  api().post(`/api/stock/${path}`).set(auth).send(body);

const entry = (productId: string, quantity: number) =>
  post('entries', { productId, warehouseId: s.store.id, quantity });
const exit = (productId: string, quantity: number) => post('exits', { productId, warehouseId: s.store.id, quantity });

describe('Quantidades fracionadas', () => {
  it('produto fracionado aceita 3 casas decimais e mantém o saldo exato', async () => {
    await entry(bulk.id, 1).expect(201);
    // 0,1 + 0,2 em ponto flutuante daria 0,30000000000000004
    await exit(bulk.id, 0.1).expect(201);
    const res = await exit(bulk.id, 0.2);

    expect(res.status).toBe(201);
    expect(res.body.balance).toBe(0.7);
    expect(await stockOf(bulk.id, s.store.id)).toBe(0.7);
  });

  it('vender exatamente o saldo zera o estoque, sem resíduo', async () => {
    await entry(bulk.id, 0.3).expect(201);
    await exit(bulk.id, 0.1).expect(201);
    await exit(bulk.id, 0.1).expect(201);
    const res = await exit(bulk.id, 0.1);

    expect(res.body.balance).toBe(0);
    expect(res.body.alert.alert.type).toBe('OUT_OF_STOCK');
  });

  it('recusa mais de 3 casas decimais', async () => {
    const res = await entry(bulk.id, 0.3505);
    expect(res.status).toBe(400);
    expect(res.body.error.details.quantity[0]).toMatch(/3 casas/);
  });

  it('produto em unidades inteiras não aceita fração', async () => {
    const res = await entry(sack.id, 1.5);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('FRACTION_NOT_ALLOWED');
    expect(await prisma.stockMovement.count()).toBe(0);
  });

  it('não deixa saída fracionada passar do saldo', async () => {
    await entry(bulk.id, 2).expect(201);
    const res = await exit(bulk.id, 2.001);
    expect(res.status).toBe(422);
    expect(res.body.error.details).toEqual({ available: 2, requested: 2.001 });
  });

  it('abre alerta quando o granel chega ao mínimo em kg', async () => {
    await entry(bulk.id, 6).expect(201);
    const res = await exit(bulk.id, 1.25);
    expect(res.body.balance).toBe(4.75);
    expect(res.body.alert.alert).toMatchObject({ type: 'LOW_STOCK', quantity: 4.75, threshold: 5 });
  });

  it('produto novo em KG já nasce fracionado; em UN, não', async () => {
    const kg = await api()
      .post('/api/products')
      .set(s.admin.auth)
      .send({ sku: 'AREIA-KG', name: 'Areia granel', unit: 'KG' });
    const un = await api()
      .post('/api/products')
      .set(s.admin.auth)
      .send({ sku: 'COLEIRA', name: 'Coleira', unit: 'UN' });
    expect(kg.body.fractional).toBe(true);
    expect(un.body.fractional).toBe(false);
  });

  it('não deixa desmarcar "fracionado" se o saldo tem casas decimais', async () => {
    await entry(bulk.id, 2.5).expect(201);
    const res = await api().patch(`/api/products/${bulk.id}`).set(s.admin.auth).send({ fractional: false });
    expect(res.status).toBe(422);
  });

  it('inventário aceita contagem em kg e ajusta a diferença', async () => {
    await entry(bulk.id, 10).expect(201);
    const { body: inventory } = await api()
      .post('/api/inventories')
      .set(s.admin.auth)
      .send({ warehouseId: s.store.id });
    const item = await prisma.inventoryItem.findFirstOrThrow({
      where: { inventoryId: inventory.id, productId: bulk.id },
    });
    const sackItem = await prisma.inventoryItem.findFirstOrThrow({
      where: { inventoryId: inventory.id, productId: sack.id },
    });

    await api()
      .patch(`/api/inventories/${inventory.id}/items/${item.id}`)
      .set(s.operator.auth)
      .send({ countedQuantity: 9.64 })
      .expect(200);
    // Saco fechado não pode ser contado com fração.
    await api()
      .patch(`/api/inventories/${inventory.id}/items/${sackItem.id}`)
      .set(s.operator.auth)
      .send({ countedQuantity: 1.5 })
      .expect(422);

    const res = await api().post(`/api/inventories/${inventory.id}/complete`).set(s.admin.auth);
    expect(res.body.summary.netDifference).toBe(-0.36);
    expect(await stockOf(bulk.id, s.store.id)).toBe(9.64);
  });
});

describe('Fracionamento: abrir saco para vender a granel', () => {
  const fraction = (body: object, auth = s.operator.auth) =>
    post('fractions', { bulkProductId: bulk.id, warehouseId: s.store.id, ...body }, auth);

  it('tira o saco do estoque e coloca os quilos no granel, numa operação só', async () => {
    await entry(sack.id, 4).expect(201);
    const res = await fraction({ packs: 2 });

    expect(res.status).toBe(201);
    expect(res.body.bulkQuantity).toBe(30);
    expect(await stockOf(sack.id, s.store.id)).toBe(2);
    expect(await stockOf(bulk.id, s.store.id)).toBe(30);

    const legs = await prisma.stockMovement.findMany({
      where: { transferId: res.body.groupId },
      orderBy: { quantity: 'asc' },
    });
    expect(legs.map((leg) => [leg.type, leg.quantity])).toEqual([
      ['FRACTION_OUT', -2],
      ['FRACTION_IN', 30],
    ]);
  });

  it('leva o custo junto: saco de R$ 150 vira granel a R$ 10 por kg', async () => {
    await entry(sack.id, 1).expect(201);
    await fraction({ packs: 1 }).expect(201);

    const product = await prisma.product.findUniqueOrThrow({ where: { id: bulk.id } });
    expect(product.costCents).toBe(1000);
  });

  it('aceita o rendimento real do lote e recalcula o custo médio do granel', async () => {
    await entry(sack.id, 2).expect(201);
    await fraction({ packs: 1 }).expect(201); // 15 kg a R$ 10,00
    const res = await fraction({ packs: 1, yieldPerPack: 14.5 }); // 14,5 kg a R$ 10,34

    expect(res.body.bulkQuantity).toBe(14.5);
    expect(await stockOf(bulk.id, s.store.id)).toBe(29.5);
    const product = await prisma.product.findUniqueOrThrow({ where: { id: bulk.id } });
    expect(product.costCents).toBe(Math.round((15 * 1000 + 14.5 * 1034) / 29.5));
  });

  it('abrir o último saco dispara o alerta do saco e resolve o do granel', async () => {
    await entry(sack.id, 3).expect(201);
    await entry(bulk.id, 2).expect(201); // granel abaixo do mínimo (5 kg)
    expect(await prisma.stockAlert.count({ where: { productId: bulk.id, status: 'OPEN' } })).toBe(1);

    const res = await fraction({ packs: 1 });
    expect(res.body.from.alert.kind).toBe('opened'); // sacos: 2 = mínimo
    expect(res.body.to.alert.kind).toBe('resolved'); // granel: 17 kg
  });

  it('sem saco em estoque, não cria granel do nada', async () => {
    const res = await fraction({ packs: 1 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(await stockOf(bulk.id, s.store.id)).toBe(0);
    expect(await prisma.stockMovement.count()).toBe(0);
  });

  it('só funciona para produto configurado como granel', async () => {
    const res = await post('fractions', { bulkProductId: sack.id, warehouseId: s.store.id, packs: 1 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NOT_A_BULK_PRODUCT');
  });

  it('valida o vínculo: exige rendimento e não aceita granel de granel', async () => {
    const semRendimento = await api()
      .post('/api/products')
      .set(s.admin.auth)
      .send({ sku: 'X-GR', name: 'Outro granel', unit: 'KG', sourceProductId: sack.id });
    expect(semRendimento.status).toBe(400);

    const granelDeGranel = await api()
      .post('/api/products')
      .set(s.admin.auth)
      .send({ sku: 'Y-GR', name: 'Granel de granel', unit: 'KG', sourceProductId: bulk.id, sourceYield: 1 });
    expect(granelDeGranel.status).toBe(422);
  });

  it('o detalhe do saco mostra o granel ligado a ele, e vice-versa', async () => {
    const sackDetail = await api().get(`/api/products/${sack.id}`).set(s.admin.auth);
    expect(sackDetail.body.bulkProducts).toMatchObject([{ id: bulk.id, sourceYield: 15 }]);

    const bulkDetail = await api().get(`/api/products/${bulk.id}`).set(s.admin.auth);
    expect(bulkDetail.body.sourceProduct).toMatchObject({ id: sack.id, sku: 'RAC-15KG' });
  });
});

describe('Arredondamento', () => {
  it('roundQty elimina o resíduo do ponto flutuante', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(roundQty(0.1 + 0.2)).toBe(0.3);
    expect(roundQty(1.0005)).toBe(1.001);
    expect(roundQty(29.999999999999996)).toBe(30);
  });
});
