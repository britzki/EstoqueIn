import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { TEST_ENV } from '../vitest.config.js';

/**
 * Cria um banco SQLite descartável só para os testes (prisma/test.db),
 * aplicando as mesmas migrations usadas em produção.
 */
export default function setup() {
  const testDb = join(import.meta.dirname, '..', 'prisma', 'test.db');
  rmSync(testDb, { force: true });
  rmSync(`${testDb}-journal`, { force: true });

  execSync('npx prisma migrate deploy', { env: { ...process.env, ...TEST_ENV }, stdio: 'pipe' });
}
