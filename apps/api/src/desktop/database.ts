import {
  copyFileSync,
  existsSync,
  openSync,
  readSync,
  closeSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { prisma } from '../lib/prisma.js';

/**
 * Ajustes do SQLite para uso desktop (um usuário, disco local):
 * WAL deixa leituras e escritas mais rápidas e o banco mais resistente a quedas de energia.
 */
export async function configureSqlite() {
  await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL');
  await prisma.$executeRawUnsafe('PRAGMA synchronous = NORMAL');
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
}

// O nome antigo do produto é mantido aqui de propósito: bancos já instalados usam esta tabela.
const MIGRATIONS_TABLE = '_stockflow_migrations';

/** Separa um arquivo de migration em instruções, ignorando comentários. */
function splitStatements(sql: string) {
  return sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/**
 * Aplica as migrations geradas pelo Prisma (prisma/migrations/*) que ainda não rodaram.
 * O app instalado não leva a CLI do Prisma, então as migrations são executadas aqui,
 * cada uma dentro de uma transação. Atualizar o programa atualiza o banco automaticamente.
 */
export async function applyMigrations(migrationsDir: string, options: { backupsDir?: string } = {}) {
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" ("name" TEXT PRIMARY KEY, "appliedAt" DATETIME NOT NULL)`,
  );
  const applied = new Set(
    (await prisma.$queryRawUnsafe<Array<{ name: string }>>(`SELECT "name" FROM "${MIGRATIONS_TABLE}"`)).map(
      (row) => row.name,
    ),
  );

  const pending = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !applied.has(entry.name))
    .map((entry) => entry.name)
    .sort();

  // Banco já em uso recebendo mudança de estrutura: guarda uma cópia antes de alterar.
  if (pending.length > 0 && applied.size > 0 && options.backupsDir) {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    await backupDatabase(join(options.backupsDir, `estoquein-antes-da-atualizacao-${stamp}.db`));
  }

  for (const name of pending) {
    const all = splitStatements(readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf8'));
    // Migrations que recriam tabelas desligam as chaves estrangeiras. No SQLite esse PRAGMA
    // não tem efeito dentro de transação, então ele roda antes e depois dela, e a integridade
    // é conferida antes do commit (procedimento recomendado pela documentação do SQLite).
    const redefinesTables = all.some(isForeignKeysPragma);
    const statements = all.filter((statement) => !isForeignKeysPragma(statement));

    if (redefinesTables) await prisma.$executeRawUnsafe('PRAGMA foreign_keys = OFF');
    try {
      await prisma.$transaction(
        async (tx) => {
          for (const statement of statements) await tx.$executeRawUnsafe(statement);
          if (redefinesTables) {
            const violations = await tx.$queryRawUnsafe<unknown[]>('PRAGMA foreign_key_check');
            if (violations.length) throw new Error(`Migration ${name} deixaria referências inválidas no banco`);
          }
          await tx.$executeRawUnsafe(
            `INSERT INTO "${MIGRATIONS_TABLE}" ("name", "appliedAt") VALUES (?, ?)`,
            name,
            new Date().toISOString(),
          );
        },
        { timeout: 120_000 },
      );
    } finally {
      if (redefinesTables) await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
    }
  }
  return pending;
}

const isForeignKeysPragma = (statement: string) => /^PRAGMA\s+foreign_keys\s*=/i.test(statement);

/** Cópia consistente do banco, mesmo com o sistema em uso (VACUUM INTO). */
export async function backupDatabase(destination: string) {
  rmSync(destination, { force: true });
  await prisma.$executeRawUnsafe('VACUUM INTO ?', destination);
}

/** Confere se o arquivo é um banco SQLite (para não restaurar um arquivo qualquer). */
export function isSqliteFile(file: string) {
  if (!existsSync(file)) return false;
  const header = Buffer.alloc(16);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, header, 0, 16, 0);
  } finally {
    closeSync(fd);
  }
  return header.toString('latin1') === 'SQLite format 3\0';
}

const AUTO_PREFIX = 'estoquein-auto-';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Backup automático: no máximo um por dia, mantendo os mais recentes.
 * Não faz nada enquanto o sistema ainda não tem dados.
 */
