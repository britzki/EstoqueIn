import { describe, expect, it } from 'vitest';
import { generateInternalEan13, isValidGtin, validateBarcode } from '../src/lib/barcode.js';
import { parseMoneyToCents } from '../src/lib/money.js';
import { toCsv } from '../src/lib/csv.js';

describe('Código de barras (GTIN)', () => {
  it.each(['7891234567895', '3017620422003', '96385074', '036000291452'])('aceita %s', (code) => {
    expect(isValidGtin(code)).toBe(true);
  });

  it('rejeita dígito verificador errado', () => {
    expect(validateBarcode('7891234567891')).toMatch(/verificador/);
  });

  it('aceita código interno alfanumérico (Code 128)', () => {
    expect(validateBarcode('LOTE-A1-2026')).toBeNull();
  });

  it('gera EAN-13 interno válido com prefixo 2', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateInternalEan13();
      expect(code).toMatch(/^2\d{12}$/);
      expect(isValidGtin(code)).toBe(true);
    }
  });
});

describe('Valores monetários', () => {
  it.each([
    ['12,50', 1250],
    ['1.234,56', 123456],
    ['1234.56', 123456],
    ['R$ 9,90', 990],
    ['3', 300],
    ['abc', null],
  ])('converte %s em %s centavos', (input, expected) => {
    expect(parseMoneyToCents(input)).toBe(expected);
  });
});

describe('Exportação CSV', () => {
  it('usa ponto e vírgula, BOM e escapa aspas', () => {
    const csv = toCsv(
      [{ name: 'Café "especial"; 500g', qty: 3 }],
      [
        { header: 'Produto', value: (r) => r.name },
        { header: 'Qtd', value: (r) => r.qty },
      ],
    );
    expect(csv).toBe('﻿Produto;Qtd\r\n"Café ""especial""; 500g";3');
  });
});
