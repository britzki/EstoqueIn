/**
 * Processo principal do EstoqueIn Desktop.
 *
 * Sobe a mesma API da versão web dentro do próprio app, presa ao endereço local (127.0.0.1)
 * e numa porta livre, com o banco SQLite na pasta de dados do usuário. A janela carrega a
 * interface servida por essa API, então desktop e web compartilham 100% das regras de negócio.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { arch, release } from 'node:os';
import { join } from 'node:path';
import { format } from 'node:util';

interface DesktopServer {
  port: number;
  appliedMigrations: string[];
  close(): Promise<void>;
}

/** Contrato do módulo da API empacotado em dist/server.cjs (apps/api/src/desktop). */
interface ServerModule {
  startDesktopServer(options: {
    webDist: string;
    migrationsDir: string;
    backupsDir: string;
    preferredPort?: number;
  }): Promise<DesktopServer>;
  backupDatabase(destination: string): Promise<void>;
  isSqliteFile(file: string): boolean;
  runAutomaticBackup(backupsDir: string, keep?: number): Promise<string | null>;
  runExternalBackup(externalDir: string, tempDir: string, keep?: number, force?: boolean): Promise<string | null>;
  getDiagnostics(): Promise<Record<string, unknown>>;
  resetAdminPassword(origin?: string): Promise<{ name: string; email: string; temporaryPassword: string }>;
}

const isDev = !app.isPackaged;

/** WhatsApp do suporte (o mesmo da central de ajuda, em apps/web/src/lib/support.ts). */
const SUPPORT_WHATSAPP = '5511989045896';
const SUPPORT_WHATSAPP_LABEL = '(11) 98904-5896';

// Pasta de dados: %APPDATA%\EstoqueIn (desenvolvimento usa uma pasta separada).
// ESTOQUEIN_DATA_DIR permite apontar para outra pasta (testes automatizados, sem tocar nos dados reais).
app.setPath(
  'userData',
  process.env.ESTOQUEIN_DATA_DIR ?? join(app.getPath('appData'), isDev ? 'EstoqueIn-dev' : 'EstoqueIn'),
);

const dataDir = app.getPath('userData');
const dbPath = join(dataDir, 'estoquein.db');
const backupsDir = join(dataDir, 'backups');
const logsDir = join(dataDir, 'logs');

let server: DesktopServer | null = null;
let serverModule: ServerModule | null = null;
let mainWindow: BrowserWindow | null = null;

/* ---------- Log em arquivo (ajuda no suporte ao cliente) ---------- */

function setupFileLogging() {
  mkdirSync(logsDir, { recursive: true });
  const logFile = join(logsDir, 'estoquein.log');
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      try {
        appendFileSync(logFile, `[${new Date().toISOString()}] ${level.toUpperCase()} ${format(...args)}\n`);
      } catch {
        /* sem log em arquivo, segue a vida */
      }
    };
  }
}

/* ---------- Configuração local (segredo do JWT gerado na instalação) ---------- */

interface LocalConfig {
  jwtSecret: string;
  /** Impressora térmica escolhida para a notinha (impressão direta, sem diálogo). */
  receiptPrinter?: string | null;
  /** Pasta fora do computador (pendrive, Google Drive, OneDrive) que recebe uma cópia diária do banco. */
  externalBackupDir?: string | null;
  lastExternalBackupAt?: string | null;
  lastExternalBackupError?: string | null;
}

const configFile = () => join(dataDir, 'config.json');

function saveLocalConfig(config: LocalConfig) {
  writeFileSync(configFile(), JSON.stringify(config, null, 2));
}

function loadLocalConfig(): LocalConfig {
  if (existsSync(configFile())) return JSON.parse(readFileSync(configFile(), 'utf8'));
  const config = { jwtSecret: randomBytes(48).toString('hex') };
  saveLocalConfig(config);
  return config;
}

/* ---------- Impressão da notinha ---------- */

function registerPrinting() {
  ipcMain.handle('printers:list', async () => {
    const printers = (await mainWindow?.webContents.getPrintersAsync()) ?? [];
    return printers.map((printer) => ({
      name: printer.name,
      displayName: printer.displayName,
    }));
  });
  ipcMain.handle('printers:get', () => loadLocalConfig().receiptPrinter ?? null);
  ipcMain.handle('printers:set', (_event, name: string | null) => {
    saveLocalConfig({ ...loadLocalConfig(), receiptPrinter: name || null });
  });

  // Imprime a página atual (a notinha está na área de impressão). Com impressora configurada,
  // sai direto; sem, abre o diálogo de impressão do Windows.
  ipcMain.handle('receipt:print', (_event, widthMm: number) => {
    const deviceName = loadLocalConfig().receiptPrinter ?? undefined;
    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      if (!mainWindow) return resolve({ ok: false, error: 'Janela fechada' });
      mainWindow.webContents.print(
        {
          silent: Boolean(deviceName),
          deviceName,
          printBackground: false,
          margins: { marginType: 'none' },
          // Bobina: largura fixa e altura longa; a impressora corta onde o conteúdo termina.
          pageSize: { width: Math.round((widthMm || 80) * 1000), height: 297_000 },
        },
        (ok, failureReason) => {
          if (!ok && failureReason) console.warn('Impressão da notinha:', failureReason);
          resolve({ ok, error: ok ? undefined : failureReason });
        },
      );
    });
  });
}

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

