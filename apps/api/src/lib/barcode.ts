import { randomInt } from 'node:crypto';

const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

/** Dígito verificador GTIN (EAN-8, UPC-A, EAN-13, GTIN-14). */
export function gtinCheckDigit(body: string): number {
  const sum = [...body].reverse().reduce((acc, digit, index) => acc + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10;
}

export function isValidGtin(code: string): boolean {
  if (!/^\d+$/.test(code) || !GTIN_LENGTHS.has(code.length)) return false;
  return gtinCheckDigit(code.slice(0, -1)) === Number(code.at(-1));
}

/**
 * Aceita GTIN numérico (validando o dígito verificador) ou código alfanumérico
 * livre (Code 128) para etiquetas internas.
 */
export function validateBarcode(code: string): string | null {
  if (/^\d+$/.test(code) && GTIN_LENGTHS.has(code.length)) {
    return isValidGtin(code) ? null : 'Dígito verificador do código de barras inválido';
  }
  if (!/^[\x20-\x7E]{1,48}$/.test(code)) {
    return 'Código de barras deve ter até 48 caracteres ASCII';
  }
  return null;
}

/**
 * Gera um EAN-13 de uso interno. O prefixo "2" é reservado pelo GS1 para
 * circulação restrita (uso dentro da própria loja), então não colide com produtos reais.
 */
export function generateInternalEan13(randomDigit: () => number = () => randomInt(10)): string {
  const body = '2' + Array.from({ length: 11 }, randomDigit).join('');
  return body + gtinCheckDigit(body);
}
