import { describe, expect, it } from 'vitest';
import { parseMoneyInput } from './format';

describe('parseMoneyInput', () => {
  it.each([
    ['12,50', 1250],
    ['12.50', 1250],
    ['12.5', 1250],
    ['0,99', 99],
    ['R$ 1.250,00', 125000],
    ['1.250', 125000],
    ['1.234.567,89', 123456789],
    ['250', 25000],
    [' 3 ', 300],
  ])('"%s" → %i centavos', (text, cents) => {
    expect(parseMoneyInput(text)).toBe(cents);
  });

  it.each(['', 'abc', '-5', '1,2,3'])('"%s" é inválido', (text) => {
    expect(parseMoneyInput(text)).toBeNull();
  });
});
