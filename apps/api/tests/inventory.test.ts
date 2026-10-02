import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { api, createScenario, resetDatabase, stockOf } from './helpers.js';

let s: Awaited<ReturnType<typeof createScenario>>;

beforeEach(async () => {
  await resetDatabase();
  s = await createScenario();
  await api()
    .post('/api/stock/entries')
    .set(s.operator.auth)
    .send({ productId: s.product.id, warehouseId: s.depot.id, quantity: 30 });
});

const openInventory = () => api().post('/api/inventories').set(s.admin.auth).send({ warehouseId: s.depot.id });

describe('Inventário', () => {
  it('abre o inventário com a foto do saldo e impede dois abertos no mesmo estoque', async () => {
    const res = await openInventory();
    expect(res.status).toBe(201);

    const item = await prisma.inventoryItem.findFirstOrThrow({ where: { inventoryId: res.body.id } });
    expect(item.expectedQuantity).toBe(30);

    const again = await openInventory();
    expect(again.status).toBe(409);
  });

  it('conta pelo leitor de código de barras somando a cada bipe', async () => {
    const { body: inventory } = await openInventory();
    const scan = () =>
      api().post(`/api/inventories/${inventory.id}/scan`).set(s.operator.auth).send({ barcode: '7891234567895' });

    await scan();
    await scan();
    const res = await scan();
    expect(res.status).toBe(200);
    expect(res.body.countedQuantity).toBe(3);
  });

  it('ao concluir, ajusta o saldo para o contado e reavalia o alerta', async () => {
    const { body: inventory } = await openInventory();
    const item = await prisma.inventoryItem.findFirstOrThrow({ where: { inventoryId: inventory.id } });

    await api()
      .patch(`/api/inventories/${inventory.id}/items/${item.id}`)
      .set(s.operator.auth)
      .send({ countedQuantity: 8 })
      .expect(200);

    // Operador conta, mas só gerente/admin concluem.
    await api().post(`/api/inventories/${inventory.id}/complete`).set(s.operator.auth).expect(403);

    const res = await api().post(`/api/inventories/${inventory.id}/complete`).set(s.admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ adjusted: 1, uncounted: 0, netDifference: -22 });
    expect(await stockOf(s.product.id, s.depot.id)).toBe(8);

    const adjustment = await prisma.stockMovement.findFirstOrThrow({ where: { type: 'ADJUSTMENT' } });
    expect(adjustment.inventoryId).toBe(inventory.id);
    expect(await prisma.stockAlert.count({ where: { status: 'OPEN' } })).toBe(1);
  });

  it('não permite contar em inventário encerrado', async () => {
    const { body: inventory } = await openInventory();
    await api().post(`/api/inventories/${inventory.id}/cancel`).set(s.admin.auth).expect(200);

    const res = await api()
      .post(`/api/inventories/${inventory.id}/scan`)
      .set(s.operator.auth)
      .send({ barcode: '7891234567895' });
    expect(res.status).toBe(409);
  });
});
