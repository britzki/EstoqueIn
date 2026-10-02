import { z } from 'zod';
import { id, nonNegativeInt, optionalId, optionalText, positiveInt } from '../../lib/validation.js';
import { nonNegativeQty, positiveQty } from '../../lib/quantity.js';
import { paginationSchema } from '../../lib/pagination.js';

export const entrySchema = z.object({
  productId: id,
  warehouseId: id,
  quantity: positiveQty,
  unitCostCents: nonNegativeInt.nullable().optional(),
  supplierId: optionalId,
  documentRef: optionalText(60),
  reason: optionalText(255),
});

export const exitSchema = z.object({
  productId: id,
  warehouseId: id,
  quantity: positiveQty,
  documentRef: optionalText(60),
  reason: optionalText(255),
});

export const transferSchema = z.object({
  productId: id,
  fromWarehouseId: id,
  toWarehouseId: id,
  quantity: positiveQty,
  reason: optionalText(255),
});

export const adjustmentSchema = z.object({
  productId: id,
  warehouseId: id,
  newQuantity: nonNegativeQty,
  reason: z.string().trim().min(3, 'Informe o motivo do ajuste').max(255),
});

/** Abrir pacotes fechados para vender a granel. */
export const fractionSchema = z.object({
  bulkProductId: id,
  warehouseId: id,
  packs: positiveInt,
  /** Rendimento real deste lote, se diferente do padrão do produto (ex.: saco veio com 14,8 kg). */
  yieldPerPack: positiveQty.optional(),
  reason: optionalText(255),
});

export const movementTypes = [
  'ENTRY',
  'EXIT',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'ADJUSTMENT',
  'FRACTION_OUT',
  'FRACTION_IN',
  'SALE_CANCEL',
  'SALE_RETURN',
] as const;

export const movementFiltersSchema = paginationSchema.extend({
  productId: z.string().optional(),
  warehouseId: z.string().optional(),
  userId: z.string().optional(),
  type: z.enum(movementTypes).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

export type EntryInput = z.infer<typeof entrySchema>;
export type ExitInput = z.infer<typeof exitSchema>;
export type TransferInput = z.infer<typeof transferSchema>;
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;
export type FractionInput = z.infer<typeof fractionSchema>;
