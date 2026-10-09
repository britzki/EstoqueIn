/**
 * Pastas e arquivos do programa instalado. Importado antes de tudo: define a pasta de dados do Electron.
 */
import { app } from 'electron';
import { join } from 'node:path';

export const isDev = !app.isPackaged;

// Pasta de dados: %APPDATA%\EstoqueIn (desenvolvimento usa uma pasta separada).
// ESTOQUEIN_DATA_DIR permite apontar para outra pasta (testes automatizados, sem tocar nos dados reais).
app.setPath(
  'userData',
  process.env.ESTOQUEIN_DATA_DIR ?? join(app.getPath('appData'), isDev ? 'EstoqueIn-dev' : 'EstoqueIn'),
);

export const dataDir = app.getPath('userData');
export const dbPath = join(dataDir, 'estoquein.db');
export const backupsDir = join(dataDir, 'backups');
export const logsDir = join(dataDir, 'logs');
export const logFile = join(logsDir, 'estoquein.log');
export const configFile = join(dataDir, 'config.json');
/** Arquivos que vão junto com o programa (montados por build.mjs em dist/). */
export const migrationsDir = join(__dirname, 'migrations');

const pad = (value: number) => String(value).padStart(2, '0');

/** "202610091430": data e hora locais, para nomes de arquivo (backup, diagnóstico). */
export const fileStamp = (date = new Date()) =>
  `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}`;
