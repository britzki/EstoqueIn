import { z } from 'zod';
import { validateBarcode } from '../../lib/barcode.js';
import { paginationSchema } from '../../lib/pagination.js';
import { nonNegativeInt, optionalId, optionalText, queryBoolean } from '../../lib/validation.js';
import { nonNegativeQty, positiveQty } from '../../lib/quantity.js';

export const skuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, 'SKU obrigatório')
  .max(40)
  .regex(/^[A-Z0-9._-]+$/, 'SKU aceita apenas letras, números, ponto, hífen e sublinhado');

export const barcodeSchema = optionalText(48).superRefine((value, ctx) => {
  const error = value ? validateBarcode(value) : null;
  if (error) ctx.addIssue({ code: 'custom', message: error });
});

export const productSchema = z.object({
  sku: skuSchema,
  barcode: barcodeSchema,
  name: z.string().trim().min(2, 'Informe o nome').max(150),
  description: optionalText(1000),
  category: optionalText(60),
  unit: z.string().trim().toUpperCase().min(1).max(10).optional(),
  costCents: nonNegativeInt.optional(),
  priceCents: nonNegativeInt.optional(),
  minStock: nonNegativeQty.optional(),
  /** Aceita quantidade com casas decimais (kg, L, m). Se omitido, é deduzido da unidade. */
  fractional: z.boolean().optional(),
  /** Para produto a granel: de qual produto fechado ele vem e quanto cada unidade rende. */
  sourceProductId: optionalId,
  sourceYield: positiveQty.nullable().optional(),
  /** Código do produto na balança etiquetadora (PLU). */
  scaleCode: z.preprocess(
    (value) => (value === '' ? null : value),
    z
      .string()
      .trim()
      .regex(/^\d{1,6}$/, 'Use de 1 a 6 dígitos')
      .nullable()
      .optional(),
  ),
  supplierId: optionalId,
  /** Botão rápido na tela de venda. */
  quickSale: z.boolean().optional(),
  /** Kit: vendido com preço próprio, baixa o estoque dos componentes. */
  isKit: z.boolean().optional(),
  active: z.boolean().optional(),
});

export const productUpdateSchema = productSchema.partial();

export const productFiltersSchema = paginationSchema.extend({
  search: z.string().trim().optional(),
  category: z.string().optional(),
  supplierId: z.string().optional(),
  active: queryBoolean.optional(),
  withAlerts: queryBoolean.optional(),
});

export const minQuantitySchema = z.object({
  minQuantity: nonNegativeQty.nullable(),
});
