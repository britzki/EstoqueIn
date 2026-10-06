import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { api, createScenario, resetDatabase, stockOf } from './helpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;

let s: Awaited<ReturnType<typeof createScenario>>;
let food: { id: string };
let treat: { id: string };
let toy: { id: string };
let maria: { id: string };
let cash: { id: string };

// Ração R$ 100 (custo 60), petisco R$ 10 (custo 4), brinquedo R$ 20 (custo 8). Caixa aberto com R$ 250.
beforeEach(async () => {
  await resetDatabase();
  s = await createScenario();
  food = await prisma.product.create({
    data: { sku: 'RACAO', name: 'Ração 10kg', category: 'Rações', priceCents: 10000, costCents: 6000 },
  });
  treat = await prisma.product.create({
    data: { sku: 'PETISCO', name: 'Petisco', category: 'Petiscos', priceCents: 1000, costCents: 400 },
  });
  toy = await prisma.product.create({
    data: { sku: 'BRINQ', name: 'Brinquedo', category: 'Brinquedos', priceCents: 2000, costCents: 800 },
  });
  await prisma.stockLevel.createMany({
    data: [
      { productId: food.id, warehouseId: s.store.id, quantity: 30 },
      { productId: treat.id, warehouseId: s.store.id, quantity: 40 },
      { productId: toy.id, warehouseId: s.store.id, quantity: 5 },
    ],
  });
  maria = await prisma.customer.create({ data: { name: 'Maria' } });
  cash = await prisma.cashSession.create({
    data: { number: 1, warehouseId: s.store.id, openedById: s.operator.user.id, openingCents: 25000 },
  });
});

const sell = (items: object[], payments: object[], extra: object = {}) =>
  api()
    .post('/api/sales')
    .set(s.operator.auth)
    .send({ warehouseId: s.store.id, items, payments, ...extra });
const pix = (amountCents: number) => [{ method: 'PIX', amountCents }];
const expectedCash = async () =>
  (await api().get(`/api/cash/${cash.id}`).set(s.operator.auth)).body.summary.expectedCashCents;

describe('Estorno de pagamento de fiado', () => {
  it('estorna o pagamento, a dívida volta e o caixa deixa de contar o dinheiro', async () => {
    await sell([{ productId: food.id, quantity: 1 }], [{ method: 'ACCOUNT', amountCents: 10000 }], {
      customerId: maria.id,
    }).expect(201);
    const { body: paid } = await api()
      .post(`/api/customers/${maria.id}/payments`)
      .set(s.operator.auth)
      .send({ amountCents: 4000, method: 'CASH', warehouseId: s.store.id });
    expect(await expectedCash()).toBe(29000);

    const url = `/api/customers/${maria.id}/payments/${paid.payment.id}/cancel`;
    await api().post(url).set(s.operator.auth).send({ reason: 'Lançado errado' }).expect(403);
    const res = await api().post(url).set(s.admin.auth).send({ reason: 'Lançado errado' });
    expect(res.status).toBe(200);
    expect(res.body.balanceCents).toBe(10000);
    expect((await api().post(url).set(s.admin.auth).send({ reason: 'De novo' })).body.error.code).toBe(
      'ALREADY_CANCELLED',
    );

    expect(await expectedCash()).toBe(25000);
    const statement = (await api().get(`/api/customers/${maria.id}/account`).set(s.operator.auth)).body;
    expect(statement.entries.map((e: { kind: string }) => e.kind)).toEqual(['PAYMENT_CANCEL', 'PAYMENT', 'SALE']);
    expect(statement.entries[0].description).toBe('Estorno do pagamento: Lançado errado');
    const debtors = (await api().get('/api/customers/debtors').set(s.operator.auth)).body;
    expect(debtors.debtors[0]).toMatchObject({ balanceCents: 10000, lastPaymentAt: null });
  });
});

