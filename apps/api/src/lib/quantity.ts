import { z } from 'zod';

/**
 * Quantidades de estoque têm no máximo 3 casas decimais (0,001), o padrão das balanças comerciais.
 *
 * Elas são guardadas como número decimal e SEMPRE arredondadas antes de gravar. Sem isso, somas
 * em ponto flutuante acumulam resíduos (0,1 + 0,2 = 0,30000000000000004) e um saldo que deveria
 * ser 0 viraria 0,00000000001, o que quebraria comparações como "saldo <= mínimo".
 */
export const QUANTITY_DECIMALS = 3;
const FACTOR = 10 ** QUANTITY_DECIMALS;

export const roundQty = (value: number) => Math.round((value + Number.EPSILON) * FACTOR) / FACTOR;

/** Verdadeiro se o valor já está em passos de 0,001 (tolerando o ruído do ponto flutuante). */
export const hasValidPrecision = (value: number) => Math.abs(value * FACTOR - Math.round(value * FACTOR)) < 1e-6;

export const isWholeNumber = (value: number) => Math.abs(value - Math.round(value)) < 1e-9;

const base = z.coerce
  .number({ error: 'Informe um número' })
  .refine(Number.isFinite, 'Informe um número')
  .refine(hasValidPrecision, 'Use no máximo 3 casas decimais')
  .max(1_000_000, 'Quantidade muito grande')
  .transform(roundQty);

/** Quantidade maior que zero (entradas, saídas, transferências). */
export const positiveQty = base.refine((value) => value > 0, 'Deve ser maior que zero');

/** Quantidade zero ou positiva (saldo contado, estoque mínimo). */
export const nonNegativeQty = base.refine((value) => value >= 0, 'Não pode ser negativo');

/** Unidades que, por padrão, indicam venda fracionada. */
export const FRACTIONAL_UNITS = ['KG', 'G', 'L', 'ML', 'M'];
