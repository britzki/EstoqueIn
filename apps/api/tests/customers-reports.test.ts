import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { api, createScenario, resetDatabase } from './helpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

let s: Awaited<ReturnType<typeof createScenario>>;

beforeEach(async () => {
  await resetDatabase();
  s = await createScenario();
  await prisma.storeSettings.create({ data: { id: 1, requireCashSession: false } });
});

describe('Clientes', () => {
  it('cadastra, busca por nome ou telefone e altera', async () => {
    const created = await api()
      .post('/api/customers')
      .set(s.operator.auth)
      .send({ name: 'Maria Souza', phone: '(11) 98765-4321', notes: 'Cachorro: Thor' });
    expect(created.status).toBe(201);
    expect(created.body.phone).toBe('11987654321');

    await api().post('/api/customers').set(s.operator.auth).send({ name: 'João', phone: '123' }).expect(400);
    await api().post('/api/customers').set(s.viewer.auth).send({ name: 'Sem permissão' }).expect(403);

    const byName = await api().get('/api/customers?search=maria').set(s.viewer.auth);
    expect(byName.body.data).toHaveLength(1);
    const byPhone = await api().get('/api/customers?search=98765').set(s.viewer.auth);
    expect(byPhone.body.data[0].name).toBe('Maria Souza');

    await api().patch(`/api/customers/${created.body.id}`).set(s.operator.auth).send({ phone: '' }).expect(200);
    expect((await prisma.customer.findUnique({ where: { id: created.body.id } }))?.phone).toBeNull();
    expect(await prisma.auditLog.count({ where: { entity: 'Customer' } })).toBe(2);
  });

  it('a venda fica no histórico do cliente com o nome dele', async () => {
    const customer = await prisma.customer.create({ data: { name: 'Ana' } });
    await prisma.product.update({ where: { id: s.product.id }, data: { priceCents: 1000 } });
    await prisma.stockLevel.create({ data: { productId: s.product.id, warehouseId: s.store.id, quantity: 5 } });
    const sale = await api()
      .post('/api/sales')
      .set(s.operator.auth)
      .send({
        warehouseId: s.store.id,
        customerId: customer.id,
        items: [{ productId: s.product.id, quantity: 1 }],
        payments: [{ method: 'PIX', amountCents: 1000 }],
      });
    expect(sale.status).toBe(201);
    expect(sale.body).toMatchObject({ customerId: customer.id, customerName: 'Ana' });

    const detail = await api().get(`/api/customers/${customer.id}`).set(s.viewer.auth);
    expect(detail.body.sales).toHaveLength(1);
  });
});

describe('Lembrete de recompra', () => {
  /** Venda gravada direto no banco, numa data passada. */
  let number = 0;
  beforeEach(() => {
    number = 0;
  });
  const pastSale = async (customerId: string, productId: string, days: number) => {
    number += 1;
    await prisma.sale.create({
      data: {
        number,
        warehouseId: s.store.id,
        userId: s.operator.user.id,
        customerId,
        subtotalCents: 1000,
        totalCents: 1000,
        paidCents: 1000,
        costCents: 500,
        createdAt: daysAgo(days),
        items: {
          create: {
            productId,
            description: 'Ração',
            unit: 'UN',
            quantity: 1,
            unitPriceCents: 1000,
            totalCents: 1000,
            unitCostCents: 500,
          },
        },
      },
    });
  };

  it('prevê a próxima compra pelo intervalo médio e lista quem está para voltar', async () => {
    const maria = await prisma.customer.create({ data: { name: 'Maria', phone: '11987654321' } });
    const joao = await prisma.customer.create({ data: { name: 'João' } });
    const ana = await prisma.customer.create({ data: { name: 'Ana' } });

    // Maria compra a cada 30 dias; última há 27 → volta em 3 dias.
    await pastSale(maria.id, s.product.id, 87);
    await pastSale(maria.id, s.product.id, 57);
    await pastSale(maria.id, s.product.id, 27);
    // João a cada 20 dias; última há 25 → atrasado 5 dias.
    await pastSale(joao.id, s.product.id, 45);
    await pastSale(joao.id, s.product.id, 25);
    // Ana comprou uma vez só: sem previsão.
    await pastSale(ana.id, s.product.id, 10);

    const res = await api().get('/api/customers/reminders?days=7').set(s.viewer.auth);
    expect(res.status).toBe(200);
    expect(res.body.map((r: { customer: { name: string } }) => r.customer.name)).toEqual(['João', 'Maria']);
    expect(res.body[0]).toMatchObject({ purchases: 2, averageIntervalDays: 20, daysUntil: -5 });
    expect(res.body[1]).toMatchObject({ purchases: 3, averageIntervalDays: 30, daysUntil: 3 });
    expect(res.body[1].customer.phone).toBe('11987654321');

    // Horizonte menor: só o atrasado.
    const today = await api().get('/api/customers/reminders?days=0').set(s.viewer.auth);
    expect(today.body).toHaveLength(1);
  });

  it('ignora vendas canceladas', async () => {
    const maria = await prisma.customer.create({ data: { name: 'Maria' } });
    await pastSale(maria.id, s.product.id, 40);
    await pastSale(maria.id, s.product.id, 20);
    await prisma.sale.updateMany({ where: { number: 2 }, data: { status: 'CANCELLED' } });
    const res = await api().get('/api/customers/reminders?days=30').set(s.viewer.auth);
    expect(res.body).toHaveLength(0);
  });
});

