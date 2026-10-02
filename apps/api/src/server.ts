import { join } from 'node:path';
import { env } from './config/env.js';
import { createApp } from './app.js';
import { prisma } from './lib/prisma.js';
import { registerAlertNotifier } from './modules/alerts/alert-notifier.js';

registerAlertNotifier();

// Em produção a API também entrega o front-end compilado (apps/web/dist).
const webDist = env.NODE_ENV === 'production' ? join(import.meta.dirname, '..', '..', 'web', 'dist') : undefined;

const server = createApp({ webDist }).listen(env.PORT, () => {
  console.info(`🚀 EstoqueIn API rodando em http://localhost:${env.PORT}`);
});

const shutdown = async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
