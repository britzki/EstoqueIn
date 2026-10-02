// Prepara o ambiente local: cria o .env a partir do exemplo, aplica as migrations e popula o banco.
import { copyFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const apiDir = join(import.meta.dirname, '..', 'apps', 'api');
const envFile = join(apiDir, '.env');

if (!existsSync(envFile)) {
  copyFileSync(join(apiDir, '.env.example'), envFile);
  console.log('✔ apps/api/.env criado a partir de .env.example');
}

const run = (cmd) => execSync(cmd, { stdio: 'inherit', cwd: apiDir });

run('npx prisma migrate deploy');
run('npx prisma generate');
run('npm run db:seed');

console.log('\n✔ Tudo pronto! Rode "npm run dev" e acesse http://localhost:5173');
