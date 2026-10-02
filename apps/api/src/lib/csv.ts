import type { Response } from 'express';

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

const escape = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return '';
  // Números com vírgula decimal, como o Excel em pt-BR espera (0.35 → 0,35).
  const text = typeof value === 'number' ? String(value).replace('.', ',') : String(value);
  return /[";\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** Gera CSV com ";" como separador e BOM, para abrir corretamente no Excel em pt-BR. */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]) {
  const lines = [
    columns.map((column) => escape(column.header)).join(';'),
    ...rows.map((row) => columns.map((column) => escape(column.value(row))).join(';')),
  ];
  return '﻿' + lines.join('\r\n');
}

export function sendCsv(res: Response, filename: string, content: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(content);
}

/** Formata centavos como "1234,56" (padrão de planilhas em pt-BR). */
export const centsToDecimal = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? '' : (cents / 100).toFixed(2).replace('.', ',');
