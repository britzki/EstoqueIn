import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { api, createScenario, resetDatabase } from './helpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;

let s: Awaited<ReturnType<typeof createScenario>>;
let food: { id: string };
let maria: { id: string };
let cash: { id: string };

// Ração R$ 100,00 (custo 60,00), 50 em estoque; caixa aberto com R$ 250,00.
beforeEach(async () => {
  await resetDatabase();
  s = await createScenario();
  food = await prisma.product.create({
    data: { sku: 'RACAO', name: 'Ração 10kg', priceCents: 10000, costCents: 6000, supplierId: s.supplier.id },
  });
  await prisma.stockLevel.create({ data: { productId: food.id, warehouseId: s.store.id, quantity: 50 } });
  maria = await prisma.customer.create({ data: { name: 'Maria', phone: '11987654321' } });
  cash = await prisma.cashSession.create({
    data: { number: 1, warehouseId: s.store.id, openedById: s.operator.user.id, openingCents: 25000 },
  });
});

const sell = (payments: object[], extra: object = {}, quantity = 1) =>
  api()
    .post('/api/sales')
    .set(s.operator.auth)
    .send({ warehouseId: s.store.id, items: [{ productId: food.id, quantity }], payments, ...extra });

const account = () => api().get(`/api/customers/${maria.id}/account`).set(s.operator.auth);
const pay = (body: object, auth = s.operator.auth) =>
  api()
    .post(`/api/customers/${maria.id}/payments`)
    .set(auth)
    .send({ warehouseId: s.store.id, ...body });

