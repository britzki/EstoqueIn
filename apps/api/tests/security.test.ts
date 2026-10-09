import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { resetAdminPassword } from '../src/modules/users/recovery.js';
import { api, createScenario, resetDatabase, stockOf } from './helpers.js';

let s: Awaited<ReturnType<typeof createScenario>>;

beforeEach(async () => {
  await resetDatabase();
  s = await createScenario();
});

const login = (email: string, password: string) => api().post('/api/auth/login').send({ email, password });
const audit = (query: object = {}) => api().get('/api/audit').query(query).set(s.admin.auth);

describe('Recuperação de acesso do administrador', () => {
  it('gera senha temporária, exige a troca no primeiro acesso e registra o evento', async () => {
    const { email, temporaryPassword } = await resetAdminPassword();
    expect(email).toBe('admin@teste.dev');
    expect(temporaryPassword).toMatch(/^[A-Za-z2-9]{10}$/);

    // A senha antiga deixa de valer; a temporária entra, mas só para trocar a senha.
    expect((await login(email, 'Senha@123')).status).toBe(401);
    const session = await login(email, temporaryPassword);
    expect(session.body.mustChangePassword).toBe(true);
    const auth = { Authorization: `Bearer ${session.body.token}` };

    const blocked = await api().get('/api/products').set(auth);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const changed = await api()
      .post('/api/auth/change-password')
      .set(auth)
      .send({ currentPassword: temporaryPassword, newPassword: 'novaSenhaForte1' });
    expect(changed.status).toBe(200);
    expect(changed.body.mustChangePassword).toBe(false);
    // A troca encerra as sessões antigas; quem trocou continua com o token novo.
    expect((await api().get('/api/products').set(auth)).status).toBe(401);
    const renewed = { Authorization: `Bearer ${changed.body.token}` };
    expect((await api().get('/api/products').set(renewed)).status).toBe(200);
    expect((await login(email, 'novaSenhaForte1')).status).toBe(200);

    const log = await prisma.auditLog.findMany({ where: { action: 'SECURITY' }, orderBy: { createdAt: 'asc' } });
    expect(log.map((entry) => entry.summary)).toEqual([
      expect.stringMatching(/redefinida pelo menu do programa/),
      expect.stringMatching(/trocou a própria senha/),
    ]);
    // A senha nunca aparece no registro.
    expect(JSON.stringify(log)).not.toContain(temporaryPassword);
  });

  it('reativa o administrador se todos estiverem desativados', async () => {
    await prisma.user.updateMany({ where: { role: 'ADMIN' }, data: { active: false } });
    const { email, temporaryPassword } = await resetAdminPassword();
    expect((await login(email, temporaryPassword)).status).toBe(200);
  });
});

describe('Troca de senha', () => {
  it('exige a senha atual correta e uma senha nova diferente', async () => {
    const wrong = await api()
      .post('/api/auth/change-password')
      .set(s.operator.auth)
      .send({ currentPassword: 'errada', newPassword: 'outraSenha123' });
    expect(wrong.body.error.code).toBe('WRONG_PASSWORD');

    const same = await api()
      .post('/api/auth/change-password')
      .set(s.operator.auth)
      .send({ currentPassword: 'Senha@123', newPassword: 'Senha@123' });
    expect(same.body.error.code).toBe('SAME_PASSWORD');
  });

  it('senha definida pelo administrador para outro usuário é temporária', async () => {
    await api()
      .patch(`/api/users/${s.operator.user.id}`)
      .set(s.admin.auth)
      .send({ password: 'temporaria123' })
      .expect(200);
    const session = await login('operator@teste.dev', 'temporaria123');
    expect(session.body.mustChangePassword).toBe(true);
  });
});

