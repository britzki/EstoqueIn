import { prisma, type Tx } from '../../lib/prisma.js';

/** As configurações da loja ficam num registro único, criado com os padrões no primeiro acesso. */
export const getStoreSettings = (client: Tx = prisma) =>
  client.storeSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