/* ---------- Backup e restauração ---------- */

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

async function backupNow() {
  if (!serverModule || !mainWindow) return;
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Salvar backup do EstoqueIn',
    defaultPath: join(app.getPath('documents'), `estoquein-backup-${stamp()}.db`),
    filters: [{ name: 'Backup do EstoqueIn', extensions: ['db'] }],
  });
  if (canceled || !filePath) return;

  try {
    await serverModule.backupDatabase(filePath);
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Backup concluído',
      message: 'Backup salvo com sucesso.',
      detail: filePath,
      buttons: ['OK', 'Mostrar na pasta'],
    });
    if (response === 1) shell.showItemInFolder(filePath);
  } catch (error) {
    console.error('Falha no backup', error);
    dialog.showErrorBox('Não foi possível fazer o backup', String(error));
  }
}

async function restoreBackup() {
  if (!serverModule || !mainWindow) return;
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Restaurar backup',
    defaultPath: backupsDir,
    filters: [{ name: 'Backup do EstoqueIn', extensions: ['db'] }],
    properties: ['openFile'],
  });
  const file = filePaths[0];
  if (canceled || !file) return;

  if (!serverModule.isSqliteFile(file)) {
    dialog.showErrorBox('Arquivo inválido', 'O arquivo escolhido não é um backup do EstoqueIn.');
    return;
  }

  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Restaurar backup',
    message: 'Substituir todos os dados atuais pelos dados do backup?',
    detail: 'Antes disso, uma cópia dos dados atuais será salva na pasta de backups. O EstoqueIn será reiniciado.',
    buttons: ['Restaurar e reiniciar', 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
  });
  if (response !== 0) return;

  try {
    await serverModule.backupDatabase(join(backupsDir, `estoquein-antes-da-restauracao-${stamp()}.db`));
    await server?.close();
    server = null;
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    copyFileSync(file, dbPath);
    app.relaunch();
    app.exit(0);
  } catch (error) {
    console.error('Falha na restauração', error);
    dialog.showErrorBox('Não foi possível restaurar o backup', String(error));
    app.relaunch();
    app.exit(1);
  }
}

/* ---------- Cópia fora do computador ---------- */

interface ExternalBackupStatus {
  dir: string | null;
  lastAt: string | null;
  lastError: string | null;
}

function externalBackupStatus(): ExternalBackupStatus {
  const config = loadLocalConfig();
  return {
    dir: config.externalBackupDir ?? null,
    lastAt: config.lastExternalBackupAt ?? null,
    lastError: config.lastExternalBackupError ?? null,
  };
}

/**
 * Se o computador queimar ou for roubado, o backup local vai junto. Por isso, uma vez por dia,
 * uma cópia vai para a pasta escolhida. Se a pasta não estiver disponível (pendrive fora),
 * registra o erro e tenta de novo na próxima hora.
 */