describe('Cartão fidelidade', () => {
  const createRule = (auth = s.admin.auth) =>
    api()
      .post('/api/loyalty-rules')
      .set(auth)
      .send({ name: 'Ração: 3 + 1 petisco', category: 'Rações', requiredQuantity: 3, rewardProductId: treat.id });
  const card = async () => (await api().get(`/api/customers/${maria.id}/loyalty`).set(s.operator.auth)).body[0];

  it('conta as compras, libera o brinde e o brinde sai a R$ 0,00 baixando o estoque', async () => {
    await createRule(s.operator.auth).expect(403);
    const { body: rule } = await createRule();
    await sell([{ productId: food.id, quantity: 2 }], pix(20000), { customerId: maria.id }).expect(201);
    expect(await card()).toMatchObject({ purchased: 2, progress: 2, missing: 1, available: 0 });

    // Ainda não tem direito.
    const early = await sell(
      [
        { productId: food.id, quantity: 1 },
        { productId: treat.id, quantity: 1, loyaltyRuleId: rule.id },
      ],
      pix(10000),
      { customerId: maria.id },
    );
    expect(early.body.error.code).toBe('LOYALTY_NOT_AVAILABLE');

    await sell([{ productId: food.id, quantity: 1 }], pix(10000), { customerId: maria.id }).expect(201);
    expect(await card()).toMatchObject({ purchased: 3, progress: 0, available: 1 });

    const gift = await sell([{ productId: treat.id, quantity: 1, loyaltyRuleId: rule.id }], [], {
      customerId: maria.id,
    });
    expect(gift.status).toBe(201);
    expect(gift.body.items[0]).toMatchObject({
      unitPriceCents: 0,
      totalCents: 0,
      description: 'Petisco (brinde fidelidade)',
    });
    expect(await stockOf(treat.id, s.store.id)).toBe(39);
    expect(await card()).toMatchObject({ available: 0 });

    // Cancelar a venda do brinde devolve o direito.
    await api().post(`/api/sales/${gift.body.id}/cancel`).set(s.admin.auth).send({ reason: 'Teste' }).expect(200);
    expect(await card()).toMatchObject({ available: 1 });
  });

  it('brinde exige cliente e o produto certo', async () => {
    const { body: rule } = await createRule();
    const noCustomer = await sell([{ productId: treat.id, quantity: 1, loyaltyRuleId: rule.id }], pix(1));
    expect(noCustomer.body.error.code).toBe('LOYALTY_NEEDS_CUSTOMER');
    const wrong = await sell([{ productId: toy.id, quantity: 1, loyaltyRuleId: rule.id }], pix(1), {
      customerId: maria.id,
    });
    expect(wrong.body.error.code).toBe('LOYALTY_INVALID_REWARD');
  });
});

describe('Promoções', () => {
  const promo = (body: object) =>
    api()
      .post('/api/promotions')
      .set(s.admin.auth)
      .send({ startsAt: new Date(Date.now() - DAY_MS), endsAt: new Date(Date.now() + DAY_MS), ...body });

  it('preço promocional vale na venda e na devolução; fora do prazo, preço normal', async () => {
    expect((await promo({ productId: food.id, type: 'PRICE', priceCents: 12000 })).status).toBe(422);
    await promo({ productId: food.id, type: 'PRICE', priceCents: 8500 }).expect(201);

    const sale = await sell([{ productId: food.id, quantity: 2 }], pix(17000));
    expect(sale.status).toBe(201);
    expect(sale.body.totalCents).toBe(17000);
    expect(sale.body.items[0]).toMatchObject({ unitPriceCents: 8500, promoDiscountCents: 3000 });

    const ret = await api()
      .post(`/api/sales/${sale.body.id}/returns`)
      .set(s.admin.auth)
      .send({ items: [{ saleItemId: sale.body.items[0].id, quantity: 1 }], reason: 'Teste', refundMethod: 'PIX' });
    expect(ret.body.refundCents).toBe(8500);

    // Promoção encerrada: volta o preço normal.
    const active = (await api().get('/api/promotions/active').set(s.operator.auth)).body;
    await api().post(`/api/promotions/${active[0].id}/end`).set(s.admin.auth).expect(200);
    const normal = await sell([{ productId: food.id, quantity: 1 }], pix(10000));
    expect(normal.body.totalCents).toBe(10000);
  });

  it('leve 3, pague 2', async () => {
    await promo({ productId: treat.id, type: 'BUY_X_PAY_Y', buyQuantity: 3, payQuantity: 2 }).expect(201);
    // 7 petiscos: 2 de graça (6 levados, 4 pagos) + 1 avulso = 5 × 10,00
    const sale = await sell([{ productId: treat.id, quantity: 7 }], pix(5000));
    expect(sale.status).toBe(201);
    expect(sale.body.items[0]).toMatchObject({ totalCents: 5000, promoDiscountCents: 2000 });
    expect(await stockOf(treat.id, s.store.id)).toBe(33);
  });

  it('promoção agendada para o futuro ainda não vale', async () => {
    await api()
      .post('/api/promotions')
      .set(s.admin.auth)
      .send({
        productId: food.id,
        type: 'PRICE',
        priceCents: 5000,
        startsAt: new Date(Date.now() + DAY_MS),
        endsAt: new Date(Date.now() + 3 * DAY_MS),
      })
      .expect(201);
    expect((await sell([{ productId: food.id, quantity: 1 }], pix(10000))).body.totalCents).toBe(10000);
  });
});