describe('Fiado', () => {
  it('não vende fiado sem cliente', async () => {
    const res = await sell([{ method: 'ACCOUNT', amountCents: 10000 }]);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ACCOUNT_NEEDS_CUSTOMER');
  });

  it('venda fiada fica na conta do cliente; parte pode ser paga na hora', async () => {
    const full = await sell([{ method: 'ACCOUNT', amountCents: 10000 }], { customerId: maria.id });
    expect(full.status).toBe(201);
    expect(full.body.customerBalanceCents).toBe(10000);

    // 2 sacos = 200,00: 50,00 em dinheiro e 150,00 no fiado.
    const partial = await sell(
      [
        { method: 'CASH', amountCents: 5000 },
        { method: 'ACCOUNT', amountCents: 15000 },
      ],
      { customerId: maria.id },
      2,
    );
    expect(partial.body.customerBalanceCents).toBe(25000);

    const { body } = await account();
    expect(body.balanceCents).toBe(25000);
    expect(body.entries.map((e: { description: string }) => e.description)).toEqual(['Venda nº 2', 'Venda nº 1']);

    const debtors = await api().get('/api/customers/debtors').set(s.viewer.auth);
    expect(debtors.body.totalCents).toBe(25000);
    expect(debtors.body.debtors[0]).toMatchObject({ customer: { name: 'Maria' }, balanceCents: 25000, daysOpen: 0 });
  });

  it('pagamento parcial abate a dívida e entra no caixa; não aceita pagar mais do que deve', async () => {
    await sell([{ method: 'ACCOUNT', amountCents: 10000 }], { customerId: maria.id }, 1);
    await sell([{ method: 'ACCOUNT', amountCents: 10000 }], { customerId: maria.id }, 1);

    expect((await pay({ amountCents: 30000, method: 'CASH' })).body.error.code).toBe('PAYMENT_EXCEEDS_DEBT');
    const paid = await pay({ amountCents: 12000, method: 'CASH', notes: 'pagou no sábado' });
    expect(paid.status).toBe(201);
    expect(paid.body.balanceCents).toBe(8000);
    await pay({ amountCents: 3000, method: 'PIX' }).expect(201);

    const { body } = await account();
    expect(body.balanceCents).toBe(5000);
    expect(body.entries[0]).toMatchObject({ kind: 'PAYMENT', amountCents: -3000, balanceCents: 5000 });

    // Caixa: 250 + 120 (fiado em dinheiro). Venda no fiado não é dinheiro na gaveta.
    const summary = (await api().get(`/api/cash/${cash.id}`).set(s.operator.auth)).body.summary;
    expect(summary).toMatchObject({
      expectedCashCents: 37000,
      revenueCents: 20000,
      accountReceivedCents: 15000,
      accountReceivedByMethod: { CASH: 12000, PIX: 3000 },
    });
    expect(summary.byMethod.ACCOUNT).toBe(20000);

    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'CustomerPayment' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit?.summary).toMatch(/Fiado de Maria: recebido R\$\s?120,00/);
  });

  it('em aberto desde: a dívida mais antiga ainda não paga', async () => {
    const first = await sell([{ method: 'ACCOUNT', amountCents: 10000 }], { customerId: maria.id });
    await sell([{ method: 'ACCOUNT', amountCents: 10000 }], { customerId: maria.id });
    await prisma.sale.update({ where: { id: first.body.id }, data: { createdAt: new Date(Date.now() - 20 * DAY_MS) } });

    let debtors = (await api().get('/api/customers/debtors').set(s.operator.auth)).body;
    expect(debtors.debtors[0].daysOpen).toBe(20);

    // Pagou a primeira compra inteira: o que está em aberto agora é a de hoje.
    await pay({ amountCents: 10000, method: 'PIX' }).expect(201);
    debtors = (await api().get('/api/customers/debtors').set(s.operator.auth)).body;
    expect(debtors.debtors[0]).toMatchObject({ balanceCents: 10000, daysOpen: 0 });
  });

  it('cancelar a venda ou devolver abatendo do fiado corrige a dívida sozinho', async () => {
    const a = await sell([{ method: 'ACCOUNT', amountCents: 10000 }], { customerId: maria.id });
    const b = await sell([{ method: 'ACCOUNT', amountCents: 20000 }], { customerId: maria.id }, 2);
    await api().post(`/api/sales/${a.body.id}/cancel`).set(s.admin.auth).send({ reason: 'Desistiu' }).expect(200);
    await api()
      .post(`/api/sales/${b.body.id}/returns`)
      .set(s.admin.auth)
      .send({
        items: [{ saleItemId: b.body.items[0].id, quantity: 1 }],
        reason: 'Embalagem rasgada',
        refundMethod: 'ACCOUNT',
      })
      .expect(201);
    expect((await account()).body.balanceCents).toBe(10000);

    // Venda sem cliente não pode ser devolvida "no fiado".
    const anon = await sell([{ method: 'PIX', amountCents: 10000 }]);
    const res = await api()
      .post(`/api/sales/${anon.body.id}/returns`)
      .set(s.admin.auth)
      .send({ items: [{ saleItemId: anon.body.items[0].id, quantity: 1 }], reason: 'Teste', refundMethod: 'ACCOUNT' });
    expect(res.body.error.code).toBe('ACCOUNT_NEEDS_CUSTOMER');
  });

  it('limite de fiado: só o gerente define, e a venda além do limite é recusada', async () => {
    await api().patch(`/api/customers/${maria.id}`).set(s.operator.auth).send({ creditLimitCents: 15000 }).expect(403);
    await api().patch(`/api/customers/${maria.id}`).set(s.admin.auth).send({ creditLimitCents: 15000 }).expect(200);
    // Operador pode editar outros dados sem mexer no limite.
    await api().patch(`/api/customers/${maria.id}`).set(s.operator.auth).send({ notes: 'Cão: Thor' }).expect(200);

    await sell([{ method: 'ACCOUNT', amountCents: 10000 }], { customerId: maria.id }).expect(201);
    const over = await sell([{ method: 'ACCOUNT', amountCents: 10000 }], { customerId: maria.id });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('CREDIT_LIMIT');
    expect(over.body.error.message).toMatch(/limite R\$\s?150,00, em aberto R\$\s?100,00/);
  });

  it('fiado anterior do caderno entra no saldo e pode ser pago; só o gerente lança', async () => {
    await api()
      .patch(`/api/customers/${maria.id}`)
      .set(s.operator.auth)
      .send({ openingBalanceCents: 8000 })
      .expect(403);
    await api().patch(`/api/customers/${maria.id}`).set(s.admin.auth).send({ openingBalanceCents: 8000 }).expect(200);
    await sell([{ method: 'ACCOUNT', amountCents: 10000 }], { customerId: maria.id }).expect(201);

    let { body } = await account();
    expect(body.balanceCents).toBe(18000);
    expect(body.entries.at(-1)).toMatchObject({
      kind: 'OPENING',
      description: 'Fiado anterior (caderno)',
      amountCents: 8000,
    });

    await pay({ amountCents: 18000, method: 'PIX' }).expect(201);
    ({ body } = await account());
    expect(body.balanceCents).toBe(0);
    const debtors = await api().get('/api/customers/debtors').set(s.operator.auth);
    expect(debtors.body.debtors).toHaveLength(0);
  });

  it('receber em dinheiro com o caixa fechado é recusado', async () => {
    await sell([{ method: 'ACCOUNT', amountCents: 10000 }], { customerId: maria.id });
    await prisma.cashSession.update({ where: { id: cash.id }, data: { status: 'CLOSED' } });
    expect((await pay({ amountCents: 1000, method: 'CASH' })).body.error.code).toBe('CASH_CLOSED');
    await pay({ amountCents: 1000, method: 'PIX' }).expect(201);
  });
});

