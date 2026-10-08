import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { api, createScenario, resetDatabase } from './helpers.js';

let s: Awaited<ReturnType<typeof createScenario>>;
let saleId: string;
let cashId: string;

// Números do negócio (faturamento, custo, margem, valor do estoque) só para administrador e gerente.
beforeEach(async () => {
  await resetDatabase();
  s = await createScenario();
  await prisma.product.update({ where: { id: s.product.id }, data: { priceCents: 2000, costCents: 1200 } });
  await prisma.stockLevel.create({ data: { productId: s.product.id, warehouseId: s.store.id, quantity: 10 } });
  const cash = await prisma.cashSession.create({
    data: { number: 1, warehouseId: s.store.id, openedById: s.operator.user.id, openingCents: 25000 },
  });
  cashId = cash.id;
  const sale = await api()
    .post('/api/sales')
    .set(s.operator.auth)
    .send({
      warehouseId: s.store.id,
      items: [{ productId: s.product.id, quantity: 2 }],
      payments: [{ method: 'PIX', amountCents: 4000 }],
    });
  saleId = sale.body.id;
});

describe('Números do negócio', () => {
  it('operador não vê faturamento, custo nem valor do estoque', async () => {
    const dashboard = (await api().get('/api/dashboard').set(s.operator.auth)).body;
    expect(dashboard.totals).toMatchObject({ stockValueCents: null, salesToday: null });

    const product = (await api().get(`/api/products/${s.product.id}`).set(s.operator.auth)).body;
    expect(product.costCents).toBeNull();
    const list = (await api().get('/api/products').set(s.operator.auth)).body.data;
    expect(list.every((p: { costCents: number | null }) => p.costCents === null)).toBe(true);

    const sale = (await api().get(`/api/sales/${saleId}`).set(s.operator.auth)).body;
    expect(sale.costCents).toBeNull();
    expect(sale.items[0].unitCostCents).toBeNull();
    expect(sale.totalCents).toBe(4000); // o valor da venda continua visível (notinha, devolução)

    // No caixa: só o dinheiro da gaveta, sem faturamento nem Pix/cartão.
    const cash = (await api().get(`/api/cash/${cashId}`).set(s.operator.auth)).body.summary;
    expect(cash).toMatchObject({ revenueCents: null, byMethod: { CASH: 0 }, expectedCashCents: 25000 });
    expect(cash.byMethod.PIX).toBeUndefined();

    const csv = await api().get('/api/stock/movements?format=csv').set(s.operator.auth);
    expect(csv.text).not.toContain('Custo unitário');

    await api().get('/api/reports/sales?from=2026-01-01&to=2030-01-01').set(s.operator.auth).expect(403);
  });

  it('somente leitura também não vê relatórios nem custo', async () => {
    await api().get('/api/reports/stock-position').set(s.viewer.auth).expect(403);
    const dashboard = (await api().get('/api/dashboard').set(s.viewer.auth)).body;
    expect(dashboard.totals.salesToday).toBeNull();
    expect((await api().get(`/api/products/${s.product.id}`).set(s.viewer.auth)).body.costCents).toBeNull();
  });

  it('administrador vê tudo', async () => {
    const dashboard = (await api().get('/api/dashboard').set(s.admin.auth)).body;
    expect(dashboard.totals.salesToday).toMatchObject({ count: 1, totalCents: 4000 });
    expect(dashboard.totals.stockValueCents).toBe(9600);
    expect((await api().get(`/api/products/${s.product.id}`).set(s.admin.auth)).body.costCents).toBe(1200);
    expect((await api().get(`/api/sales/${saleId}`).set(s.admin.auth)).body.costCents).toBe(2400);
    const cash = (await api().get(`/api/cash/${cashId}`).set(s.admin.auth)).body.summary;
    expect(cash).toMatchObject({ revenueCents: 4000, byMethod: { PIX: 4000 } });
    const csv = await api().get('/api/stock/movements?format=csv').set(s.admin.auth);
    expect(csv.text).toContain('Custo unitário');
  });
});
