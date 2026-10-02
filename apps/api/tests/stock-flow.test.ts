import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { domainEvents } from '../src/lib/events.js';
import { api, createScenario, resetDatabase, stockOf } from './helpers.js';

let s: Awaited<ReturnType<typeof createScenario>>;

beforeEach(async () => {
  await resetDatabase();
  s = await createScenario();
});

const entry = (quantity: number, extra: Record<string, unknown> = {}) =>
  api()
    .post('/api/stock/entries')
    .set(s.operator.auth)
    .send({ productId: s.product.id, warehouseId: s.depot.id, quantity, ...extra });

const exit = (quantity: number, warehouseId = s.depot.id) =>
  api()
    .post('/api/stock/exits')
    .set(s.operator.auth)
    .send({ productId: s.product.id, warehouseId, quantity, reason: 'Venda' });

describe('Fluxo principal: entrada → saldo → estoque mínimo → alerta', () => {
  it('registra a entrada, atualiza o saldo e grava o histórico', async () => {
    const res = await entry(50, { supplierId: s.supplier.id, documentRef: 'NF 123', unitCostCents: 1500 });

    expect(res.status).toBe(201);
    expect(res.body.balance).toBe(50);
    expect(res.body.alert.kind).toBe('none');
    expect(await stockOf(s.product.id, s.depot.id)).toBe(50);

    const movements = await prisma.stockMovement.findMany();
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ type: 'ENTRY', quantity: 50, balanceAfter: 50, documentRef: 'NF 123' });
  });

  it('abre alerta LOW_STOCK quando a saída deixa o saldo no mínimo ou abaixo', async () => {
    await entry(30);
    const res = await exit(20); // saldo 10 = mínimo

    expect(res.body.balance).toBe(10);
    expect(res.body.alert.kind).toBe('opened');
    expect(res.body.alert.alert).toMatchObject({ type: 'LOW_STOCK', status: 'OPEN', quantity: 10, threshold: 10 });
  });

  it('escala o alerta para OUT_OF_STOCK quando o saldo zera, sem duplicar alertas', async () => {
    await entry(15);
    await exit(10);
    const res = await exit(5);

    expect(res.body.alert.kind).toBe('escalated');
    const alerts = await prisma.stockAlert.findMany();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: 'OUT_OF_STOCK', status: 'OPEN', quantity: 0 });
  });

  it('resolve o alerta automaticamente quando a reposição supera o mínimo', async () => {
    await entry(12);
    await exit(5); // saldo 7 → alerta
    const res = await entry(20); // saldo 27 → resolve

    expect(res.body.alert.kind).toBe('resolved');
    const alert = await prisma.stockAlert.findFirstOrThrow();
    expect(alert.status).toBe('RESOLVED');
    expect(alert.resolvedAt).not.toBeNull();
  });

  it('publica o evento alert.opened somente depois de confirmar a transação', async () => {
    const listener = vi.fn();
    domainEvents.on('alert.opened', listener);

    await entry(11);
    await exit(2);

    expect(listener).toHaveBeenCalledTimes(1);
    const { alertId } = listener.mock.calls[0][0];
    expect(await prisma.stockAlert.findUnique({ where: { id: alertId } })).not.toBeNull();
    domainEvents.off('alert.opened', listener);
  });

  it('respeita o mínimo específico do estoque quando definido', async () => {
    await prisma.stockLevel.create({
      data: { productId: s.product.id, warehouseId: s.depot.id, quantity: 0, minQuantity: 40 },
    });
    const res = await entry(30);

    expect(res.body.alert.kind).toBe('opened');
    expect(res.body.alert.alert.threshold).toBe(40);
  });
});

describe('Regras de saída e transferência', () => {
  it('bloqueia saída maior que o saldo (422) sem gravar movimentação', async () => {
    await entry(5);
    const res = await exit(6);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.error.details).toEqual({ available: 5, requested: 6 });
    expect(await stockOf(s.product.id, s.depot.id)).toBe(5);
    expect(await prisma.stockMovement.count()).toBe(1);
  });

  it('transfere entre estoques com duas pernas ligadas pelo mesmo transferId', async () => {
    await entry(40);
    const res = await api()
      .post('/api/stock/transfers')
      .set(s.operator.auth)
      .send({ productId: s.product.id, fromWarehouseId: s.depot.id, toWarehouseId: s.store.id, quantity: 15 });

    expect(res.status).toBe(201);
    expect(await stockOf(s.product.id, s.depot.id)).toBe(25);
    expect(await stockOf(s.product.id, s.store.id)).toBe(15);

    const legs = await prisma.stockMovement.findMany({ where: { transferId: res.body.transferId } });
    expect(legs.map((leg) => leg.type).sort()).toEqual(['TRANSFER_IN', 'TRANSFER_OUT']);
  });

  it('desfaz a transferência inteira se a origem não tiver saldo', async () => {
    const res = await api()
      .post('/api/stock/transfers')
      .set(s.operator.auth)
      .send({ productId: s.product.id, fromWarehouseId: s.depot.id, toWarehouseId: s.store.id, quantity: 1 });

    expect(res.status).toBe(422);
    expect(await stockOf(s.product.id, s.store.id)).toBe(0);
    expect(await prisma.stockMovement.count()).toBe(0);
  });

  it('recalcula o custo médio ponderado a cada entrada com custo', async () => {
    await entry(10, { unitCostCents: 1000 });
    await entry(30, { unitCostCents: 2000 });

    const product = await prisma.product.findUniqueOrThrow({ where: { id: s.product.id } });
    expect(product.costCents).toBe(1750); // (10×10 + 30×20) / 40
  });

  it('ajuste manual define o saldo informado e exige motivo', async () => {
    await entry(20);
    const semMotivo = await api()
      .post('/api/stock/adjustments')
      .set(s.admin.auth)
      .send({ productId: s.product.id, warehouseId: s.depot.id, newQuantity: 18 });
    expect(semMotivo.status).toBe(400);

    const res = await api()
      .post('/api/stock/adjustments')
      .set(s.admin.auth)
      .send({ productId: s.product.id, warehouseId: s.depot.id, newQuantity: 18, reason: 'Quebra na conferência' });
    expect(res.status).toBe(201);
    expect(res.body.movement).toMatchObject({ type: 'ADJUSTMENT', quantity: -2, balanceAfter: 18 });
  });
});
