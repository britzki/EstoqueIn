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

const pad = (value: number) => String(value).padStart(2, '0');

/** "202610091430": data e hora locais, para o nome dos arquivos de backup (o dono escolhe pelo nome). */
const fileStamp = (date = new Date()) =>
  `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}`;

/** Backups de uma pasta com o prefixo informado, do mais novo para o mais antigo. */
function listBackups(dir: string, prefix: string) {
  return readdirSync(dir)
    .filter((file) => file.startsWith(prefix) && file.endsWith('.db'))
    .map((file) => ({ file, time: statSync(join(dir, file)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
}

/** Apaga os mais antigos, deixando os `keep` mais recentes (contando o que acabou de ser criado). */
function pruneBackups(dir: string, olderFirst: Array<{ file: string }>, keep: number) {
  for (const old of olderFirst.slice(keep - 1)) rmSync(join(dir, old.file), { force: true });
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
    await backupDatabase(join(options.backupsDir, `estoquein-antes-da-atualizacao-${fileStamp()}.db`));
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

/**
 * Cópia consistente do banco, mesmo com o sistema em uso (VACUUM INTO). Grava num arquivo provisório e
 * só no fim troca pelo destino: se faltar espaço ou luz no meio, o backup anterior com esse nome continua lá.
 */
export async function backupDatabase(destination: string) {
  const temporary = `${destination}.tmp`;
  rmSync(temporary, { force: true });
  try {
    await prisma.$executeRawUnsafe('VACUUM INTO ?', temporary);
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
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

/**
 * Confere um backup antes de restaurar: precisa ser um banco do EstoqueIn, íntegro e de uma versão
 * que este programa conhece. Devolve a mensagem para o usuário, ou null se pode restaurar.
 * Sem isso, restaurar o banco de outro programa abriria o sistema vazio, e um backup de versão mais
 * nova deixaria o programa sem conseguir abrir.
 */
export async function checkBackupFile(file: string, migrationsDir: string): Promise<string | null> {
  if (!isSqliteFile(file)) return 'O arquivo escolhido não é um backup do EstoqueIn.';
  await prisma.$executeRawUnsafe('ATTACH DATABASE ? AS candidate', file);
  try {
    const [check] = await prisma.$queryRawUnsafe<Array<{ quick_check: string }>>('PRAGMA candidate.quick_check');
    if (check?.quick_check !== 'ok') return 'O backup está danificado e não pode ser restaurado.';
    const tables = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT "name" FROM candidate.sqlite_master WHERE "type" = 'table' AND "name" = ?`,
      MIGRATIONS_TABLE,
    );
    if (tables.length === 0) return 'O arquivo escolhido não é um backup do EstoqueIn.';
    const applied = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT "name" FROM candidate."${MIGRATIONS_TABLE}"`,
    );
    const known = new Set(readdirSync(migrationsDir));
    if (applied.some((row) => !known.has(row.name))) {
      return 'Este backup é de uma versão mais nova do EstoqueIn. Atualize o programa antes de restaurar.';
    }
    return null;
  } finally {
    await prisma.$executeRawUnsafe('DETACH DATABASE candidate');
  }
}

const AUTO_PREFIX = 'estoquein-auto-';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Backup automático: no máximo um por dia, mantendo os mais recentes.
 * Não faz nada enquanto o sistema ainda não tem dados.
 */
export async function runAutomaticBackup(backupsDir: string, keep = 10) {
  if ((await prisma.user.count()) === 0) return null;

  const existing = listBackups(backupsDir, AUTO_PREFIX);
  if (existing[0] && Date.now() - existing[0].time < DAY_MS) return null;

  const destination = join(backupsDir, `${AUTO_PREFIX}${fileStamp()}.db`);
  await backupDatabase(destination);
  pruneBackups(backupsDir, existing, keep);
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

  const existing = listBackups(externalDir, EXTERNAL_PREFIX);
  if (!force && existing[0] && Date.now() - existing[0].time < DAY_MS) return null;

  const name = `${EXTERNAL_PREFIX}${fileStamp()}.db`;
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

  pruneBackups(
    externalDir,
    existing.filter((entry) => entry.file !== name),
    keep,
  );
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
