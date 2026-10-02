import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { backupDatabase, isSqliteFile } from '../src/desktop/database.js';
import { api, createUser, resetDatabase } from './helpers.js';

beforeEach(resetDatabase);

describe('Configuração inicial (primeira execução)', () => {
  it('indica que precisa de configuração quando não há usuários', async () => {
    const res = await api().get('/api/setup/status');
    expect(res.body).toEqual({ needsSetup: true, demoAccounts: [] });
  });

  it('cria o administrador e o estoque principal e já devolve a sessão', async () => {
    const res = await api()
      .post('/api/setup')
      .send({ mode: 'fresh', name: 'Maria Souza', email: 'Maria@Loja.com', password: 'senhaSegura1' });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'maria@loja.com', role: 'ADMIN' });
    expect(res.body.permissions).toContain('users:manage');

    const me = await api().get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
    expect(me.status).toBe(200);
    expect(await prisma.warehouse.findMany()).toMatchObject([{ name: 'Estoque principal' }]);
  });

  it('não permite configurar de novo depois que existe um usuário', async () => {
    await createUser('ADMIN');
    const res = await api()
      .post('/api/setup')
      .send({ mode: 'fresh', name: 'Invasor', email: 'x@x.com', password: 'qualquer123' });

    expect(res.status).toBe(409);
    expect((await api().get('/api/setup/status')).body.needsSetup).toBe(false);
  });

  it('valida os dados do administrador', async () => {
    const res = await api().post('/api/setup').send({ mode: 'fresh', name: 'A', email: 'invalido', password: '123' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.details)).toEqual(expect.arrayContaining(['name', 'email', 'password']));
  });
});

describe('Backup do banco (desktop)', () => {
  it('gera uma cópia SQLite válida com os dados atuais', async () => {
    await createUser('ADMIN');
    const dir = mkdtempSync(join(tmpdir(), 'estoquein-'));
    const file = join(dir, 'backup.db');
    try {
      await backupDatabase(file);
      expect(isSqliteFile(file)).toBe(true);

      writeFileSync(join(dir, 'falso.db'), 'não sou um banco');
      expect(isSqliteFile(join(dir, 'falso.db'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
