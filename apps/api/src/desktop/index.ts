/**
 * Ponto de entrada da API dentro do app desktop (Electron).
 * O processo principal do Electron define as variáveis de ambiente (caminho do banco,
 * segredo do JWT...) ANTES de carregar este módulo e depois chama startDesktopServer().
 */
import type { AddressInfo } from 'node:net';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { registerAlertNotifier } from '../modules/alerts/alert-notifier.js';
import { resetAdminPassword } from '../modules/users/recovery.js';
import {
  applyMigrations,
  backupDatabase,
  checkBackupFile,
  configureSqlite,
  getDiagnostics,
  isSqliteFile,
  runAutomaticBackup,
  runExternalBackup,
} from './database.js';

interface DesktopServerOptions {
  webDist: string;
  migrationsDir: string;
  /** Onde guardar a cópia de segurança feita antes de atualizar a estrutura do banco. */
  backupsDir?: string;
  preferredPort?: number;
}

export async function startDesktopServer({
  webDist,
  migrationsDir,
  backupsDir,
  preferredPort = 47_321,
}: DesktopServerOptions) {
  await configureSqlite();
  const applied = await applyMigrations(migrationsDir, { backupsDir });
  registerAlertNotifier();

  const app = createApp({ webDist });
  // Só aceita conexões da própria máquina. A porta é fixa para o endereço da interface não mudar
  // entre aberturas (o armazenamento local, como a sessão, é separado por porta);
  // se estiver ocupada por outro programa, usa uma porta livre qualquer.
  const listen = (port: number) =>
    new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
      const instance = app.listen(port, '127.0.0.1', () => resolve(instance));
      instance.on('error', reject);
    });
  const server = await listen(preferredPort).catch(() => listen(0));

  return {
    port: (server.address() as AddressInfo).port,
    appliedMigrations: applied,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await prisma.$disconnect();
    },
  };
}

export {
  backupDatabase,
  checkBackupFile,
  getDiagnostics,
  isSqliteFile,
  resetAdminPassword,
  runAutomaticBackup,
  runExternalBackup,
};
