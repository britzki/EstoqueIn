import { z } from 'zod';

const emptyToNull = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? null : value);

/** Texto opcional: string vazia vira null (comum em formulários). */
export const optionalText = (max = 255) => z.preprocess(emptyToNull, z.string().trim().max(max).nullable().optional());

export const id = z.string().min(1, 'Obrigatório');

export const optionalId = z.preprocess(emptyToNull, z.string().min(1).nullable().optional());

export const positiveInt = z.coerce.number().int('Use números inteiros').positive('Deve ser maior que zero');

export const nonNegativeInt = z.coerce.number().int('Use números inteiros').min(0, 'Não pode ser negativo');

/** Query string booleana: "true"/"false". */
export const queryBoolean = z.enum(['true', 'false']).transform((value) => value === 'true');
