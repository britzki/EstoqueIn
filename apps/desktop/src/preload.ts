/**
 * Ponte entre a interface e o programa desktop. A página não tem acesso ao Node nem ao sistema:
 * só enxerga estas funções: impressão da notinha e configuração da cópia de segurança externa.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('estoquein', {
  isDesktop: true,
  getVersion: () => ipcRenderer.invoke('app:version'),
  printReceipt: (widthMm: number) => ipcRenderer.invoke('receipt:print', widthMm),
  listPrinters: () => ipcRenderer.invoke('printers:list'),
  getReceiptPrinter: () => ipcRenderer.invoke('printers:get'),
  setReceiptPrinter: (name: string | null) => ipcRenderer.invoke('printers:set', name),
  getExternalBackup: () => ipcRenderer.invoke('backup:external:get'),
  chooseExternalBackup: () => ipcRenderer.invoke('backup:external:choose'),
  runExternalBackup: () => ipcRenderer.invoke('backup:external:run'),
  clearExternalBackup: () => ipcRenderer.invoke('backup:external:clear'),
});
