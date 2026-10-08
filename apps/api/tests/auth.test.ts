import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { api, createScenario, resetDatabase } from './helpers.js';

let s: Awaited<ReturnType<typeof createScenario>>;

beforeEach(async () => {
  await resetDatabase();
  s = await createScenario();
});

describe('Autenticação', () => {
  it('faz login e devolve token, usuário e permissões', async () => {
    const res = await api().post('/api/auth/login').send({ email: 'OPERATOR@teste.dev', password: 'Senha@123' });

    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).not.toHaveProperty('passwordHash');
    expect(res.body.permissions).toEqual(['stock:move', 'inventory:count', 'alerts:ack', 'sales:create']);
  });

  it('recusa senha errada com mensagem genérica', async () => {
    const res = await api().post('/api/auth/login').send({ email: 'operator@teste.dev', password: 'errada' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('E-mail ou senha inválidos');
  });

  it('exige token nas rotas protegidas', async () => {
    expect((await api().get('/api/products')).status).toBe(401);
    expect((await api().get('/api/products').set('Authorization', 'Bearer invalido')).status).toBe(401);
  });

  it('invalida a sessão de usuário desativado imediatamente', async () => {
    await prisma.user.update({ where: { id: s.operator.user.id }, data: { active: false } });
    const res = await api().get('/api/auth/me').set(s.operator.auth);
    expect(res.status).toBe(401);
  });
});

describe('Permissões por perfil', () => {
  it('operador movimenta estoque, mas não cadastra produtos', async () => {
    const create = await api().post('/api/products').set(s.operator.auth).send({ sku: 'NOVO', name: 'Novo produto' });
    expect(create.status).toBe(403);

    const move = await api()
      .post('/api/stock/entries')
      .set(s.operator.auth)
      .send({ productId: s.product.id, warehouseId: s.depot.id, quantity: 1 });
    expect(move.status).toBe(201);
  });

  it('perfil somente leitura não movimenta nem vê relatórios', async () => {
    const move = await api()
      .post('/api/stock/entries')
      .set(s.viewer.auth)
      .send({ productId: s.product.id, warehouseId: s.depot.id, quantity: 1 });
    expect(move.status).toBe(403);

    expect((await api().get('/api/reports/stock-position').set(s.viewer.auth)).status).toBe(403);
    expect((await api().get('/api/reports/stock-position').set(s.operator.auth)).status).toBe(403);
    expect((await api().get('/api/reports/stock-position').set(s.admin.auth)).status).toBe(200);
  });

  it('apenas administradores gerenciam usuários', async () => {
    expect((await api().get('/api/users').set(s.operator.auth)).status).toBe(403);
    expect((await api().get('/api/users').set(s.admin.auth)).status).toBe(200);
  });

  it('administrador não consegue desativar a si mesmo', async () => {
    const res = await api().patch(`/api/users/${s.admin.user.id}`).set(s.admin.auth).send({ active: false });
    expect(res.status).toBe(422);
  });
});