describe('Botões rápidos', () => {
  it('mostra primeiro os marcados no cadastro e completa com os mais vendidos', async () => {
    const bulk = await prisma.product.create({
      data: { sku: 'GRANEL', name: 'Granel', unit: 'KG', fractional: true, priceCents: 2000, quickSale: true },
    });
    await prisma.product.create({ data: { sku: 'SEMPRECO', name: 'Sem preço', quickSale: true } });
    await prisma.stockLevel.create({ data: { productId: bulk.id, warehouseId: s.store.id, quantity: 7.5 } });
    await sell([{ method: 'PIX', amountCents: 10000 }]);

    const res = await api().get(`/api/sales/quick-products?warehouseId=${s.store.id}`).set(s.operator.auth);
    expect(res.body.map((p: { sku: string }) => p.sku)).toEqual(['GRANEL', 'RACAO']);
    expect(res.body[0]).toMatchObject({ fractional: true, stock: 7.5, quickSale: true });

    await api().get('/api/sales/quick-products').set(s.viewer.auth).expect(403);
  });
});

describe('Pedido ao fornecedor', () => {
  it('registra o pedido e a sugestão de compra desconta o que já foi pedido', async () => {
    await prisma.product.update({ where: { id: food.id }, data: { minStock: 60 } });
    const before = await api().get('/api/reports/purchase-suggestion').set(s.viewer.auth);
    const row = before.body.rows.find((r: { sku: string }) => r.sku === 'RACAO');
    expect(row).toMatchObject({ suggested: 10, onOrder: 0 });

    await api()
      .post('/api/purchase-orders')
      .set(s.operator.auth)
      .send({ supplierId: s.supplier.id, items: [{ productId: food.id, quantity: 6 }] })
      .expect(403);
    const created = await api()
      .post('/api/purchase-orders')
      .set(s.admin.auth)
      .send({ supplierId: s.supplier.id, items: [{ productId: food.id, quantity: 6 }], notes: 'Entregar na terça' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      number: 1,
      status: 'OPEN',
      totalCents: 36000,
      supplier: { name: 'Fornecedor Teste' },
      items: [{ description: 'Ração 10kg', quantity: 6, unitCostCents: 6000 }],
    });

    const after = await api().get('/api/reports/purchase-suggestion').set(s.viewer.auth);
    expect(after.body.rows.find((r: { sku: string }) => r.sku === 'RACAO')).toMatchObject({ onOrder: 6, suggested: 4 });

    // Recebido: deixa de contar como "a caminho".
    await api()
      .post(`/api/purchase-orders/${created.body.id}/status`)
      .set(s.admin.auth)
      .send({ status: 'RECEIVED' })
      .expect(200);
    const received = await api().get('/api/reports/purchase-suggestion').set(s.viewer.auth);
    expect(received.body.rows.find((r: { sku: string }) => r.sku === 'RACAO')).toMatchObject({
      onOrder: 0,
      suggested: 10,
    });
    await api()
      .post(`/api/purchase-orders/${created.body.id}/status`)
      .set(s.admin.auth)
      .send({ status: 'CANCELLED' })
      .expect(409);

    const list = await api().get('/api/purchase-orders').set(s.viewer.auth);
    expect(list.body.data[0]).toMatchObject({ number: 1, status: 'RECEIVED' });
  });

  it('produto por unidade não aceita quantidade quebrada', async () => {
    const res = await api()
      .post('/api/purchase-orders')
      .set(s.admin.auth)
      .send({ items: [{ productId: food.id, quantity: 1.5 }] });
    expect(res.status).toBe(422);
  });
});
