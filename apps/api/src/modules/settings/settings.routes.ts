import { Router } from 'express';
import { z } from 'zod';
import { prisma, type Tx } from '../../lib/prisma.js';
import { optionalText } from '../../lib/validation.js';
import { requirePermission } from '../../middleware/auth.js';
import { actorOf, diff, recordUpdate } from '../../lib/audit.js';

export const settingsRoutes = Router();

/** As configurações da loja ficam num registro único, criado com os padrões no primeiro acesso. */
export const getStoreSettings = (client: Tx = prisma) =>
  client.storeSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });

const settingsSchema = z.object({
  storeName: z.string().trim().min(2, 'Informe o nome da loja').max(80),
  document: optionalText(20),
  address: optionalText(160),
  phone: optionalText(30),
  receiptFooter: optionalText(160),
  receiptWidth: z.union([z.literal(58), z.literal(80)]),
  autoPrint: z.boolean(),
  allowNegativeStock: z.boolean(),
  requireCashSession: z.boolean(),
  cashFloatCents: z.number().int().min(0).max(10_000_000),
  scalePrefix: z.string().regex(/^\d{1,2}$/, 'Use 1 ou 2 dígitos'),
  scaleCodeDigits: z.number().int().min(4).max(6),
  scaleValueType: z.enum(['WEIGHT', 'PRICE']),
});

settingsRoutes.get('/', async (_req, res) => {
  res.json(await getStoreSettings());
});

settingsRoutes.put('/', requirePermission('settings:manage'), async (req, res) => {
  const data = settingsSchema.partial().parse(req.body);
  const before = await getStoreSettings();
  const settings = await prisma.storeSettings.update({ where: { id: 1 }, data });
  await recordUpdate(actorOf(req), {
    entity: 'Settings',
    summary: 'Configurações da loja alteradas',
    changes: diff(before, data, Object.keys(data) as Array<keyof typeof data>),
  });
  res.json(settings);
});
