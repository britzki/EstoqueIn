import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { gtinCheckDigit } from '../src/lib/barcode.js';
import { parseScaleLabel } from '../src/lib/scale.js';
import { api, createScenario, resetDatabase, stockOf } from './helpers.js';

let s: Awaited<ReturnType<typeof createScenario>>;
let collar: { id: string };
let bulk: { id: string };

/** Etiqueta de balança: prefixo 2 + código (6 dígitos) + valor (5 dígitos) + dígito verificador. */
const scaleLabel = (code: number, value: number) => {
  const body = '2' + String(code).padStart(6, '0') + String(value).padStart(5, '0');
  return body + gtinCheckDigit(body);
};

// Pet shop: coleira (unidade, R$ 30,00, custo R$ 12,00) e ração a granel (kg, R$ 17,90, custo R$ 10,00).
beforeEach(async () => {
  await resetDatabase();
  s = await createScenario();
  collar = await prisma.product.create({
    data: {
      sku: 'COLEIRA',
      name: 'Coleira M',
      barcode: '7891000100509',
      priceCents: 3000,
      costCents: 1200,
      minStock: 2,
    },
  });
  bulk = await prisma.product.create({
    data: {
      sku: 'RAC-GR',
      name: 'Ração a granel',
      unit: 'KG',
      fractional: true,
      priceCents: 1790,
      costCents: 1000,
      scaleCode: '123',
    },
  });
  await prisma.stockLevel.createMany({
    data: [
      { productId: collar.id, warehouseId: s.store.id, quantity: 5 },
      { productId: bulk.id, warehouseId: s.store.id, quantity: 15 },
    ],
  });
  await prisma.cashSession.create({
    data: { number: 1, warehouseId: s.store.id, openedById: s.operator.user.id, openingCents: 10000 },
  });
});

const sell = (body: object, auth = s.operator.auth) =>
  api()
    .post('/api/sales')
    .set(auth)
    .send({ warehouseId: s.store.id, ...body });

const basicSale = (extra: object = {}) =>
  sell({
    items: [
      { productId: collar.id, quantity: 2 },
      { productId: bulk.id, quantity: 0.35 },
    ],
    payments: [{ method: 'PIX', amountCents: 6627 }],
    ...extra,
  });

