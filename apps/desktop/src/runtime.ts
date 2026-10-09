/** O que está rodando agora: a API embutida e a janela. Compartilhado entre os módulos do processo principal. */
import type { BrowserWindow } from 'electron';

export interface DesktopServer {
  port: number;
  appliedMigrations: string[];
  close(): Promise<void>;
}

/** Contrato do módulo da API empacotado em dist/server.cjs (apps/api/src/desktop/index.ts). */
export interface ServerModule {
  startDesktopServer(options: {
    webDist: string;
    migrationsDir: string;
    backupsDir: string;
    preferredPort?: number;
  }): Promise<DesktopServer>;
  backupDatabase(destination: string): Promise<void>;
  checkBackupFile(file: string, migrationsDir: string): Promise<string | null>;
  runAutomaticBackup(backupsDir: string, keep?: number): Promise<string | null>;
  runExternalBackup(externalDir: string, tempDir: string, keep?: number, force?: boolean): Promise<string | null>;
  getDiagnostics(): Promise<Record<string, unknown>>;
  resetAdminPassword(origin?: string): Promise<{ name: string; email: string; temporaryPassword: string }>;
}

export const runtime: {
  server: DesktopServer | null;
  serverModule: ServerModule | null;
  mainWindow: BrowserWindow | null;
} = { server: null, serverModule: null, mainWindow: null };
