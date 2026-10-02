/**
 * Recria o banco com a demonstração: uma pequena rede de mercearias fictícia e ~45 dias de operação.
 * A geração dos dados fica em src/modules/setup/demo-data.ts (também usada pela tela de boas-vindas).
 */
import { config } from 'dotenv';
import { prisma } from '../src/lib/prisma.js';
import { DEMO_ACCOUNTS, clearDatabase, loadDemoData } from '../src/modules/setup/demo-data.js';

config({ quiet: true });

async function main() {
  console.info('🌱 Limpando banco...');
  await clearDatabase();

  const summary = await loadDemoData({ log: console.info });
  console.info(
    `\n✅ Seed concluído: ${summary.products} produtos, ${summary.movements} movimentações, ` +
      `${summary.openAlerts} alertas abertos, ${summary.resolvedAlerts} resolvidos.`,
  );
  console.info('\nUsuários de demonstração:');
  console.table(DEMO_ACCOUNTS.map(({ role, email, password }) => ({ perfil: role, email, senha: password })));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