describe('Kits', () => {
  let kit: { id: string };
  beforeEach(async () => {
    const created = await api()
      .post('/api/products')
      .set(s.admin.auth)
      .send({ sku: 'KIT-PET', name: 'Kit Pet Feliz', priceCents: 12000, isKit: true });
    kit = created.body;
    await api()
      .put(`/api/products/${kit.id}/kit`)
      .set(s.admin.auth)
      .send({
        items: [
          { productId: food.id, quantity: 1 },
          { productId: treat.id, quantity: 2 },
          { productId: toy.id, quantity: 1 },
        ],
      })
      .expect(200);
  });

  it('vender o kit baixa os componentes; cancelar e devolver devolvem', async () => {
    const detail = (await api().get(`/api/products/${kit.id}`).set(s.operator.auth)).body;
    expect(detail.kit).toEqual({ available: 5, costCents: 7600 });

    const sale = await sell([{ productId: kit.id, quantity: 2 }], pix(24000));
    expect(sale.status).toBe(201);
    expect(sale.body).toMatchObject({ totalCents: 24000, costCents: 15200 });
    expect([
      await stockOf(food.id, s.store.id),
      await stockOf(treat.id, s.store.id),
      await stockOf(toy.id, s.store.id),
    ]).toEqual([28, 36, 3]);

    await api()
      .post(`/api/sales/${sale.body.id}/returns`)
      .set(s.admin.auth)
      .send({ items: [{ saleItemId: sale.body.items[0].id, quantity: 1 }], reason: 'Teste', refundMethod: 'PIX' })
      .expect(201);
    expect(await stockOf(treat.id, s.store.id)).toBe(38);

    const other = await sell([{ productId: kit.id, quantity: 1 }], pix(12000));
    await api().post(`/api/sales/${other.body.id}/cancel`).set(s.admin.auth).send({ reason: 'Teste' }).expect(200);
    expect(await stockOf(toy.id, s.store.id)).toBe(4);
  });

  it('falta de um componente diz qual faltou; kit não tem estoque próprio nem entra no inventário', async () => {
    const res = await sell([{ productId: kit.id, quantity: 6 }], pix(72000));
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/Brinquedo \(do kit Kit Pet Feliz\): disponível 5/);

    const entry = await api()
      .post('/api/stock/entries')
      .set(s.admin.auth)
      .send({ productId: kit.id, warehouseId: s.store.id, quantity: 1, unitCostCents: 100 });
    expect(entry.body.error.code).toBe('KIT_HAS_NO_STOCK');

    const resolved = await api().get(`/api/sales/resolve?code=KIT-PET&warehouseId=${s.store.id}`).set(s.operator.auth);
    expect(resolved.body.product).toMatchObject({ isKit: true, stock: 5 });

    const inventory = await api().post('/api/inventories').set(s.admin.auth).send({ warehouseId: s.store.id });
    expect(inventory.status).toBe(201);
    expect(await prisma.inventoryItem.count({ where: { productId: kit.id } })).toBe(0);
  });

  it('kit não pode conter outro kit nem ele mesmo', async () => {
    const res = await api()
      .put(`/api/products/${kit.id}/kit`)
      .set(s.admin.auth)
      .send({ items: [{ productId: kit.id, quantity: 1 }] });
    expect(res.status).toBe(422);
  });
});

