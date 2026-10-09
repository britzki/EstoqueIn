import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { api, createScenario, resetDatabase } from './helpers.js';

let s: Awaited<ReturnType<typeof createScenario>>;

// Café R$ 20,00 (custo R$ 12,00) com 10 unidades na loja e caixa aberto.
beforeEach(async () => {
  await resetDatabase();
  s = await createScenario();
  await prisma.product.update({ where: { id: s.product.id }, data: { priceCents: 2000, costCents: 1200 } });
  await prisma.stockLevel.create({ data: { productId: s.product.id, warehouseId: s.store.id, quantity: 10 } });
  await prisma.cashSession.create({
    data: { number: 1, warehouseId: s.store.id, openedById: s.operator.user.id, openingCents: 10000 },
  });
});

/** Procura qualquer custo (unitCostCents/costCents com número) no JSON inteiro. */
const leaksCost = (value: unknown): boolean => JSON.stringify(value).match(/"(unitCostCents|costCents)":\d/) !== null;

describe('Custo não chega a quem não vê números do negócio', () => {
  it('histórico e resultado das movimentações vêm sem custo para o operador', async () => {
    const exit = await api()
      .post('/api/stock/exits')
      .set(s.operator.auth)
      .send({ productId: s.product.id, warehouseId: s.store.id, quantity: 1, reason: 'Avaria' })
      .expect(201);
    expect(leaksCost(exit.body)).toBe(false);

    const list = await api().get('/api/stock/movements').set(s.operator.auth).expect(200);
    expect(list.body.data.length).toBeGreaterThan(0);
    expect(leaksCost(list.body)).toBe(false);
    expect(leaksCost((await api().get('/api/dashboard').set(s.operator.auth)).body.recentMovements)).toBe(false);

    // O administrador continua vendo.
    const adminList = await api().get('/api/stock/movements').set(s.admin.auth).expect(200);
    expect(adminList.body.data[0].unitCostCents).toBe(1200);
  });

  it('venda de kit não traz o custo dos componentes no item', async () => {
    const kit = await prisma.product.create({
      data: {
        sku: 'KIT',
        name: 'Kit café',
        priceCents: 5000,
        isKit: true,
        kitItems: { create: [{ productId: s.product.id, quantity: 2 }] },
      },
    });
    const sale = await api()
      .post('/api/sales')
      .set(s.operator.auth)
      .send({
        warehouseId: s.store.id,
        items: [{ productId: kit.id, quantity: 1 }],
        payments: [{ method: 'PIX', amountCents: 5000 }],
      })
      .expect(201);
    expect(leaksCost(sale.body)).toBe(false);
    expect(leaksCost((await api().get(`/api/sales/${sale.body.id}`).set(s.operator.auth)).body)).toBe(false);
    expect((await api().get(`/api/sales/${sale.body.id}`).set(s.admin.auth)).body.items[0].kitComponents).toContain(
      'unitCostCents',
    );
  });

  it('granel não mostra o custo do pacote de origem ao operador', async () => {
    const bulk = await prisma.product.create({
      data: {
        sku: 'CAF-GRANEL',
        name: 'Café a granel',
        unit: 'KG',
        fractional: true,
        sourceProductId: s.product.id,
        sourceYield: 0.5,
      },
    });
    const detail = await api().get(`/api/products/${bulk.id}`).set(s.operator.auth).expect(200);
    expect(detail.body.sourceProduct).toMatchObject({ id: s.product.id, costCents: null });
  });
});

describe('Planilhas exportadas', () => {
  it('texto que começa com "=" não vira fórmula no Excel', async () => {
    await prisma.product.update({ where: { id: s.product.id }, data: { name: '=HYPERLINK("http://x";"y")' } });
    await api()
      .post('/api/stock/exits')
      .set(s.operator.auth)
      .send({ productId: s.product.id, warehouseId: s.store.id, quantity: 1, reason: 'Avaria' })
      .expect(201);
    const csv = await api().get('/api/stock/movements?format=csv').set(s.admin.auth).expect(200);
    expect(csv.text).toContain(`"'=HYPERLINK(""http://x"";""y"")"`);
    expect(csv.text).toContain(';-1;'); // número negativo continua número
  });
});

describe('Alterações parciais não apagam o que não foi enviado', () => {
  it('desativar o entregador mantém o valor por entrega', async () => {
    const courier = await api()
      .post('/api/couriers')
      .set(s.admin.auth)
      .send({ name: 'Zé', feePerDeliveryCents: 700 })
      .expect(201);
    const updated = await api().patch(`/api/couriers/${courier.body.id}`).set(s.admin.auth).send({ active: false });
    expect(updated.body).toMatchObject({ active: false, feePerDeliveryCents: 700 });
  });

  it('mudar o valor da conta mantém a conta mensal e não registra data alterada à toa', async () => {
    const dueDate = new Date('2026-11-10T12:00:00');
    const bill = await api()
      .post('/api/bills')
      .set(s.admin.auth)
      .send({ description: 'Aluguel', amountCents: 150000, dueDate, monthly: true })
      .expect(201);
    const updated = await api()
      .patch(`/api/bills/${bill.body.id}`)
      .set(s.admin.auth)
      .send({ amountCents: 160000, dueDate })
      .expect(200);
    expect(updated.body.monthly).toBe(true);
    const log = await prisma.auditLog.findFirst({ where: { entity: 'Bill', action: 'UPDATE' } });
    expect(Object.keys(JSON.parse(log!.changes!))).toEqual(['amountCents']);
  });
});

describe('Caixa', () => {
  it('não fecha o mesmo caixa duas vezes', async () => {
    const cash = await prisma.cashSession.findFirstOrThrow();
    const close = () =>
      api().post(`/api/cash/${cash.id}/close`).set(s.operator.auth).send({ countedCents: 10000, keptCents: 10000 });
    await close().expect(200);
    await close().expect(409);
  });
});

describe('NF-e', () => {
  it('recusa XML com DOCTYPE (entidades que se expandem)', async () => {
    const xml = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><nfeProc>&a;</nfeProc>';
    const res = await api()
      .post('/api/nfe/preview')
      .set(s.admin.auth)
      .attach('file', Buffer.from(xml), 'nota.xml')
      .expect(400);
    expect(res.body.error.message).toContain('DOCTYPE');
  });
});
