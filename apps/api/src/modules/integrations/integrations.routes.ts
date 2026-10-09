import { Router } from 'express';
import { env } from '../../config/env.js';
import { AppError, badRequest } from '../../lib/errors.js';
import { param } from '../../lib/http.js';
import { requirePermission } from '../../middleware/auth.js';
import { ExternalServiceError, lookupBarcode } from './open-food-facts.js';

export const integrationsRoutes = Router();

// Só quem cadastra produtos usa (preenche nome e categoria no cadastro).
integrationsRoutes.get('/barcode/:code', requirePermission('products:write'), async (req, res) => {
  if (!env.BARCODE_LOOKUP_ENABLED) throw new AppError(503, 'Consulta externa desativada', 'INTEGRATION_DISABLED');

  const code = param(req, 'code').trim();
  if (!/^\d{8,14}$/.test(code)) throw badRequest('Informe um código de barras numérico (EAN/GTIN)');

  try {
    res.json(await lookupBarcode(code));
  } catch (error) {
    if (error instanceof ExternalServiceError) throw new AppError(502, error.message, 'EXTERNAL_SERVICE_ERROR');
    throw error;
  }
});