describe('Contas a pagar', () => {
  const create = (body: object, auth = s.admin.auth) => api().post('/api/bills').set(auth).send(body);

  it('mostra vencidas e próximas; conta mensal gera a do mês seguinte ao pagar', async () => {
    await create(
      { description: 'Aluguel', amountCents: 150000, dueDate: '2026-01-31', monthly: true },
      s.operator.auth,
    ).expect(403);
    const { body: rent } = await create({
      description: 'Aluguel',
      amountCents: 150000,
      dueDate: '2026-01-31T12:00:00',
      monthly: true,
    });
    await create({ description: 'Luz', amountCents: 30000, dueDate: new Date(Date.now() + 3 * DAY_MS) }).expect(201);
    await create({ description: 'Água', amountCents: 9000, dueDate: new Date(Date.now() + 30 * DAY_MS) }).expect(201);

    // Contas a pagar são só de administrador e gerente.
    await api().get('/api/bills/summary').set(s.viewer.auth).expect(403);
    await api().get('/api/bills').set(s.operator.auth).expect(403);
    const summary = (await api().get('/api/bills/summary').set(s.admin.auth)).body;
    expect(summary.overdue).toEqual({ count: 1, totalCents: 150000 });
    expect(summary.upcoming).toEqual({ count: 1, totalCents: 30000 });

    const paid = await api().post(`/api/bills/${rent.id}/pay`).set(s.admin.auth).send({ method: 'PIX' });
    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe('PAID');
    expect(new Date(paid.body.next.dueDate).getDate()).toBe(28); // 31/01 → 28/02
    expect((await api().post(`/api/bills/${rent.id}/pay`).set(s.admin.auth).send({ method: 'PIX' })).status).toBe(409);
  });

  it('pagar com dinheiro da gaveta registra a sangria no caixa', async () => {
    const { body: bill } = await create({ description: 'Motoboy', amountCents: 5000, dueDate: new Date() });
    const res = await api()
      .post(`/api/bills/${bill.id}/pay`)
      .set(s.admin.auth)
      .send({ method: 'CASH', fromCash: true, warehouseId: s.store.id });
    expect(res.status).toBe(200);
    expect(await expectedCash()).toBe(20000);
    const movement = await prisma.cashMovement.findFirst();
    expect(movement).toMatchObject({ type: 'WITHDRAWAL', amountCents: 5000, reason: 'Conta paga: Motoboy' });

    const { body: other } = await create({ description: 'Gás', amountCents: 1000, dueDate: new Date() });
    await prisma.cashSession.update({ where: { id: cash.id }, data: { status: 'CLOSED' } });
    const closed = await api()
      .post(`/api/bills/${other.id}/pay`)
      .set(s.admin.auth)
      .send({ method: 'CASH', fromCash: true, warehouseId: s.store.id });
    expect(closed.body.error.code).toBe('CASH_CLOSED');
    expect(
      (await api().post(`/api/bills/${other.id}/pay`).set(s.admin.auth).send({ method: 'PIX', fromCash: true })).status,
    ).toBe(422);
  });
});

describe('Fechamento do mês', () => {
  it('junta vendas, devoluções, contas pagas, fiado e caixa', async () => {
    const from = new Date(Date.now() - DAY_MS).toISOString();
    const to = new Date(Date.now() + DAY_MS).toISOString();
    const a = await sell([{ productId: food.id, quantity: 2 }], pix(20000));
    await sell([{ productId: food.id, quantity: 1 }], [{ method: 'ACCOUNT', amountCents: 10000 }], {
      customerId: maria.id,
    });
    await api()
      .post(`/api/sales/${a.body.id}/returns`)
      .set(s.admin.auth)
      .send({ items: [{ saleItemId: a.body.items[0].id, quantity: 1 }], reason: 'Teste', refundMethod: 'PIX' })
      .expect(201);
    const { body: bill } = await api()
      .post('/api/bills')
      .set(s.admin.auth)
      .send({ description: 'Luz', amountCents: 3000, dueDate: new Date() });
    await api().post(`/api/bills/${bill.id}/pay`).set(s.admin.auth).send({ method: 'PIX' }).expect(200);

    const res = await api().get(`/api/reports/monthly?from=${from}&to=${to}`).set(s.admin.auth);
    expect(res.status).toBe(200);
    // Vendas 300,00 − devolução 100,00 = 200,00; lucro (300 − 180) − (100 − 60) = 80,00; resultado 80 − 30 = 50,00
    expect(res.body.sales).toMatchObject({
      count: 2,
      returns: 1,
      revenueCents: 20000,
      refundsCents: 10000,
      grossProfitCents: 8000,
    });
    expect(res.body.expenses).toMatchObject({ paidCents: 3000 });
    expect(res.body.resultCents).toBe(5000);
    expect(res.body.account).toMatchObject({ soldCents: 10000, receivedCents: 0, outstandingCents: 10000, debtors: 1 });
    await api().get(`/api/reports/monthly?from=${from}&to=${to}`).set(s.operator.auth).expect(403);
    // Somente leitura vê o mês, mas sem as contas a pagar.
    const viewer = await api().get(`/api/reports/monthly?from=${from}&to=${to}`).set(s.viewer.auth);
    expect(viewer.body).toMatchObject({ expenses: null, resultCents: null, sales: { revenueCents: 20000 } });
  });
});