describe('Sugestão de compra e produtos parados', () => {
  /** Movimento gravado direto, numa data passada. */
  const movement = (
    productId: string,
    type: 'EXIT' | 'ENTRY' | 'SALE_RETURN' | 'FRACTION_OUT',
    quantity: number,
    days: number,
  ) =>
    prisma.stockMovement.create({
      data: {
        type,
        productId,
        warehouseId: s.store.id,
        quantity,
        balanceAfter: 0,
        userId: s.admin.user.id,
        createdAt: daysAgo(days),
      },
    });

  it('sugere comprar o que acaba antes da próxima compra, agrupado por fornecedor', async () => {
    // Café: 30 saídas em 30 dias (1/dia), devolveram 0 → saldo 5, mínimo 10.
    await prisma.product.update({
      where: { id: s.product.id },
      data: { costCents: 800, supplierId: s.supplier.id },
    });
    await prisma.stockLevel.create({ data: { productId: s.product.id, warehouseId: s.store.id, quantity: 5 } });
    await movement(s.product.id, 'EXIT', -20, 20);
    await movement(s.product.id, 'EXIT', -12, 5);
    await movement(s.product.id, 'SALE_RETURN', 2, 4);
    // Movimento antigo (fora dos 30 dias) não conta.
    await movement(s.product.id, 'EXIT', -100, 60);

    // Produto com estoque de sobra não aparece; granel não aparece (compra-se o pacote).
    const plenty = await prisma.product.create({ data: { sku: 'SOBRA', name: 'Sobra', minStock: 1 } });
    await prisma.stockLevel.create({ data: { productId: plenty.id, warehouseId: s.store.id, quantity: 500 } });
    await movement(plenty.id, 'EXIT', -30, 10);
    const bag = await prisma.product.create({ data: { sku: 'SACO', name: 'Saco 15 kg', costCents: 15000 } });
    await prisma.product.create({
      data: {
        sku: 'GRANEL',
        name: 'Granel',
        unit: 'KG',
        fractional: true,
        minStock: 5,
        sourceProductId: bag.id,
        sourceYield: 15,
      },
    });
    // O saco é aberto para granel 2 vezes no período: entra no consumo do saco.
    await movement(bag.id, 'FRACTION_OUT', -2, 10);

    const res = await api().get('/api/reports/purchase-suggestion?days=30&coverDays=15').set(s.admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.rows.map((r: { sku: string }) => r.sku)).toEqual(['SACO', 'CAF-500']);
    // Café: consumo 30 → 1/dia; alvo = 15 dias + mínimo 10 = 25; saldo 5 → comprar 20.
    expect(res.body.rows[1]).toMatchObject({
      consumed: 30,
      dailyAverage: 1,
      daysLeft: 5,
      suggested: 20,
      estimatedCents: 16000,
    });
    expect(res.body.rows[0]).toMatchObject({ consumed: 2, daysLeft: 0, suggested: 1 });
    expect(res.body.suppliers[0]).toMatchObject({
      supplier: { name: 'Fornecedor Teste' },
      items: 1,
      estimatedCents: 16000,
    });

    const csv = await api().get('/api/reports/purchase-suggestion?format=csv').set(s.admin.auth);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('Fornecedor Teste');
  });

  it('lista produtos com saldo e sem saída no período, com o valor parado', async () => {
    await prisma.product.update({ where: { id: s.product.id }, data: { costCents: 1000 } });
    await prisma.stockLevel.create({ data: { productId: s.product.id, warehouseId: s.store.id, quantity: 4 } });
    await movement(s.product.id, 'EXIT', -1, 90);

    const sold = await prisma.product.create({ data: { sku: 'GIRA', name: 'Gira bem', costCents: 500 } });
    await prisma.stockLevel.create({ data: { productId: sold.id, warehouseId: s.store.id, quantity: 10 } });
    await movement(sold.id, 'EXIT', -1, 3);

    const never = await prisma.product.create({ data: { sku: 'NUNCA', name: 'Nunca vendeu', costCents: 200 } });
    await prisma.stockLevel.create({ data: { productId: never.id, warehouseId: s.store.id, quantity: 3 } });

    const res = await api().get('/api/reports/stale-products?days=60').set(s.admin.auth);
    expect(res.body.rows.map((r: { sku: string }) => r.sku)).toEqual(['CAF-500', 'NUNCA']);
    expect(res.body.rows[0]).toMatchObject({ valueCents: 4000, daysSinceExit: 90 });
    expect(res.body.rows[1]).toMatchObject({ valueCents: 600, daysSinceExit: null, lastExitAt: null });
    expect(res.body.summary).toEqual({ products: 2, valueCents: 4600 });

    await api().get('/api/reports/stale-products').set(s.operator.auth).expect(403);
  });
});
