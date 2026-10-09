/** Log em arquivo: ajuda o suporte a entender um problema na loja. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { format } from 'node:util';
import { logFile, logsDir } from './paths.js';

/** Acima disso o log vira "estoquein.old.log" (substituindo o antigo): nunca passa de uns 10 MB. */
const MAX_LOG_BYTES = 5 * 1024 * 1024;

export function setupFileLogging() {
  mkdirSync(logsDir, { recursive: true });
  if (existsSync(logFile) && statSync(logFile).size > MAX_LOG_BYTES) {
    renameSync(logFile, join(logsDir, 'estoquein.old.log'));
  }
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

/** Últimas linhas do log, para o arquivo de diagnóstico. */
export function readLogTail(lines: number) {
  if (!existsSync(logFile)) return '(sem log)';
  return readFileSync(logFile, 'utf8').split('\n').slice(-lines).join('\n');
}