export async function runAutomaticBackup(backupsDir: string, keep = 10) {
  if ((await prisma.user.count()) === 0) return null;

  const existing = readdirSync(backupsDir)
    .filter((file) => file.startsWith(AUTO_PREFIX) && file.endsWith('.db'))
    .map((file) => ({ file, time: statSync(join(backupsDir, file)).mtimeMs }))
    .sort((a, b) => b.time - a.time);

  if (existing[0] && Date.now() - existing[0].time < DAY_MS) return null;

  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const destination = join(backupsDir, `${AUTO_PREFIX}${stamp}.db`);
  await backupDatabase(destination);

  for (const old of existing.slice(keep - 1)) rmSync(join(backupsDir, old.file), { force: true });
  return destination;
}

const EXTERNAL_PREFIX = 'estoquein-copia-';

/**
 * Cópia para fora do computador (pendrive, pasta do Google Drive/OneDrive): uma por dia, guardando as últimas.
 * O banco é gerado primeiro na pasta local e só então copiado, com nome provisório e renomeado no fim,
 * para o programa de sincronização nunca enviar um arquivo pela metade.
 * Lança erro se a pasta não estiver disponível (pendrive desconectado), para quem chamou tentar de novo depois.
 */
export async function runExternalBackup(externalDir: string, tempDir: string, keep = 7, force = false) {
  if (!existsSync(externalDir)) throw new Error('Pasta de cópia externa não encontrada (pendrive desconectado?)');
  if ((await prisma.user.count()) === 0) return null;

  const existing = readdirSync(externalDir)
    .filter((file) => file.startsWith(EXTERNAL_PREFIX) && file.endsWith('.db'))
    .map((file) => ({ file, time: statSync(join(externalDir, file)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
  if (!force && existing[0] && Date.now() - existing[0].time < DAY_MS) return null;

  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const name = `${EXTERNAL_PREFIX}${stamp}.db`;
  const local = join(tempDir, `.${name}.tmp`);
  const partial = join(externalDir, `${name}.parcial`);
  try {
    await backupDatabase(local);
    copyFileSync(local, partial);
    renameSync(partial, join(externalDir, name));
  } finally {
    rmSync(local, { force: true });
    rmSync(partial, { force: true });
  }

  const current = existing.filter((entry) => entry.file !== name);
  for (const old of current.slice(keep - 1)) rmSync(join(externalDir, old.file), { force: true });
  return join(externalDir, name);
}

/**
 * Informações técnicas para o suporte: estrutura do banco, quantidades e integridade.
 * Não inclui nomes de clientes, produtos, valores nem senhas.
 */
export async function getDiagnostics() {
  const [migrations, integrity, counts, openCash, settings] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ name: string; appliedAt: string }>>(
      `SELECT "name", "appliedAt" FROM "${MIGRATIONS_TABLE}" ORDER BY "name"`,
    ),
    prisma.$queryRawUnsafe<Array<{ quick_check: string }>>('PRAGMA quick_check'),
    Promise.all([
      prisma.user.count(),
      prisma.product.count(),
      prisma.warehouse.count(),
      prisma.stockMovement.count(),
      prisma.sale.count(),
      prisma.customer.count(),
      prisma.cashSession.count(),
      prisma.stockAlert.count({ where: { status: 'OPEN' } }),
      prisma.stockLevel.count({ where: { quantity: { lt: 0 } } }),
    ]),
    prisma.cashSession.count({ where: { status: 'OPEN' } }),
    prisma.storeSettings.findUnique({ where: { id: 1 } }),
  ]);
  const [users, products, warehouses, movements, sales, customers, cashSessions, openAlerts, negativeLevels] = counts;
  return {
    migrations: migrations.map((row) => row.name),
    integrity: integrity.map((row) => row.quick_check).join('; '),
    counts: {
      users,
      products,
      warehouses,
      movements,
      sales,
      customers,
      cashSessions,
      openCash,
      openAlerts,
      negativeLevels,
    },
    settings: settings && {
      allowNegativeStock: settings.allowNegativeStock,
      requireCashSession: settings.requireCashSession,
      autoPrint: settings.autoPrint,
    },
  };
}