async function runExternalBackup(force = false) {
  const dir = loadLocalConfig().externalBackupDir;
  if (!serverModule || !dir) return externalBackupStatus();
  try {
    const file = await serverModule.runExternalBackup(dir, backupsDir, 7, force);
    if (file) {
      saveLocalConfig({
        ...loadLocalConfig(),
        lastExternalBackupAt: new Date().toISOString(),
        lastExternalBackupError: null,
      });
      console.info('Cópia externa:', file);
    } else if (loadLocalConfig().lastExternalBackupError) {
      // A pasta voltou a ficar disponível e a cópia do dia já existe.
      saveLocalConfig({ ...loadLocalConfig(), lastExternalBackupError: null });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('Falha na cópia externa', message);
    saveLocalConfig({ ...loadLocalConfig(), lastExternalBackupError: message });
  }
  return externalBackupStatus();
}

function registerExternalBackup() {
  ipcMain.handle('backup:external:get', () => externalBackupStatus());
  ipcMain.handle('backup:external:choose', async () => {
    if (!mainWindow) return externalBackupStatus();
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Escolha onde guardar a cópia diária (pendrive ou pasta do Google Drive/OneDrive)',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || !filePaths[0]) return externalBackupStatus();
    saveLocalConfig({ ...loadLocalConfig(), externalBackupDir: filePaths[0], lastExternalBackupError: null });
    return runExternalBackup(true);
  });
  ipcMain.handle('backup:external:run', () => runExternalBackup(true));
  ipcMain.handle('backup:external:clear', () => {
    saveLocalConfig({
      ...loadLocalConfig(),
      externalBackupDir: null,
      lastExternalBackupAt: null,
      lastExternalBackupError: null,
    });
    return externalBackupStatus();
  });
}

/* ---------- Diagnóstico para o suporte ---------- */

const fileSize = (file: string) => (existsSync(file) ? `${(statSync(file).size / 1024).toFixed(0)} KB` : 'não existe');

/**
 * Gera um .txt com o que o suporte precisa para entender um problema: versões, estado do banco
 * e o final do log. Não leva o banco nem dados de clientes, produtos ou vendas.
 */
async function generateDiagnostics() {
  if (!serverModule || !mainWindow) return;
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Salvar arquivo de diagnóstico',
    defaultPath: join(app.getPath('desktop'), `estoquein-diagnostico-${stamp()}.txt`),
    filters: [{ name: 'Texto', extensions: ['txt'] }],
  });
  if (canceled || !filePath) return;

  const section = (title: string, lines: string[]) => `=== ${title} ===\n${lines.join('\n')}\n`;
  let database: string;
  try {
    database = JSON.stringify(await serverModule.getDiagnostics(), null, 2);
  } catch (error) {
    database = `Erro ao consultar o banco: ${String(error)}`;
  }
  const backups = readdirSync(backupsDir)
    .filter((file) => file.endsWith('.db'))
    .sort()
    .reverse();
  const external = externalBackupStatus();
  const logFile = join(logsDir, 'estoquein.log');
  const log = existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').slice(-300).join('\n') : '(sem log)';

  const report = [
    section('Programa', [
      `EstoqueIn ${app.getVersion()} (Electron ${process.versions.electron})`,
      `Windows ${release()} ${arch()}`,
      `Gerado em ${new Date().toLocaleString('pt-BR')}`,
      `Porta da API: ${server?.port ?? 'parada'}`,
      `Pasta de dados: ${dataDir}`,
      `Banco: ${fileSize(dbPath)} (WAL ${fileSize(`${dbPath}-wal`)})`,
    ]),
    section('Backups', [
      `Locais: ${backups.length}${backups[0] ? `, mais recente ${backups[0]}` : ''}`,
      `Cópia externa: ${external.dir ?? 'não configurada'}`,
      `Última cópia externa: ${external.lastAt ?? 'nunca'}`,
      `Último erro da cópia externa: ${external.lastError ?? 'nenhum'}`,
    ]),
    section('Banco de dados', [database]),
    section('Log (últimas linhas)', [log]),
  ].join('\n');

  try {
    writeFileSync(filePath, report);
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Diagnóstico gerado',
      message: 'Arquivo de diagnóstico salvo.',
      detail: `Envie este arquivo para o suporte. Ele não contém o banco de dados nem dados de clientes.\n\n${filePath}`,
      buttons: ['OK', 'Mostrar na pasta'],
    });
    if (response === 1) shell.showItemInFolder(filePath);
  } catch (error) {
    dialog.showErrorBox('Não foi possível salvar o diagnóstico', String(error));
  }
}

/* ---------- Recuperação de acesso ---------- */

/**
 * Para quem esqueceu a senha do administrador. Só é alcançável por quem está no computador
 * da loja, dentro da sessão do Windows; por isso a senha do Windows é parte da proteção.
 */
async function resetAdminPassword() {
  if (!serverModule || !mainWindow) return;
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Redefinir senha do administrador',
    message: 'Gerar uma senha temporária para o administrador?',
    detail:
      'A senha atual deixa de funcionar. A nova senha aparece na próxima tela e precisa ser trocada no primeiro acesso. A redefinição fica no registro de alterações.',
    buttons: ['Gerar senha temporária', 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
  });
  if (response !== 0) return;

  try {
    const result = await serverModule.resetAdminPassword('menu do programa');
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Senha temporária gerada',
      message: `Senha temporária: ${result.temporaryPassword}`,
      detail: `Usuário: ${result.email} (${result.name})\n\nAnote agora: ela não será mostrada de novo. Ao entrar, o sistema pede uma senha nova.`,
      buttons: ['Já anotei'],
    });
    mainWindow.webContents.reload();
  } catch (error) {
    console.error('Falha ao redefinir a senha', error);
    dialog.showErrorBox('Não foi possível redefinir a senha', String(error instanceof Error ? error.message : error));
  }
}

