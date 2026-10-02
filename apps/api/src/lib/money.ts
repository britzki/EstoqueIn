/**
 * Converte valores monetários escritos de várias formas em centavos.
 * Aceita: 12 | 12.5 | "12,50" | "1.234,56" | "1234.56" | "R$ 9,90"
 */
export function parseMoneyToCents(input: string | number): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null;

  let text = input.replace(/R\$|\s/g, '');
  if (!text) return null;

  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma > lastDot) {
    text = text.replaceAll('.', '').replace(',', '.');
  } else {
    text = text.replaceAll(',', '');
  }

  const value = Number(text);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

/** 1234 → "R$ 12,34" (textos de registro e mensagens). */
export const formatCents = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
