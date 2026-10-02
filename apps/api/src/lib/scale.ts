import { isValidGtin } from './barcode.js';

export interface ScaleConfig {
  /** Dígito(s) inicial(is) que identificam etiqueta de balança (normalmente "2"). */
  scalePrefix: string;
  /** Quantos dígitos tem o código do produto na etiqueta (4, 5 ou 6). */
  scaleCodeDigits: number;
  /** O que a balança grava na etiqueta: peso (gramas) ou preço total (centavos). */
  scaleValueType: string;
}

export interface ScaleLabel {
  scaleCode: string;
  /** Peso em kg quando a etiqueta traz peso. */
  weightKg?: number;
  /** Preço total em centavos quando a etiqueta traz preço. */
  totalCents?: number;
}

const VALUE_DIGITS = 5;

/** Compara códigos ignorando zeros à esquerda ("000123" = "123"). */
export const normalizeScaleCode = (code: string) => code.replace(/^0+(?=\d)/, '');

/**
 * Lê a etiqueta de uma balança etiquetadora. O código de barras é um EAN-13 no formato:
 *
 *   [prefixo][código do produto][zeros de preenchimento][valor: 5 dígitos][dígito verificador]
 *   ex.:  2 000123 01250 3  → produto 123, 1,250 kg (ou R$ 12,50, se a balança gravar preço)
 */
export function parseScaleLabel(barcode: string, config: ScaleConfig): ScaleLabel | null {
  if (!/^\d{13}$/.test(barcode) || !barcode.startsWith(config.scalePrefix) || !isValidGtin(barcode)) return null;

  const codeStart = config.scalePrefix.length;
  const codeEnd = codeStart + config.scaleCodeDigits;
  const valueStart = 12 - VALUE_DIGITS;
  if (codeEnd > valueStart) return null;

  const scaleCode = normalizeScaleCode(barcode.slice(codeStart, codeEnd));
  const value = Number(barcode.slice(valueStart, 12));
  if (value <= 0) return null;

  return config.scaleValueType === 'PRICE' ? { scaleCode, totalCents: value } : { scaleCode, weightKg: value / 1000 };
}
