/**
 * Processo principal do EstoqueIn Desktop.
 *
 * Sobe a mesma API da versão web dentro do próprio app, presa ao endereço local (127.0.0.1)
 * e numa porta livre, com o banco SQLite na pasta de dados do usuário. A janela carrega a
 * interface servida por essa API, então desktop e web compartilham 100% das regras de negócio.
 *
 * Organização: paths (pastas), logging, config (config.json), printing (notinha), backups,
 * support (diagnóstico e senha do administrador), window (janela e menu) e este arquivo,
 * com a inicialização e o ciclo de vida.
 */
// Primeiro import: define a pasta de dados antes de qualquer outro módulo usá-la.
import { backupsDir, dataDir, dbPath, isDev, logFile, migrationsDir } from './paths.js';
import { app, dialog, ipcMain } from 'electron';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { registerExternalBackup, runExternalBackup } from './backups.js';
import { loadLocalConfig } from './config.js';
import { setupFileLogging } from './logging.js';
import { registerPrinting } from './printing.js';
import { runtime, type ServerModule } from './runtime.js';
import { buildMenu, createWindow } from './window.js';

const HOUR_MS = 60 * 60 * 1000;

/** Variáveis que a API lê ao ser carregada: banco local, segredo do login, fuso do computador. */
function prepareEnvironment() {
  const { jwtSecret } = loadLocalConfig();
  const engine = readdirSync(join(__dirname, 'engine')).find((file) => file.endsWith('.node'));
  if (!engine) throw new Error('Motor do banco de dados não encontrado na instalação.');

  Object.assign(process.env, {
    NODE_ENV: 'production',
    // Um único usuário por vez: uma conexão evita disputas de escrita no SQLite.
    DATABASE_URL: `file:${dbPath.replaceAll('\\', '/')}?connection_limit=1`,
    JWT_SECRET: jwtSecret,
    JWT_EXPIRES_IN: '12h',
    CORS_ORIGIN: 'http://127.0.0.1',
    APP_TIMEZONE: Intl.DateTimeFormat().resolvedOptions().timeZone,
    ALERT_WEBHOOK_URL: '',
    BARCODE_LOOKUP_ENABLED: 'true',
    // Arquivos nativos não rodam de dentro do pacote .asar; ficam na pasta "unpacked".
    PRISMA_QUERY_ENGINE_LIBRARY: join(__dirname, 'engine', engine).replace('app.asar', 'app.asar.unpacked'),
  });
}

/**
 * O programa se chamava StockFlow. Na primeira abertura com o nome novo, copia os dados da
 * instalação antiga (%APPDATA%\StockFlow) para a pasta atual. A pasta antiga não é alterada.
 */
function importLegacyData() {
  if (isDev || existsSync(dbPath)) return;
  // Com pasta de dados alternativa (testes), só importa se a origem também for indicada.
  if (process.env.ESTOQUEIN_DATA_DIR && !process.env.ESTOQUEIN_LEGACY_DIR) return;
  const legacyDir = process.env.ESTOQUEIN_LEGACY_DIR ?? join(app.getPath('appData'), 'StockFlow');
  const legacyDb = join(legacyDir, 'stockflow.db');
  if (!existsSync(legacyDb)) return;

  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(legacyDb + suffix)) copyFileSync(legacyDb + suffix, dbPath + suffix);
  }
  // O segredo de autenticação vai junto, para as senhas e sessões continuarem válidas.
  if (existsSync(join(legacyDir, 'config.json')))
    copyFileSync(join(legacyDir, 'config.json'), join(dataDir, 'config.json'));
  if (existsSync(join(legacyDir, 'backups'))) cpSync(join(legacyDir, 'backups'), backupsDir, { recursive: true });
  console.info('Dados da instalação anterior (StockFlow) copiados de', legacyDir);
}

async function start() {
  mkdirSync(backupsDir, { recursive: true });
  importLegacyData();
  prepareEnvironment();

  // Carregado só agora: a API lê as variáveis de ambiente ao ser importada.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const serverModule = require(join(__dirname, 'server.cjs')) as ServerModule;
  runtime.serverModule = serverModule;
  const server = await serverModule.startDesktopServer({
    webDist: join(__dirname, 'web'),
    migrationsDir,
    backupsDir,
    preferredPort: process.env.ESTOQUEIN_PORT ? Number(process.env.ESTOQUEIN_PORT) : undefined,
  });
  runtime.server = server;
  console.info(`EstoqueIn ${app.getVersion()} na porta ${server.port}`, server.appliedMigrations);

  buildMenu();
  registerPrinting();
  registerExternalBackup();
  ipcMain.handle('app:version', () => app.getVersion());
  createWindow(`http://127.0.0.1:${server.port}`);

  // Backup diário: confere ao abrir e a cada hora (o programa costuma ficar aberto o dia todo).
  const autoBackup = () =>
    serverModule
      .runAutomaticBackup(backupsDir)
      .then((file) => file && console.info('Backup automático:', file))
      .catch((error) => console.error('Falha no backup automático', error))
      .then(() => runExternalBackup());
  void autoBackup();
  setInterval(autoBackup, HOUR_MS);
}

// Uma instância só: abrir o atalho de novo traz a janela existente para frente.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  setupFileLogging();

  app.on('second-instance', () => {
    const window = runtime.mainWindow;
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  app
    .whenReady()
    .then(start)
    .catch((error) => {
      console.error('Falha ao iniciar', error);
      dialog.showErrorBox(
        'Não foi possível iniciar o EstoqueIn',
        `${error instanceof Error ? error.message : String(error)}\n\nDetalhes em: ${logFile}`,
      );
      app.exit(1);
    });

  app.on('window-all-closed', () => app.quit());

  // Fecha a API (e o banco) antes de sair.
  app.on('before-quit', async (event) => {
    const closing = runtime.server;
    if (!closing) return;
    event.preventDefault();
    runtime.server = null;
    await closing.close().catch(() => undefined);
    app.quit();
  });
}
