// Prepara o ambiente local: cria o .env a partir do exemplo, aplica as migrations e, na primeira vez,
// popula o banco com a demonstração.
import { copyFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const apiDir = join(import.meta.dirname, '..', 'apps', 'api');
const envFile = join(apiDir, '.env');

// Banco já existente: atualiza a estrutura, mas não apaga o que o desenvolvedor tem nele.
const freshDatabase = !existsSync(join(apiDir, 'prisma', 'dev.db'));

if (!existsSync(envFile)) {
  copyFileSync(join(apiDir, '.env.example'), envFile);
  console.log('✔ apps/api/.env criado a partir de .env.example');
}

const run = (cmd) => execSync(cmd, { stdio: 'inherit', cwd: apiDir });

run('npx prisma migrate deploy');
run('npx prisma generate');
if (freshDatabase) run('npm run db:seed');
else console.log('ℹ Banco já existente mantido (rode "npm run db:seed" para recriar a demonstração).');

console.log('\n✔ Tudo pronto! Rode "npm run dev" e acesse http://localhost:5173');
