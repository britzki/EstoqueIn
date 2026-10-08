import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { api, createScenario, createUser, resetDatabase, stockOf } from './helpers.js';

let s: Awaited<ReturnType<typeof createScenario>>;
let food: { id: string };
let treat: { id: string };
let maria: { id: string };

const address = { street: 'Rua das Flores', number: '120', district: 'Centro', reference: 'Portão azul' };

// Ração R$ 100, petisco R$ 10. Regra padrão: taxa de R$ 5,00 abaixo de R$ 40,00, prazo de 2 horas.
beforeEach(async () => {
  await resetDatabase();
  s = await createScenario();
  food = await prisma.product.create({
    data: { sku: 'RACAO', name: 'Ração 10kg', priceCents: 10000, costCents: 6000 },
  });
  treat = await prisma.product.create({ data: { sku: 'PETISCO', name: 'Petisco', priceCents: 1000, costCents: 400 } });
  await prisma.stockLevel.createMany({
    data: [
      { productId: food.id, warehouseId: s.store.id, quantity: 10 },
      { productId: treat.id, warehouseId: s.store.id, quantity: 40 },
    ],
  });
  maria = await prisma.customer.create({ data: { name: 'Maria', phone: '11987654321' } });
  await prisma.cashSession.create({
    data: { number: 1, warehouseId: s.store.id, openedById: s.operator.user.id, openingCents: 10000 },
  });
});

const sell = (items: object[], payments: object[], extra: object = {}) =>
  api()
    .post('/api/sales')
    .set(s.operator.auth)
    .send({ warehouseId: s.store.id, items, payments, customerId: maria.id, ...extra });