describe('Registro de alterações', () => {
  it('guarda quem alterou o preço de um produto, com o valor antigo e o novo', async () => {
    await api()
      .patch(`/api/products/${s.product.id}`)
      .set(s.admin.auth)
      .send({ priceCents: 2590, minStock: 10 })
      .expect(200);

    const res = await audit({ entity: 'Product', entityId: s.product.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      action: 'UPDATE',
      userName: 'Usuário ADMIN',
      summary: 'Produto Café 500g (CAF-500) alterado',
      // minStock foi enviado com o mesmo valor: não entra como alteração.
      changes: { priceCents: { from: 0, to: 2590 } },
    });
  });

  it('não registra quando nada mudou', async () => {
    await api().patch(`/api/products/${s.product.id}`).set(s.admin.auth).send({ name: 'Café 500g' }).expect(200);
    expect((await audit()).body.total).toBe(0);
  });

  it('registra cadastros, usuários, configurações e cancelamento de venda', async () => {
    await api().post('/api/suppliers').set(s.admin.auth).send({ name: 'Fornecedor Novo' }).expect(201);
    await api().patch(`/api/users/${s.operator.user.id}`).set(s.admin.auth).send({ role: 'MANAGER' }).expect(200);
    await api().put('/api/settings').set(s.admin.auth).send({ storeName: 'Pet Shop' }).expect(200);

    await prisma.product.update({ where: { id: s.product.id }, data: { priceCents: 1000 } });
    await prisma.stockLevel.create({ data: { productId: s.product.id, warehouseId: s.store.id, quantity: 5 } });
    await prisma.cashSession.create({
      data: { number: 1, warehouseId: s.store.id, openedById: s.operator.user.id, openingCents: 0 },
    });
    const { body: sale } = await api()
      .post('/api/sales')
      .set(s.operator.auth)
      .send({
        warehouseId: s.store.id,
        items: [{ productId: s.product.id, quantity: 1 }],
        payments: [{ method: 'PIX', amountCents: 1000 }],
      });
    await api()
      .post(`/api/sales/${sale.id}/cancel`)
      .set(s.admin.auth)
      .send({ reason: 'Erro de lançamento' })
      .expect(200);

    const res = await audit();
    const summaries = res.body.data.map((entry: { summary: string }) => entry.summary);
    expect(summaries).toEqual([
      'Venda nº 1 cancelada: Erro de lançamento',
      'Configurações da loja alteradas',
      'Usuário Usuário OPERATOR alterado',
      'Fornecedor Fornecedor Novo cadastrado',
    ]);
    expect(res.body.data[2].changes).toEqual({ role: { from: 'OPERATOR', to: 'MANAGER' } });
  });

  it('só administrador e gerente consultam o registro', async () => {
    expect((await api().get('/api/audit').set(s.operator.auth)).status).toBe(403);
    expect((await api().get('/api/audit').set(s.viewer.auth)).status).toBe(403);
  });
});

describe('Importação de planilha com saldo', () => {
  const csv = (lines: string[]) => Buffer.from(lines.join('\n'), 'utf-8');
  const file = csv([
    'sku;nome;unidade;preco_custo;preco_venda;saldo;fracionado;codigo_balanca',
    'COL-M;Coleira M;UN;15,00;34,90;12;;',
    'RAC-GR;Ração a granel;KG;10,00;17,90;12,5;sim;123',
    'CAF-500;Café 500g;UN;;;7;;',
    'ERRO;Produto por unidade;UN;;;2,5;;',
  ]);
  const upload = (query: object) =>
    api().post('/api/products/import').query(query).set(s.admin.auth).attach('file', file, 'p.csv');

  it('pede o estoque quando a planilha traz saldo', async () => {
    const res = await upload({ dryRun: true });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/escolha em qual estoque/);
  });

  it('cria os produtos, lança os saldos e registra a importação', async () => {
    await prisma.stockLevel.create({ data: { productId: s.product.id, warehouseId: s.store.id, quantity: 20 } });

    const preview = await upload({ dryRun: true, warehouseId: s.store.id });
    expect(preview.body).toMatchObject({ created: 2, updated: 1, stockRows: 3 });
    expect(preview.body.errors).toHaveLength(1);
    expect(preview.body.errors[0].message).toMatch(/casas decimais/);
    expect(await prisma.product.count()).toBe(1);

    await upload({ warehouseId: s.store.id }).expect(201);

    const bulk = await prisma.product.findUniqueOrThrow({ where: { sku: 'RAC-GR' } });
    expect(bulk).toMatchObject({ fractional: true, scaleCode: '123', costCents: 1000 });
    expect(await stockOf(bulk.id, s.store.id)).toBe(12.5);
    const collar = await prisma.product.findUniqueOrThrow({ where: { sku: 'COL-M' } });
    expect(await stockOf(collar.id, s.store.id)).toBe(12);
    // Produto existente: o saldo é ajustado para o valor da planilha (20 → 7).
    expect(await stockOf(s.product.id, s.store.id)).toBe(7);

    const adjustments = await prisma.stockMovement.findMany({ where: { type: 'ADJUSTMENT' } });
    expect(adjustments).toHaveLength(3);
    expect(adjustments.every((m) => m.reason === 'Saldo informado na importação de planilha')).toBe(true);

    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'IMPORT' } });
    expect(log.summary).toBe(
      'Importação de planilha: 2 produto(s) criado(s), 1 atualizado(s), 3 saldo(s) informado(s)',
    );
  });
});

describe('Sessões depois de trocar a senha', () => {
  it('senha redefinida pelo administrador derruba as sessões abertas do usuário', async () => {
    const operator = await prisma.user.findFirstOrThrow({ where: { role: 'OPERATOR' } });
    const session = await login(operator.email, 'Senha@123');
    const auth = { Authorization: `Bearer ${session.body.token}` };
    expect((await api().get('/api/auth/me').set(auth)).status).toBe(200);

    const admin = await login('admin@teste.dev', 'Senha@123');
    await api()
      .patch(`/api/users/${operator.id}`)
      .set({ Authorization: `Bearer ${admin.body.token}` })
      .send({ password: 'OutraSenha@1' })
      .expect(200);
    expect((await api().get('/api/auth/me').set(auth)).status).toBe(401);
    expect((await login(operator.email, 'OutraSenha@1')).status).toBe(200);
  });
});
