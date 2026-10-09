/**
 * Recuperação de acesso na versão web/servidor: gera uma senha temporária para o administrador.
 * Uso (na pasta apps/api, por quem tem acesso ao servidor):  npm run admin:reset
 */
import '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { resetAdminPassword } from '../modules/users/recovery.js';

resetAdminPassword('servidor (linha de comando)')
  .then(({ name, email, temporaryPassword }) => {
    console.info(`\nSenha temporária de ${name} (${email}): ${temporaryPassword}`);
    console.info('Ela precisa ser trocada no primeiro acesso.\n');
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
