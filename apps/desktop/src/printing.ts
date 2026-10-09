/** Impressão da notinha na impressora térmica (bobina de 58 ou 80 mm). */
import { ipcMain } from 'electron';
import { loadLocalConfig, updateLocalConfig } from './config.js';
import { runtime } from './runtime.js';

export function registerPrinting() {
  ipcMain.handle('printers:list', async () => {
    const printers = (await runtime.mainWindow?.webContents.getPrintersAsync()) ?? [];
    return printers.map((printer) => ({ name: printer.name, displayName: printer.displayName }));
  });
  ipcMain.handle('printers:get', () => loadLocalConfig().receiptPrinter ?? null);
  ipcMain.handle('printers:set', (_event, name: unknown) => {
    // A tela manda o nome de uma impressora do Windows; qualquer outra coisa vira "sem impressora".
    updateLocalConfig({ receiptPrinter: typeof name === 'string' && name && name.length <= 256 ? name : null });
  });

  // Imprime a página atual (a notinha está na área de impressão). Com impressora configurada,
  // sai direto; sem, abre o diálogo de impressão do Windows.
  ipcMain.handle('receipt:print', (_event, width: unknown) => {
    // Só as larguras de bobina que a tela oferece.
    const widthMm = width === 58 ? 58 : 80;
    const deviceName = loadLocalConfig().receiptPrinter ?? undefined;
    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const window = runtime.mainWindow;
      if (!window) return resolve({ ok: false, error: 'Janela fechada' });
      window.webContents.print(
        {
          silent: Boolean(deviceName),
          deviceName,
          printBackground: false,
          margins: { marginType: 'none' },
          // Bobina: largura fixa e altura longa; a impressora corta onde o conteúdo termina.
          pageSize: { width: widthMm * 1000, height: 297_000 },
        },
        (ok, failureReason) => {
          if (!ok && failureReason) console.warn('Impressão da notinha:', failureReason);
          resolve({ ok, error: ok ? undefined : failureReason });
        },
      );
    });
  });
}
