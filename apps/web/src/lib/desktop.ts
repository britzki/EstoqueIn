/**
 * Ponte com o programa desktop (Electron). No navegador ela não existe, e a impressão
 * cai no diálogo normal do navegador.
 */
export interface DesktopBridge {
  isDesktop: true;
  /** Versão do programa instalado. */
  getVersion(): Promise<string>;
  /** Imprime a página atual; silenciosamente se houver impressora de notinha configurada. */
  printReceipt(widthMm: number): Promise<{ ok: boolean; error?: string }>;
  listPrinters(): Promise<Array<{ name: string; displayName: string }>>;
  getReceiptPrinter(): Promise<string | null>;
  setReceiptPrinter(name: string | null): Promise<void>;
  /** Cópia diária do banco para fora do computador (pendrive ou pasta sincronizada). */
  getExternalBackup(): Promise<ExternalBackupStatus>;
  chooseExternalBackup(): Promise<ExternalBackupStatus>;
  runExternalBackup(): Promise<ExternalBackupStatus>;
  clearExternalBackup(): Promise<ExternalBackupStatus>;
}

export interface ExternalBackupStatus {
  dir: string | null;
  lastAt: string | null;
  lastError: string | null;
}

declare global {
  interface Window {
    estoquein?: DesktopBridge;
  }
}

export const desktop = typeof window === 'undefined' ? undefined : window.estoquein;
