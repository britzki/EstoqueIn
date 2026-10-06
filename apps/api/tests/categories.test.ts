import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { api, createScenario, resetDatabase } from './helpers.js';

let s: Awaited<ReturnType<typeof createScenario>>;

beforeEach(async () => {
  await resetDatabase();
  s = await createScenario();
  await prisma.product.createMany({
    data: [
      { sku: 'R1', name: 'Ração A', category: 'Rações' },
      { sku: 'R2', name: 'Ração B', category: 'Racao' },
      { sku: 'R3', name: 'Ração C', category: 'Racao', active: false },
      { sku: 'P1', name: 'Petisco', category: 'Petiscos' },
    ],
  });
});

const summary = async () => (await api().get('/api/products/categories/summary').set(s.viewer.auth)).body;

describe('Gerenciar categorias', () => {
  it('lista as categorias com a quantidade de produtos', async () => {
    expect(await summary()).toEqual([
      { name: 'Petiscos', active: 1, inactive: 0, loyaltyRules: [] },
      { name: 'Racao', active: 1, inactive: 1, loyaltyRules: [] },
      { name: 'Rações', active: 1, inactive: 0, loyaltyRules: [] },
    ]);
  });

  it('renomear para uma categoria que já existe junta as duas, inclusive no cartão fidelidade', async () => {
    const treat = await prisma.product.findFirstOrThrow({ where: { sku: 'P1' } });
    await prisma.loyaltyRule.create({
      data: { name: 'Ração 10 + 1', category: 'Racao', requiredQuantity: 10, rewardProductId: treat.id },
    });
    await api()
      .post('/api/products/categories/rename')
      .set(s.operator.auth)
      .send({ from: 'Racao', to: 'Rações' })
      .expect(403);

    const res = await api()
      .post('/api/products/categories/rename')
      .set(s.admin.auth)
      .send({ from: 'Racao', to: 'Rações' });
    expect(res.body).toEqual({ products: 2, loyaltyRules: 1, merged: true });
    expect((await summary()).map((c: { name: string }) => c.name)).toEqual(['Petiscos', 'Rações']);
    expect((await prisma.loyaltyRule.findFirstOrThrow()).category).toBe('Rações');
    const audit = await prisma.auditLog.findFirst({ where: { entity: 'Category' } });
    expect(audit?.summary).toBe('Categoria "Racao" juntada a "Rações" (2 produto(s))');
  });

  it('renomeia e remove; não remove categoria usada por cartão fidelidade', async () => {
    const renamed = await api()
      .post('/api/products/categories/rename')
      .set(s.admin.auth)
      .send({ from: 'Petiscos', to: 'Snacks' });
    expect(renamed.body.merged).toBe(false);
    await api()
      .post('/api/products/categories/rename')
      .set(s.admin.auth)
      .send({ from: 'Inexistente', to: 'X' })
      .expect(404);

    const treat = await prisma.product.findFirstOrThrow({ where: { sku: 'P1' } });
    await prisma.loyaltyRule.create({
      data: { name: 'Cartão', category: 'Rações', requiredQuantity: 5, rewardProductId: treat.id },
    });
    const blocked = await api().post('/api/products/categories/remove').set(s.admin.auth).send({ category: 'Rações' });
    expect(blocked.body.error.code).toBe('CATEGORY_IN_USE');

    const removed = await api().post('/api/products/categories/remove').set(s.admin.auth).send({ category: 'Racao' });
    expect(removed.body).toEqual({ products: 2 });
    expect(await prisma.product.count({ where: { category: null } })).toBeGreaterThanOrEqual(2);
  });
});
