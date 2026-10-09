/** Janela principal e menu do programa. */
import { app, BrowserWindow, dialog, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { join } from 'node:path';
import { backupNow, restoreBackup } from './backups.js';
import { backupsDir, dataDir, isDev } from './paths.js';
import { runtime } from './runtime.js';
import { generateDiagnostics, resetAdminPassword, SUPPORT_WHATSAPP_LABEL, supportChatUrl } from './support.js';

const parseUrl = (target: string) => {
  try {
    return new URL(target);
  } catch {
    return null;
  }
};

/** Abre no navegador padrão, só endereços http(s): outros esquemas (file:, protocolos do Windows) poderiam abrir programas. */
const openOutside = (target: string) => {
  const url = parseUrl(target);
  if (url && (url.protocol === 'https:' || url.protocol === 'http:')) void shell.openExternal(url.href);
};

export function createWindow(url: string) {
  const window = new BrowserWindow({
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
  runtime.mainWindow = window;

  window.once('ready-to-show', () => {
    window.maximize();
    window.show();
  });

  // Links externos (WhatsApp) abrem no navegador padrão, nunca dentro do app;
  // a janela só navega dentro da própria interface.
  const origin = new URL(url).origin;
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    openOutside(target);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, target) => {
    if (parseUrl(target)?.origin === origin) return;
    event.preventDefault();
    openOutside(target);
  });

  window.on('closed', () => (runtime.mainWindow = null));
  void window.loadURL(url);
}

/** Ação do menu que, se falhar, avisa na tela (e no log) em vez de falhar em silêncio. */
const safely = (title: string, action: () => Promise<void>) => () => {
  action().catch((error: unknown) => {
    console.error(title, error);
    dialog.showErrorBox(title, error instanceof Error ? error.message : String(error));
  });
};

export function buildMenu() {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Arquivo',
      submenu: [
        {
          label: 'Fazer backup agora...',
          accelerator: 'CmdOrCtrl+B',
          click: safely('Não foi possível fazer o backup', backupNow),
        },
        { label: 'Restaurar backup...', click: safely('Não foi possível restaurar o backup', restoreBackup) },
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
          click: () => runtime.server && runtime.mainWindow?.loadURL(`http://127.0.0.1:${runtime.server.port}/help`),
        },
        { label: 'Falar com o suporte (WhatsApp)', click: () => shell.openExternal(supportChatUrl()) },
        { type: 'separator' },
        {
          label: 'Redefinir senha do administrador...',
          click: safely('Não foi possível redefinir a senha', resetAdminPassword),
        },
        {
          label: 'Gerar arquivo de diagnóstico...',
          click: safely('Não foi possível salvar o diagnóstico', generateDiagnostics),
        },
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
