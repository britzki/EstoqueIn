import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { api, createScenario, resetDatabase, stockOf } from './helpers.js';

let s: Awaited<ReturnType<typeof createScenario>>;
let collar: { id: string };
let bulk: { id: string };

// Coleira R$ 30,00 (custo 12,00), 5 em estoque; ração a granel R$ 20,00/kg (custo 10,00), 10 kg.
beforeEach(async () => {
  await resetDatabase();
  s = await createScenario();
  collar = await prisma.product.create({
    data: { sku: 'COLEIRA', name: 'Coleira M', priceCents: 3000, costCents: 1200, minStock: 2 },
  });
  bulk = await prisma.product.create({
    data: { sku: 'RAC-GR', name: 'Ração a granel', unit: 'KG', fractional: true, priceCents: 2000, costCents: 1000 },
  });
  await prisma.stockLevel.createMany({
    data: [
      { productId: collar.id, warehouseId: s.store.id, quantity: 5 },
      { productId: bulk.id, warehouseId: s.store.id, quantity: 10 },
    ],
  });
});

const openCash = (openingCents = 10000) =>
  api().post('/api/cash/open').set(s.operator.auth).send({ warehouseId: s.store.id, openingCents });

const sell = (body: object) =>
  api()
    .post('/api/sales')
    .set(s.operator.auth)
    .send({ warehouseId: s.store.id, ...body });