describe('Registrar venda', () => {
  it('soma o total, baixa o estoque de todos os itens e grava o histórico', async () => {
    const res = await basicSale();

    expect(res.status).toBe(201);
    // 2 × 30,00 + 0,350 × 17,90 (6,265 → 6,27) = 66,27
    expect(res.body).toMatchObject({
      number: 1,
      subtotalCents: 6627,
      totalCents: 6627,
      changeCents: 0,
      status: 'COMPLETED',
    });
    // custo: 2 × 12,00 + 0,350 × 10,00 = 27,50
    expect(res.body.costCents).toBe(2750);
    expect(res.body.items).toHaveLength(2);

    expect(await stockOf(collar.id, s.store.id)).toBe(3);
    expect(await stockOf(bulk.id, s.store.id)).toBe(14.65);

    const movements = await prisma.stockMovement.findMany({ where: { saleId: res.body.id } });
    expect(movements).toHaveLength(2);
    expect(movements.every((m) => m.type === 'EXIT' && m.documentRef === 'Venda 1')).toBe(true);
  });

  it('numera as vendas em sequência', async () => {
    await basicSale().expect(201);
    const second = await basicSale();
    expect(second.body.number).toBe(2);
  });

  it('usa o preço do cadastro, ignorando qualquer preço enviado pelo navegador', async () => {
    const res = await sell({
      items: [{ productId: collar.id, quantity: 1, unitPriceCents: 1 }],
      payments: [{ method: 'PIX', amountCents: 3000 }],
    });
    expect(res.body.totalCents).toBe(3000);
  });

  it('aplica desconto e calcula o troco em dinheiro', async () => {
    const res = await sell({
      items: [{ productId: collar.id, quantity: 1 }],
      discountCents: 500,
      payments: [{ method: 'CASH', amountCents: 5000 }],
    });
    expect(res.body).toMatchObject({
      subtotalCents: 3000,
      discountCents: 500,
      totalCents: 2500,
      paidCents: 5000,
      changeCents: 2500,
    });
  });

  it('aceita pagamento dividido em duas formas', async () => {
    const res = await sell({
      items: [{ productId: collar.id, quantity: 2 }],
      payments: [
        { method: 'CASH', amountCents: 2000 },
        { method: 'CREDIT', amountCents: 4000 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.payments).toHaveLength(2);
  });

  it('recusa pagamento menor que o total e troco sem dinheiro', async () => {
    const menor = await sell({
      items: [{ productId: collar.id, quantity: 1 }],
      payments: [{ method: 'PIX', amountCents: 2000 }],
    });
    expect(menor.status).toBe(422);
    expect(menor.body.error.code).toBe('INSUFFICIENT_PAYMENT');

    const troco = await sell({
      items: [{ productId: collar.id, quantity: 1 }],
      payments: [{ method: 'CREDIT', amountCents: 5000 }],
    });
    expect(troco.status).toBe(422);
    expect(troco.body.error.code).toBe('INVALID_CHANGE');
  });

  it('sem estoque de um item, a venda inteira é recusada e diz qual produto faltou', async () => {
    const res = await sell({
      items: [
        { productId: bulk.id, quantity: 1 },
        { productId: collar.id, quantity: 6 },
      ],
      payments: [{ method: 'PIX', amountCents: 19790 }],
    });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/Coleira M: disponível 5/);
    expect(await stockOf(bulk.id, s.store.id)).toBe(15);
    expect(await prisma.sale.count()).toBe(0);
  });

  it('a venda dispara o alerta de estoque mínimo', async () => {
    const res = await sell({
      items: [{ productId: collar.id, quantity: 3 }],
      payments: [{ method: 'PIX', amountCents: 9000 }],
    });
    expect(res.body.alertsOpened).toBe(1);
    expect(await prisma.stockAlert.count({ where: { productId: collar.id, status: 'OPEN' } })).toBe(1);
  });

  it('produto sem preço não pode ser vendido; perfil de leitura não vende', async () => {
    await prisma.product.update({ where: { id: collar.id }, data: { priceCents: 0 } });
    const semPreco = await sell({
      items: [{ productId: collar.id, quantity: 1 }],
      payments: [{ method: 'PIX', amountCents: 1 }],
    });
    expect(semPreco.body.error.code).toBe('MISSING_PRICE');

    const leitura = await basicSale({}).set(s.viewer.auth);
    expect(leitura.status).toBe(403);
  });
});

describe('Cancelar venda', () => {
  it('devolve os itens ao estoque e mantém a venda no histórico', async () => {
    const { body: sale } = await basicSale();
    // Operador não cancela; gerente/admin sim, e com motivo.
    await api()
      .post(`/api/sales/${sale.id}/cancel`)
      .set(s.operator.auth)
      .send({ reason: 'Cliente desistiu' })
      .expect(403);
    await api().post(`/api/sales/${sale.id}/cancel`).set(s.admin.auth).send({}).expect(400);

    const res = await api().post(`/api/sales/${sale.id}/cancel`).set(s.admin.auth).send({ reason: 'Cliente desistiu' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'Cliente desistiu' });

    expect(await stockOf(collar.id, s.store.id)).toBe(5);
    expect(await stockOf(bulk.id, s.store.id)).toBe(15);
    expect(await prisma.stockMovement.count({ where: { saleId: sale.id, type: 'SALE_CANCEL' } })).toBe(2);

    const again = await api().post(`/api/sales/${sale.id}/cancel`).set(s.admin.auth).send({ reason: 'De novo' });
    expect(again.status).toBe(409);
  });
});

describe('Leitura no caixa', () => {
  const resolve = (code: string) =>
    api().get('/api/sales/resolve').query({ code, warehouseId: s.store.id }).set(s.operator.auth);

  it('código de barras de produto por unidade entra com quantidade 1', async () => {
    const res = await resolve('7891000100509');
    expect(res.body).toMatchObject({
      source: 'barcode',
      quantity: 1,
      product: { sku: 'COLEIRA', stock: 5, priceCents: 3000 },
    });
  });

  it('etiqueta da balança traz o produto e o peso', async () => {
    const res = await resolve(scaleLabel(123, 1250)); // 1,250 kg
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ source: 'scale', quantity: 1.25, product: { sku: 'RAC-GR' } });
  });

  it('etiqueta com preço: deduz o peso pelo preço por kg', async () => {
    await api().put('/api/settings').set(s.admin.auth).send({ scaleValueType: 'PRICE' }).expect(200);
    const res = await resolve(scaleLabel(123, 895)); // R$ 8,95 a R$ 17,90/kg
    expect(res.body).toMatchObject({ quantity: 0.5, labelTotalCents: 895 });
  });

  it('SKU digitado funciona; produto por peso sem etiqueta pede a quantidade', async () => {
    const res = await resolve('rac-gr');
    expect(res.body).toMatchObject({ source: 'sku', quantity: null });
  });

  it('código desconhecido e etiqueta de produto não cadastrado dão 404', async () => {
    expect((await resolve('0000000000000')).status).toBe(404);
    const res = await resolve(scaleLabel(999, 500));
    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/código de balança 999/);
  });

  it('parseScaleLabel valida prefixo e dígito verificador', () => {
    const config = { scalePrefix: '2', scaleCodeDigits: 6, scaleValueType: 'WEIGHT' };
    const label = scaleLabel(42, 350);
    expect(parseScaleLabel(label, config)).toEqual({ scaleCode: '42', weightKg: 0.35 });
    expect(parseScaleLabel(label.slice(0, 12) + ((Number(label[12]) + 1) % 10), config)).toBeNull();
    expect(parseScaleLabel('7891000100509', config)).toBeNull();
  });
});