/* ---------- Janela e menu ---------- */

function createWindow(url: string) {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'EstoqueIn',
    backgroundColor: '#f8fafc',
    icon: join(__dirname, 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.maximize();
    mainWindow?.show();
  });

  // Links externos abrem no navegador padrão, nunca dentro do app.
  const origin = new URL(url).origin;
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(origin)) {
      event.preventDefault();
      shell.openExternal(target);
    }
  });

  mainWindow.on('closed', () => (mainWindow = null));
  mainWindow.loadURL(url);
}

function buildMenu() {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Arquivo',
      submenu: [
        { label: 'Fazer backup agora...', accelerator: 'CmdOrCtrl+B', click: backupNow },
        { label: 'Restaurar backup...', click: restoreBackup },
        { label: 'Abrir pasta de backups', click: () => shell.openPath(backupsDir) },
        { type: 'separator' },
        { role: 'quit', label: 'Sair' },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Desfazer' },
        { role: 'redo', label: 'Refazer' },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { role: 'selectAll', label: 'Selecionar tudo' },
      ],
    },
    {
      label: 'Exibir',
      submenu: [
        { role: 'reload', label: 'Recarregar' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Tamanho original' },
        { role: 'zoomIn', label: 'Aumentar' },
        { role: 'zoomOut', label: 'Diminuir' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tela cheia' },
        ...(isDev ? [{ role: 'toggleDevTools' as const, label: 'Ferramentas de desenvolvedor' }] : []),
      ],
    },
    {
      label: 'Ajuda',
      submenu: [
        {
          label: 'Central de ajuda',
          click: () => server && mainWindow?.loadURL(`http://127.0.0.1:${server.port}/help`),
        },
        {
          label: 'Falar com o suporte (WhatsApp)',
          click: () =>
            shell.openExternal(
              `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(`Olá! Preciso de ajuda com o EstoqueIn.\nVersão: ${app.getVersion()}`)}`,
            ),
        },
        { type: 'separator' },
        { label: 'Redefinir senha do administrador...', click: resetAdminPassword },
        { label: 'Gerar arquivo de diagnóstico...', click: generateDiagnostics },
        { label: 'Abrir pasta de dados', click: () => shell.openPath(dataDir) },
        { type: 'separator' },
        {
          label: 'Sobre o EstoqueIn',
          click: () =>
            dialog.showMessageBox({
              type: 'info',
              title: 'Sobre o EstoqueIn',
              message: `EstoqueIn ${app.getVersion()}`,
              detail: `Gestão de estoque para pequenas empresas.\n\nSuporte: WhatsApp ${SUPPORT_WHATSAPP_LABEL}\nDados: ${dataDir}`,
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------- Ciclo de vida ---------- */

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
  serverModule = require(join(__dirname, 'server.cjs')) as ServerModule;
  server = await serverModule.startDesktopServer({
    webDist: join(__dirname, 'web'),
    migrationsDir: join(__dirname, 'migrations'),
    backupsDir,
    preferredPort: process.env.ESTOQUEIN_PORT ? Number(process.env.ESTOQUEIN_PORT) : undefined,
  });
  console.info(`EstoqueIn ${app.getVersion()} na porta ${server.port}`, server.appliedMigrations);

  buildMenu();
  registerPrinting();
  registerExternalBackup();
  ipcMain.handle('app:version', () => app.getVersion());
  createWindow(`http://127.0.0.1:${server.port}`);

  // Backup diário: confere ao abrir e a cada hora (o programa costuma ficar aberto o dia todo).
  const autoBackup = () =>
    serverModule
      ?.runAutomaticBackup(backupsDir)
      .then((file) => file && console.info('Backup automático:', file))
      .catch((error) => console.error('Falha no backup automático', error))
      .then(() => runExternalBackup());
  autoBackup();
  setInterval(autoBackup, 60 * 60 * 1000);
}

// Uma instância só: abrir o atalho de novo traz a janela existente para frente.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  setupFileLogging();

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app
    .whenReady()
    .then(start)
    .catch((error) => {
      console.error('Falha ao iniciar', error);
      dialog.showErrorBox(
        'Não foi possível iniciar o EstoqueIn',
        `${error instanceof Error ? error.message : String(error)}\n\nDetalhes em: ${join(logsDir, 'estoquein.log')}`,
      );
      app.exit(1);
    });

  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', async (event) => {
    if (!server) return;
    event.preventDefault();
    const closing = server;
    server = null;
    await closing.close().catch(() => undefined);
    app.quit();
  });
}
