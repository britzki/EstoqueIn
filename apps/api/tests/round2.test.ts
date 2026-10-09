import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { api, createScenario, resetDatabase } from './helpers.js';

let s: Awaited<ReturnType<typeof createScenario>>;

// Café R$ 10,00 (custo R$ 6,00) com 30 unidades na loja e caixa aberto.
beforeEach(async () => {
  await resetDatabase();
  s = await createScenario();
  await prisma.product.update({ where: { id: s.product.id }, data: { priceCents: 1000, costCents: 600 } });
  await prisma.stockLevel.create({ data: { productId: s.product.id, warehouseId: s.store.id, quantity: 30 } });
  await prisma.cashSession.create({
    data: { number: 1, warehouseId: s.store.id, openedById: s.operator.user.id, openingCents: 10000 },
  });
});

const sell = (body: object) =>
  api()
    .post('/api/sales')
    .set(s.operator.auth)
    .send({ warehouseId: s.store.id, ...body })
    .expect(201);

const returnItems = (saleId: string, saleItemId: string, quantity: number) =>
  api()
    .post(`/api/sales/${saleId}/returns`)
    .set(s.admin.auth)
    .send({ items: [{ saleItemId, quantity }], reason: 'Troca', refundMethod: 'PIX' });

describe('Devoluções', () => {
  it('somando as devoluções parciais, o cliente recebe exatamente o que pagou pelo item', async () => {
    // 3 cafés com R$ 0,50 de desconto: R$ 29,50 pagos (fator 0,98333...).
    const sale = await sell({
      items: [{ productId: s.product.id, quantity: 3 }],
      discountCents: 50,
      payments: [{ method: 'PIX', amountCents: 2950 }],
    });
    const item = sale.body.items[0].id;
    const refunds = [];
    for (let i = 0; i < 3; i++) refunds.push((await returnItems(sale.body.id, item, 1).expect(201)).body.refundCents);
    expect(refunds.reduce((sum, value) => sum + value, 0)).toBe(2950);
  });

  it('kit é devolvido por unidade inteira', async () => {
    const kit = await prisma.product.create({
      data: {
        sku: 'KIT',
        name: 'Kit café',
        priceCents: 2500,
        isKit: true,
        kitItems: { create: [{ productId: s.product.id, quantity: 2 }] },
      },
    });
    const sale = await sell({
      items: [{ productId: kit.id, quantity: 1 }],
      payments: [{ method: 'PIX', amountCents: 2500 }],
    });
    const res = await returnItems(sale.body.id, sale.body.items[0].id, 0.5).expect(422);
    expect(res.body.error.message).toContain('Kit é devolvido por unidade');
  });

  it('o mesmo item duas vezes na mesma devolução é recusado', async () => {
    const sale = await sell({
      items: [{ productId: s.product.id, quantity: 2 }],
      payments: [{ method: 'PIX', amountCents: 2000 }],
    });
    const item = sale.body.items[0].id;
    await api()
      .post(`/api/sales/${sale.body.id}/returns`)
      .set(s.admin.auth)
      .send({
        items: [
          { saleItemId: item, quantity: 2 },
          { saleItemId: item, quantity: 2 },
        ],
        reason: 'Troca',
        refundMethod: 'PIX',
      })
      .expect(400);
  });
});

describe('Valores fora do limite do banco', () => {
  it('valor gigante vira erro de validação, não erro interno', async () => {
    const res = await api()
      .post('/api/sales')
      .set(s.operator.auth)
      .send({
        warehouseId: s.store.id,
        items: [{ productId: s.product.id, quantity: 1 }],
        payments: [{ method: 'CASH', amountCents: 30_000_000_000 }],
      })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('Inventário', () => {
  it('não conclui duas vezes e leituras de "somar" não se perdem', async () => {
    const inventory = await api()
      .post('/api/inventories')
      .set(s.admin.auth)
      .send({ warehouseId: s.store.id })
      .expect(201);
    const scan = () =>
      api()
        .post(`/api/inventories/${inventory.body.id}/scan`)
        .set(s.admin.auth)
        .send({ barcode: '7891234567895', quantity: 1, mode: 'add' });
    await Promise.all([scan(), scan(), scan()]);
    const item = await prisma.inventoryItem.findFirstOrThrow({ where: { inventoryId: inventory.body.id } });
    expect(item.countedQuantity).toBe(3);

    const complete = () => api().post(`/api/inventories/${inventory.body.id}/complete`).set(s.admin.auth);
    await complete().expect(200);
    await complete().expect(409);
    expect(await prisma.stockMovement.count({ where: { inventoryId: inventory.body.id } })).toBe(1);
  });
});

describe('Entregas', () => {
  it('a mesma mudança de etapa não é aplicada duas vezes', async () => {
    const customer = await prisma.customer.create({ data: { name: 'Maria' } });
    const sale = await sell({
      items: [{ productId: s.product.id, quantity: 5 }],
      payments: [{ method: 'PIX', amountCents: 5000 }],
      customerId: customer.id,
      delivery: { address: { street: 'Rua A', number: '1', district: 'Centro' } },
    });
    const deliver = () => api().post(`/api/deliveries/${sale.body.delivery.id}/deliver`).set(s.operator.auth);
    const results = await Promise.all([deliver(), deliver()]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});

describe('Caixa para quem não vê números do negócio', () => {
  it('o operador vê só o fiado recebido em dinheiro', async () => {
    const customer = await prisma.customer.create({ data: { name: 'João', openingBalanceCents: 5000 } });
    await api()
      .post(`/api/customers/${customer.id}/payments`)
      .set(s.operator.auth)
      .send({ amountCents: 2000, method: 'PIX', warehouseId: s.store.id })
      .expect(201);
    await api()
      .post(`/api/customers/${customer.id}/payments`)
      .set(s.operator.auth)
      .send({ amountCents: 1000, method: 'CASH', warehouseId: s.store.id })
      .expect(201);
    const current = (await api().get(`/api/cash/current?warehouseId=${s.store.id}`).set(s.operator.auth)).body;
    expect(current.summary.accountReceivedCents).toBe(1000);
    expect(current.summary.accountReceivedByMethod).toMatchObject({ CASH: 1000, PIX: 0 });
    const admin = (await api().get(`/api/cash/current?warehouseId=${s.store.id}`).set(s.admin.auth)).body;
    expect(admin.summary.accountReceivedByMethod).toMatchObject({ CASH: 1000, PIX: 2000 });
  });
});

describe('Configurações e segurança do servidor', () => {
  it('recusa prefixo + código da balança que não cabem na etiqueta', async () => {
    await api().put('/api/settings').set(s.admin.auth).send({ scalePrefix: '20', scaleCodeDigits: 6 }).expect(422);
    await api().put('/api/settings').set(s.admin.auth).send({ scalePrefix: '2', scaleCodeDigits: 6 }).expect(200);
  });

  it('a interface é servida com política de conteúdo (sem https forçado)', async () => {
    const res = await api().get('/api/health');
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('upgrade-insecure-requests');
  });
});
