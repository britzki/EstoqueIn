import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { backupDatabase, checkBackupFile } from '../src/desktop/database.js';

const migrationsDir = join(import.meta.dirname, '..', 'prisma', 'migrations');
const dir = mkdtempSync(join(tmpdir(), 'estoquein-backup-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Copia o banco de testes e marca as migrations como aplicadas, como num banco do programa instalado. */
async function backupWithMigrations(name: string, migrations: string[]) {
  const file = join(dir, name);
  await backupDatabase(file);
  await prisma.$executeRawUnsafe('ATTACH DATABASE ? AS copy', file);
  try {
    await prisma.$executeRawUnsafe(
      'CREATE TABLE copy."_stockflow_migrations" ("name" TEXT PRIMARY KEY, "appliedAt" DATETIME NOT NULL)',
    );
    for (const migration of migrations) {
      await prisma.$executeRawUnsafe(
        'INSERT INTO copy."_stockflow_migrations" ("name", "appliedAt") VALUES (?, ?)',
        migration,
        new Date().toISOString(),
      );
    }
  } finally {
    await prisma.$executeRawUnsafe('DETACH DATABASE copy');
  }
  return file;
}

describe('Conferência do backup antes de restaurar', () => {
  const known = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  it('aceita um backup do EstoqueIn desta versão', async () => {
    expect(await checkBackupFile(await backupWithMigrations('ok.db', known), migrationsDir)).toBeNull();
  });

  it('recusa arquivo que não é banco, banco de outro programa e backup de versão mais nova', async () => {
    const text = join(dir, 'texto.db');
    writeFileSync(text, 'não sou um banco');
    expect(await checkBackupFile(text, migrationsDir)).toContain('não é um backup');

    const foreign = join(dir, 'outro.db');
    await backupDatabase(foreign);
    expect(await checkBackupFile(foreign, migrationsDir)).toContain('não é um backup');

    const newer = await backupWithMigrations('nova.db', [...known, '20991231000000_futuro']);
    expect(await checkBackupFile(newer, migrationsDir)).toContain('versão mais nova');
  });
});