describe('Relatório de vendas e configurações', () => {
  it('soma faturamento, lucro e formas de pagamento, sem as canceladas', async () => {
    await sell({
      items: [{ productId: collar.id, quantity: 1 }],
      payments: [{ method: 'CASH', amountCents: 5000 }],
    }).expect(201);
    await sell({
      items: [{ productId: bulk.id, quantity: 2 }],
      payments: [{ method: 'PIX', amountCents: 3580 }],
    }).expect(201);
    const { body: cancelled } = await sell({
      items: [{ productId: collar.id, quantity: 1 }],
      payments: [{ method: 'PIX', amountCents: 3000 }],
    });
    await api()
      .post(`/api/sales/${cancelled.id}/cancel`)
      .set(s.admin.auth)
      .send({ reason: 'Erro de lançamento' })
      .expect(200);

    const res = await api()
      .get('/api/reports/sales')
      .query({
        from: new Date(Date.now() - 3_600_000).toISOString(),
        to: new Date(Date.now() + 3_600_000).toISOString(),
      })
      .set(s.admin.auth);

    expect(res.status).toBe(200);
    expect(res.body.totals).toMatchObject({
      sales: 2,
      cancelled: 1,
      revenueCents: 6580,
      costCents: 3200,
      profitCents: 3380,
      averageTicketCents: 3290,
    });
    // O troco (R$ 20,00) não conta como dinheiro recebido.
    expect(res.body.byPayment).toEqual({ CASH: 3000, PIX: 3580 });
    expect(res.body.products[0]).toMatchObject({ name: 'Ração a granel', quantity: 2, profitCents: 1580 });
  });

  it('configurações da loja: padrões, edição por gerente e bloqueio para operador', async () => {
    const defaults = await api().get('/api/settings').set(s.operator.auth);
    expect(defaults.body).toMatchObject({ storeName: 'Minha loja', receiptWidth: 80, scaleValueType: 'WEIGHT' });

    await api().put('/api/settings').set(s.operator.auth).send({ storeName: 'Tentativa' }).expect(403);
    const res = await api()
      .put('/api/settings')
      .set(s.admin.auth)
      .send({ storeName: 'Pet Shop do Amigo', receiptWidth: 58 });
    expect(res.body).toMatchObject({ storeName: 'Pet Shop do Amigo', receiptWidth: 58 });
  });
});