describe('Venda para entrega', () => {
  it('cobra a taxa abaixo do valor mínimo, salva o endereço e cria a entrega numerada', async () => {
    const { body: sale } = await sell([{ productId: treat.id, quantity: 2 }], [{ method: 'CASH', amountCents: 5000 }], {
      delivery: { address, collectOnDelivery: true },
    }).expect(201);

    expect(sale.deliveryFeeCents).toBe(500);
    expect(sale.totalCents).toBe(2500);
    expect(sale.changeCents).toBe(2500);
    expect(sale.delivery).toMatchObject({
      number: 1,
      status: 'PENDING',
      street: 'Rua das Flores',
      reference: 'Portão azul',
      phone: '11987654321',
      feeCents: 500,
      collectOnDelivery: true,
      scheduled: false,
    });
    const minutes = (new Date(sale.delivery.dueAt).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(118);
    expect(minutes).toBeLessThanOrEqual(120);

    // O endereço novo fica no cadastro para a próxima vez.
    const { body: saved } = await api().get(`/api/customers/${maria.id}/addresses`).set(s.operator.auth).expect(200);
    expect(saved).toHaveLength(1);

    const { body: next } = await sell([{ productId: food.id, quantity: 1 }], [{ method: 'PIX', amountCents: 10000 }], {
      delivery: { addressId: saved[0].id },
    }).expect(201);
    expect(next.deliveryFeeCents).toBe(0); // acima de R$ 40,00: grátis
    expect(next.delivery.number).toBe(2);
    expect(await prisma.customerAddress.count()).toBe(1);
  });

  it('a taxa olha o valor com desconto, pode ser dispensada e segue as configurações', async () => {
    const withDiscount = await sell([{ productId: treat.id, quantity: 4 }], [{ method: 'PIX', amountCents: 4000 }], {
      discountCents: 500,
      delivery: { address },
    }).expect(201);
    expect(withDiscount.body.deliveryFeeCents).toBe(500); // R$ 35,00 de produtos
    expect(withDiscount.body.totalCents).toBe(4000);

    const waived = await sell([{ productId: treat.id, quantity: 1 }], [{ method: 'PIX', amountCents: 1000 }], {
      delivery: { address, waiveFee: true },
    }).expect(201);
    expect(waived.body.deliveryFeeCents).toBe(0);

    await api()
      .put('/api/settings')
      .set(s.admin.auth)
      .send({ deliveryFeeCents: 800, deliveryFreeAboveCents: 6000, deliveryDeadlineMinutes: 60 })
      .expect(200);
    const custom = await sell([{ productId: treat.id, quantity: 5 }], [{ method: 'PIX', amountCents: 5800 }], {
      delivery: { address },
    }).expect(201);
    expect(custom.body.deliveryFeeCents).toBe(800);
    const minutes = (new Date(custom.body.delivery.dueAt).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeLessThanOrEqual(60);
  });

  it('agenda para outro dia e recusa horário que já passou', async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const { body } = await sell([{ productId: food.id, quantity: 1 }], [{ method: 'PIX', amountCents: 10000 }], {
      delivery: { address, scheduledFor: tomorrow.toISOString() },
    }).expect(201);
    expect(body.delivery.scheduled).toBe(true);
    expect(new Date(body.delivery.dueAt).getTime()).toBe(tomorrow.getTime());

    await sell([{ productId: food.id, quantity: 1 }], [{ method: 'PIX', amountCents: 10000 }], {
      delivery: { address, scheduledFor: new Date(Date.now() - 60 * 60_000).toISOString() },
    }).expect(422);
  });

  it('exige cliente e endereço; endereço de outro cliente não vale', async () => {
    const noCustomer = await api()
      .post('/api/sales')
      .set(s.operator.auth)
      .send({
        warehouseId: s.store.id,
        items: [{ productId: food.id, quantity: 1 }],
        payments: [{ method: 'PIX', amountCents: 10000 }],
        delivery: { address },
      })
      .expect(422);
    expect(noCustomer.body.error?.code ?? noCustomer.body.code).toBe('DELIVERY_NEEDS_CUSTOMER');

    await sell([{ productId: food.id, quantity: 1 }], [{ method: 'PIX', amountCents: 10000 }], {
      delivery: {},
    }).expect(400);

    const joao = await prisma.customer.create({ data: { name: 'João' } });
    const other = await prisma.customerAddress.create({ data: { ...address, customerId: joao.id } });
    await sell([{ productId: food.id, quantity: 1 }], [{ method: 'PIX', amountCents: 10000 }], {
      delivery: { addressId: other.id },
    }).expect(404);
    // Nada foi gravado nas tentativas que falharam.
    expect(await prisma.sale.count()).toBe(0);
    expect(await stockOf(food.id, s.store.id)).toBe(10);
  });
});

describe('Painel de entregas', () => {
  it('separar → saiu com o entregador → entregue, com acerto do entregador', async () => {
    const { body: courier } = await api()
      .post('/api/couriers')
      .set(s.admin.auth)
      .send({ name: 'Zé Motoboy', phone: '(11) 91234-5678', feePerDeliveryCents: 700 })
      .expect(201);
    await api().post('/api/couriers').set(s.operator.auth).send({ name: 'Outro' }).expect(403);

    const { body: sale } = await sell([{ productId: treat.id, quantity: 2 }], [{ method: 'CASH', amountCents: 5000 }], {
      delivery: { address, collectOnDelivery: true },
    }).expect(201);
    const id = sale.delivery.id;

    const { body: open } = await api().get('/api/deliveries').set(s.operator.auth).expect(200);
    expect(open).toHaveLength(1);
    expect(open[0].sale).toMatchObject({ number: sale.number, totalCents: 2500, changeCents: 2500 });
    expect(open[0].sale.costCents).toBeUndefined();

    const { body: out } = await api()
      .post(`/api/deliveries/${id}/dispatch`)
      .set(s.operator.auth)
      .send({ courierId: courier.id })
      .expect(200);
    expect(out).toMatchObject({ status: 'OUT', courier: { name: 'Zé Motoboy' } });
    await api().post(`/api/deliveries/${id}/dispatch`).set(s.operator.auth).send({}).expect(409);

    const { body: done } = await api().post(`/api/deliveries/${id}/deliver`).set(s.operator.auth).expect(200);
    expect(done.status).toBe('DELIVERED');
    expect(done.finishedAt).toBeTruthy();
    await api().post(`/api/deliveries/${id}/fail`).set(s.operator.auth).send({ reason: 'Teste' }).expect(409);

    const from = new Date(Date.now() - 60 * 60_000).toISOString();
    const to = new Date(Date.now() + 60 * 60_000).toISOString();
    const report = `/api/deliveries/couriers-report?from=${from}&to=${to}`;
    await api().get(report).set(s.operator.auth).expect(403);
    const { body: rows } = await api().get(report).set(s.admin.auth).expect(200);
    expect(rows).toEqual([
      {
        courier: { id: courier.id, name: 'Zé Motoboy', feePerDeliveryCents: 700 },
        deliveries: 1,
        feesChargedCents: 500,
        collectedCents: 2500,
        toPayCents: 700,
      },
    ]);
  });

  it('não entregue volta para o painel; cancelar a venda devolve o estoque e cancela a entrega', async () => {
    const manager = await createUser('MANAGER');
    const { body: sale } = await sell([{ productId: food.id, quantity: 1 }], [{ method: 'PIX', amountCents: 10000 }], {
      delivery: { address },
    }).expect(201);
    const id = sale.delivery.id;
    await api().post(`/api/deliveries/${id}/dispatch`).set(s.operator.auth).send({}).expect(200);
    const { body: failed } = await api()
      .post(`/api/deliveries/${id}/fail`)
      .set(s.operator.auth)
      .send({ reason: 'Cliente ausente' })
      .expect(200);
    expect(failed).toMatchObject({ status: 'FAILED', failReason: 'Cliente ausente' });
    expect((await api().get('/api/deliveries').set(s.operator.auth)).body).toHaveLength(1);

    expect(await stockOf(food.id, s.store.id)).toBe(9);
    const { body: cancelled } = await api()
      .post(`/api/sales/${sale.id}/cancel`)
      .set(manager.auth)
      .send({ reason: 'Cliente desistiu' })
      .expect(200);
    expect(cancelled.delivery.status).toBe('CANCELLED');
    expect(await stockOf(food.id, s.store.id)).toBe(10);
    await api().post(`/api/deliveries/${id}/dispatch`).set(s.operator.auth).send({}).expect(409);
  });

  it('devolução de item não devolve a taxa de entrega', async () => {
    const { body: sale } = await sell([{ productId: treat.id, quantity: 2 }], [{ method: 'PIX', amountCents: 2500 }], {
      delivery: { address },
    }).expect(201);
    const { body: ret } = await api()
      .post(`/api/sales/${sale.id}/returns`)
      .set(s.admin.auth)
      .send({ items: [{ saleItemId: sale.items[0].id, quantity: 2 }], reason: 'Avariado', refundMethod: 'PIX' })
      .expect(201);
    expect(ret.refundCents).toBe(2000);
  });
});

describe('Endereços do cliente', () => {
  it('cadastra, altera e apaga; a entrega guarda a cópia do endereço', async () => {
    const base = `/api/customers/${maria.id}/addresses`;
    const { body: created } = await api()
      .post(base)
      .set(s.operator.auth)
      .send({ ...address, label: 'Casa' })
      .expect(201);
    await api().post(base).set(s.operator.auth).send({ street: 'X' }).expect(400);
    await api().post(base).set(s.viewer.auth).send(address).expect(403);

    const { body: sale } = await sell([{ productId: food.id, quantity: 1 }], [{ method: 'PIX', amountCents: 10000 }], {
      delivery: { addressId: created.id },
    }).expect(201);

    await api().patch(`${base}/${created.id}`).set(s.operator.auth).send({ number: '999' }).expect(200);
    await api().delete(`${base}/${created.id}`).set(s.operator.auth).expect(204);

    const { body: delivery } = await api().get(`/api/deliveries/${sale.delivery.id}`).set(s.operator.auth).expect(200);
    expect(delivery.addressNumber).toBe('120');
    const { body: detail } = await api().get(`/api/customers/${maria.id}`).set(s.operator.auth).expect(200);
    expect(detail.addresses).toEqual([]);
  });
});
