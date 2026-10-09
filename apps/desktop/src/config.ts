/** Configuração local do computador (config.json na pasta de dados). */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configFile, dataDir, fileStamp } from './paths.js';

export interface LocalConfig {
  /** Segredo que assina os logins, gerado na instalação. */
  jwtSecret: string;
  /** Impressora térmica escolhida para a notinha (impressão direta, sem diálogo). */
  receiptPrinter?: string | null;
  /** Pasta fora do computador (pendrive, Google Drive, OneDrive) que recebe uma cópia diária do banco. */
  externalBackupDir?: string | null;
  lastExternalBackupAt?: string | null;
  lastExternalBackupError?: string | null;
}

/** Grava num arquivo provisório e renomeia: uma queda de energia no meio não deixa o arquivo pela metade. */
function saveLocalConfig(config: LocalConfig) {
  const temporary = `${configFile}.tmp`;
  writeFileSync(temporary, JSON.stringify(config, null, 2));
  renameSync(temporary, configFile);
}

/**
 * Lê a configuração local. Se o arquivo estiver danificado, guarda a cópia ruim e recomeça com um
 * segredo novo: o programa abre normalmente (só é preciso entrar de novo e refazer a escolha da
 * impressora e da pasta de cópia externa).
 */
export function loadLocalConfig(): LocalConfig {
  if (existsSync(configFile)) {
    try {
      const config = JSON.parse(readFileSync(configFile, 'utf8')) as LocalConfig;
      if (typeof config.jwtSecret === 'string' && config.jwtSecret.length >= 16) return config;
    } catch (error) {
      console.error('config.json danificado; criando um novo', error);
    }
    renameSync(configFile, join(dataDir, `config.danificado-${fileStamp()}.json`));
  }
  const config = { jwtSecret: randomBytes(48).toString('hex') };
  saveLocalConfig(config);
  return config;
}

/** Altera só os campos informados. */
export function updateLocalConfig(changes: Partial<LocalConfig>) {
  saveLocalConfig({ ...loadLocalConfig(), ...changes });
}
