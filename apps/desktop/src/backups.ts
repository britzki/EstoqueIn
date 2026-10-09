/** Backup pelo menu, restauração e a cópia diária para fora do computador. */
import { app, dialog, ipcMain, shell } from 'electron';
import { copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadLocalConfig, updateLocalConfig } from './config.js';
import { backupsDir, dbPath, fileStamp, migrationsDir } from './paths.js';
import { runtime } from './runtime.js';

export async function backupNow() {
  const { serverModule, mainWindow } = runtime;
  if (!serverModule || !mainWindow) return;
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Salvar backup do EstoqueIn',
    defaultPath: join(app.getPath('documents'), `estoquein-backup-${fileStamp()}.db`),
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

export async function restoreBackup() {
  const { serverModule, mainWindow } = runtime;
  if (!serverModule || !mainWindow) return;
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Restaurar backup',
    defaultPath: backupsDir,
    filters: [{ name: 'Backup do EstoqueIn', extensions: ['db'] }],
    properties: ['openFile'],
  });
  const file = filePaths[0];
  if (canceled || !file) return;

  // Só um banco do EstoqueIn, íntegro e de uma versão que este programa conhece.
  const problem = await serverModule.checkBackupFile(file, migrationsDir);
  if (problem) {
    dialog.showErrorBox('Não é possível restaurar este arquivo', problem);
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
    await serverModule.backupDatabase(join(backupsDir, `estoquein-antes-da-restauracao-${fileStamp()}.db`));
    await runtime.server?.close();
    runtime.server = null;
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

export function externalBackupStatus() {
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
export async function runExternalBackup(force = false) {
  const { externalBackupDir: dir, lastExternalBackupError } = loadLocalConfig();
  if (!runtime.serverModule || !dir) return externalBackupStatus();
  try {
    const file = await runtime.serverModule.runExternalBackup(dir, backupsDir, 7, force);
    if (file) {
      updateLocalConfig({ lastExternalBackupAt: new Date().toISOString(), lastExternalBackupError: null });
      console.info('Cópia externa:', file);
    } else if (lastExternalBackupError) {
      // A pasta voltou a ficar disponível e a cópia do dia já existe.
      updateLocalConfig({ lastExternalBackupError: null });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('Falha na cópia externa', message);
    // O erro se repete a cada hora enquanto o pendrive estiver fora: só grava quando muda.
    if (message !== lastExternalBackupError) updateLocalConfig({ lastExternalBackupError: message });
  }
  return externalBackupStatus();
}

export function registerExternalBackup() {
  ipcMain.handle('backup:external:get', () => externalBackupStatus());
  ipcMain.handle('backup:external:choose', async () => {
    if (!runtime.mainWindow) return externalBackupStatus();
    const { canceled, filePaths } = await dialog.showOpenDialog(runtime.mainWindow, {
      title: 'Escolha onde guardar a cópia diária (pendrive ou pasta do Google Drive/OneDrive)',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || !filePaths[0]) return externalBackupStatus();
    updateLocalConfig({ externalBackupDir: filePaths[0], lastExternalBackupError: null });
    return runExternalBackup(true);
  });
  ipcMain.handle('backup:external:run', () => runExternalBackup(true));
  ipcMain.handle('backup:external:clear', () => {
    updateLocalConfig({ externalBackupDir: null, lastExternalBackupAt: null, lastExternalBackupError: null });
    return externalBackupStatus();
  });
}