describe('Caixa', () => {
  it('com o caixa fechado não vende; a exigência pode ser desligada', async () => {
    const closed = await sell({
      items: [{ productId: collar.id, quantity: 1 }],
      payments: [{ method: 'PIX', amountCents: 3000 }],
    });
    expect(closed.status).toBe(422);
    expect(closed.body.error.code).toBe('CASH_CLOSED');

    await api().put('/api/settings').set(s.admin.auth).send({ requireCashSession: false }).expect(200);
    const res = await sell({
      items: [{ productId: collar.id, quantity: 1 }],
      payments: [{ method: 'PIX', amountCents: 3000 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.cashSessionId).toBeNull();
  });

  it('não abre dois caixas no mesmo estoque', async () => {
    await openCash().expect(201);
    expect((await openCash()).status).toBe(409);
  });

  it('confere o dinheiro esperado: troco inicial, vendas, sangria, suprimento e devolução', async () => {
    const { body: cash } = await openCash(10000);
    expect(cash).toMatchObject({ number: 1, status: 'OPEN', summary: { expectedCashCents: 10000 } });

    // Dinheiro: paga 50,00 numa venda de 30,00 → troco 20,00 → entram 30,00.
    await sell({
      items: [{ productId: collar.id, quantity: 1 }],
      payments: [{ method: 'CASH', amountCents: 5000 }],
    }).expect(201);
    await sell({
      items: [{ productId: collar.id, quantity: 1 }],
      payments: [{ method: 'PIX', amountCents: 3000 }],
    }).expect(201);
    const { body: cancelled } = await sell({
      items: [{ productId: collar.id, quantity: 1 }],
      payments: [{ method: 'CASH', amountCents: 3000 }],
    });
    await api().post(`/api/sales/${cancelled.id}/cancel`).set(s.admin.auth).send({ reason: 'Erro' }).expect(200);

    const movement = (type: string, amountCents: number, reason: string) =>
      api().post(`/api/cash/${cash.id}/movements`).set(s.operator.auth).send({ type, amountCents, reason });
    await movement('WITHDRAWAL', 2500, 'Pagamento do motoboy').expect(201);
    await movement('DEPOSIT', 1000, 'Reforço de troco').expect(201);
    expect((await movement('WITHDRAWAL', 100, '')).status).toBe(400);

    const { body: current } = await api().get(`/api/cash/current?warehouseId=${s.store.id}`).set(s.admin.auth);
    // 100,00 + 30,00 − 25,00 + 10,00 = 115,00
    expect(current.summary).toMatchObject({
      salesCount: 2,
      cancelledCount: 1,
      revenueCents: 6000,
      byMethod: { CASH: 3000, PIX: 3000, DEBIT: 0, CREDIT: 0, OTHER: 0 },
      withdrawalsCents: 2500,
      depositsCents: 1000,
      expectedCashCents: 11500,
      differenceCents: null,
    });

    const closed = await api()
      .post(`/api/cash/${cash.id}/close`)
      .set(s.operator.auth)
      .send({ countedCents: 11300, notes: 'Faltou troco' });
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({ status: 'CLOSED', expectedCents: 11500, countedCents: 11300 });
    expect(closed.body.summary.differenceCents).toBe(-200);

    // Fechado: não aceita mais nada e some do "caixa atual".
    expect((await movement('DEPOSIT', 100, 'Depois de fechar')).status).toBe(409);
    expect((await api().post(`/api/cash/${cash.id}/close`).set(s.operator.auth).send({ countedCents: 0 })).status).toBe(
      409,
    );
    const after = await api().get(`/api/cash/current?warehouseId=${s.store.id}`).set(s.operator.auth);
    expect(after.body).toBeNull();

    const history = await api().get('/api/cash').set(s.viewer.auth);
    expect(history.body.data[0]).toMatchObject({ number: 1, differenceCents: -200 });

    const audit = await prisma.auditLog.findFirst({ where: { entity: 'CashSession' } });
    expect(audit?.summary).toMatch(/Caixa nº 1 fechado: esperado R\$\s?115,00, contado R\$\s?113,00/);
  });

  it('perfil de leitura não mexe no caixa', async () => {
    const res = await api()
      .post('/api/cash/open')
      .set(s.viewer.auth)
      .send({ warehouseId: s.store.id, openingCents: 0 });
    expect(res.status).toBe(403);
  });
});

describe('Troco fixo da gaveta', () => {
  const close = (id: string, body: object) => api().post(`/api/cash/${id}/close`).set(s.operator.auth).send(body);
  const suggestion = () => api().get(`/api/cash/opening-suggestion?warehouseId=${s.store.id}`).set(s.operator.auth);

  it('abre com R$ 250, retira o lucro no fechamento e sugere os mesmos R$ 250 no dia seguinte', async () => {
    await api().put('/api/settings').set(s.admin.auth).send({ cashFloatCents: 25000 }).expect(200);
    expect((await suggestion()).body).toEqual({
      suggestedCents: 25000,
      previousKeptCents: null,
      cashFloatCents: 25000,
    });

    const { body: cash } = await openCash(25000);
    await sell({
      items: [{ productId: collar.id, quantity: 3 }],
      payments: [{ method: 'CASH', amountCents: 9000 }],
    }).expect(201);

    // Gaveta: 250 + 90 = 340. Sem informar quanto fica, fica o troco fixo e sai o resto.
    const closed = await close(cash.id, { countedCents: 34000 });
    expect(closed.body).toMatchObject({ keptCents: 25000 });
    expect(closed.body.summary).toMatchObject({ closingWithdrawalCents: 9000, differenceCents: 0 });
    const audit = await prisma.auditLog.findFirst({ where: { entity: 'CashSession' } });
    expect(audit?.summary).toMatch(/retirado R\$\s?90,00, ficou na gaveta R\$\s?250,00/);

    expect((await suggestion()).body).toMatchObject({ suggestedCents: 25000, previousKeptCents: 25000 });

    // Abrir com valor diferente do que ficou na gaveta fica registrado.
    const { body: next } = await openCash(24000);
    expect(next.summary).toMatchObject({ previousKeptCents: 25000, openingDifferenceCents: -1000 });
  });

  it('com falta de dinheiro, fica na gaveta só o que foi contado; e não deixa ficar mais que o contado', async () => {
    await api().put('/api/settings').set(s.admin.auth).send({ cashFloatCents: 25000 }).expect(200);
    const { body: cash } = await openCash(25000);
    expect((await close(cash.id, { countedCents: 20000, keptCents: 30000 })).status).toBe(422);

    const closed = await close(cash.id, { countedCents: 20000 });
    expect(closed.body).toMatchObject({ keptCents: 20000 });
    expect(closed.body.summary).toMatchObject({ closingWithdrawalCents: 0, differenceCents: -5000 });
  });

  it('sem troco fixo configurado, o fechamento funciona como antes', async () => {
    const { body: cash } = await openCash(10000);
    const closed = await close(cash.id, { countedCents: 10000 });
    expect(closed.body).toMatchObject({ keptCents: null });
    expect(closed.body.summary.closingWithdrawalCents).toBeNull();
    expect((await suggestion()).body.suggestedCents).toBe(0);
  });
});

describe('Estoque negativo', () => {
  beforeEach(async () => {
    await openCash().expect(201);
  });

  it('por padrão a venda além do saldo é recusada', async () => {
    const res = await sell({
      items: [{ productId: collar.id, quantity: 6 }],
      payments: [{ method: 'PIX', amountCents: 18000 }],
    });
    expect(res.status).toBe(422);
  });

  it('se permitido, vende, deixa o saldo negativo e abre alerta de estoque negativo', async () => {
    await api().put('/api/settings').set(s.admin.auth).send({ allowNegativeStock: true }).expect(200);
    const res = await sell({
      items: [{ productId: collar.id, quantity: 7 }],
      payments: [{ method: 'PIX', amountCents: 21000 }],
    });
    expect(res.status).toBe(201);
    expect(await stockOf(collar.id, s.store.id)).toBe(-2);

    const alert = await prisma.stockAlert.findFirst({ where: { productId: collar.id, status: 'OPEN' } });
    expect(alert?.type).toBe('NEGATIVE_STOCK');
    const summary = await api().get('/api/alerts/summary').set(s.operator.auth);
    expect(summary.body).toMatchObject({ open: 1, negative: 1 });
  });

  it('saída manual continua sem poder deixar o saldo negativo', async () => {
    await api().put('/api/settings').set(s.admin.auth).send({ allowNegativeStock: true }).expect(200);
    const res = await api()
      .post('/api/stock/exits')
      .set(s.operator.auth)
      .send({ productId: collar.id, warehouseId: s.store.id, quantity: 6, reason: 'Perda' });
    expect(res.status).toBe(422);
  });
});

describe('Devolução parcial', () => {
  let sale: { id: string; items: Array<{ id: string; productId: string }> };

  beforeEach(async () => {
    await openCash().expect(201);
    // 3 coleiras (90,00) + 2 kg de ração (40,00) = 130,00, com 13,00 de desconto (10%) → 117,00
    const res = await sell({
      items: [
        { productId: collar.id, quantity: 3 },
        { productId: bulk.id, quantity: 2 },
      ],
      discountCents: 1300,
      payments: [{ method: 'CASH', amountCents: 11700 }],
    });
    expect(res.status).toBe(201);
    sale = res.body;
  });

  const itemOf = (productId: string) => sale.items.find((item) => item.productId === productId)!.id;
  const devolver = (body: object, auth = s.admin.auth) =>
    api().post(`/api/sales/${sale.id}/returns`).set(auth).send(body);

  it('devolve parte dos itens, estorna proporcional ao desconto e volta ao estoque', async () => {
    const res = await devolver({
      items: [
        { saleItemId: itemOf(collar.id), quantity: 1 },
        { saleItemId: itemOf(bulk.id), quantity: 0.5 },
      ],
      reason: 'Tamanho errado',
      refundMethod: 'CASH',
    });
    expect(res.status).toBe(201);
    // (30,00 + 10,00) × 0,9 = 36,00
    expect(res.body.refundCents).toBe(3600);
    expect(await stockOf(collar.id, s.store.id)).toBe(3);
    expect(await stockOf(bulk.id, s.store.id)).toBe(8.5);
    expect(await prisma.stockMovement.count({ where: { saleId: sale.id, type: 'SALE_RETURN' } })).toBe(2);

    const detail = await api().get(`/api/sales/${sale.id}`).set(s.operator.auth);
    const returnable = Object.fromEntries(
      detail.body.items.map((item: { productId: string; returnable: number }) => [item.productId, item.returnable]),
    );
    expect(returnable).toEqual({ [collar.id]: 2, [bulk.id]: 1.5 });
    expect(detail.body.returns).toHaveLength(1);

    // O caixa desconta a devolução em dinheiro: 100,00 + 117,00 − 36,00
    const cash = await api().get(`/api/cash/current?warehouseId=${s.store.id}`).set(s.admin.auth);
    expect(cash.body.summary).toMatchObject({ expectedCashCents: 18100, revenueCents: 8100, returnsCount: 1 });
  });

  it('não devolve mais do que foi vendido, somando devoluções anteriores', async () => {
    const collarItem = itemOf(collar.id);
    await devolver({ items: [{ saleItemId: collarItem, quantity: 2 }], reason: 'Defeito', refundMethod: 'PIX' }).expect(
      201,
    );
    const res = await devolver({
      items: [{ saleItemId: collarItem, quantity: 2 }],
      reason: 'Defeito',
      refundMethod: 'PIX',
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('RETURN_EXCEEDS_SOLD');
    expect(await stockOf(collar.id, s.store.id)).toBe(4);
  });

  it('operador não devolve; venda com devolução não pode ser cancelada inteira', async () => {
    const body = { items: [{ saleItemId: itemOf(collar.id), quantity: 1 }], reason: 'Defeito', refundMethod: 'PIX' };
    expect((await devolver(body, s.operator.auth)).status).toBe(403);
    await devolver(body).expect(201);

    const cancel = await api().post(`/api/sales/${sale.id}/cancel`).set(s.admin.auth).send({ reason: 'Desistiu' });
    expect(cancel.status).toBe(409);
    expect(await prisma.auditLog.count({ where: { summary: { startsWith: 'Devolução na venda' } } })).toBe(1);
  });
});
