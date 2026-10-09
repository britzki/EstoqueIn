import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { unprocessable } from '../../lib/errors.js';
import { scaleConfigFits } from '../../lib/scale.js';
import { optionalText } from '../../lib/validation.js';
import { requirePermission } from '../../middleware/auth.js';
import { actorOf, diff, recordUpdate } from '../../lib/audit.js';
import { getStoreSettings } from './settings.service.js';

export const settingsRoutes = Router();

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
  deliveryFeeCents: z.number().int().min(0).max(100_000),
  deliveryFreeAboveCents: z.number().int().min(0).max(10_000_000),
  deliveryDeadlineMinutes: z
    .number()
    .int()
    .min(10)
    .max(24 * 60),
});

settingsRoutes.get('/', async (_req, res) => {
  res.json(await getStoreSettings());
});

settingsRoutes.put('/', requirePermission('settings:manage'), async (req, res) => {
  const data = settingsSchema.partial().parse(req.body);
  const before = await getStoreSettings();
  // Prefixo e código precisam caber antes do valor na etiqueta; senão nenhuma etiqueta seria lida.
  if (!scaleConfigFits(data.scalePrefix ?? before.scalePrefix, data.scaleCodeDigits ?? before.scaleCodeDigits)) {
    throw unprocessable('Prefixo e dígitos do código da balança não cabem na etiqueta: use menos dígitos');
  }
  const settings = await prisma.storeSettings.update({ where: { id: 1 }, data });
  await recordUpdate(actorOf(req), {
    entity: 'Settings',
    summary: 'Configurações da loja alteradas',
    changes: diff(before, data, Object.keys(data) as Array<keyof typeof data>),
  });
  res.json(settings);
});
