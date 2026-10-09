import { describe, expect, it } from 'vitest';
import { computePayment, exceedsCreditLimit, type PaymentChoice } from './saleTotals';

const cash: PaymentChoice = { method: 'CASH', secondMethod: 'PIX', split: false, firstAmount: '', received: '' };

describe('Pagamento na tela de venda', () => {
  it('dinheiro com troco registra o valor recebido', () => {
    const result = computePayment(4200, { ...cash, received: '50' });
    expect(result.change).toBe(800);
    expect(result.cashShort).toBe(false);
    expect(result.payments).toEqual([{ method: 'CASH', amountCents: 5000 }]);
  });

  it('dinheiro a menos que o total bloqueia', () => {
    expect(computePayment(4200, { ...cash, received: '40' }).cashShort).toBe(true);
  });

  it('dividido: a segunda forma leva o restante e nunca repete a primeira', () => {
    const result = computePayment(10000, {
      ...cash,
      method: 'PIX',
      secondMethod: 'PIX',
      split: true,
      firstAmount: '30',
    });
    expect(result.otherMethod).toBe('CASH');
    expect(result.payments).toEqual([
      { method: 'PIX', amountCents: 3000 },
      { method: 'CASH', amountCents: 7000 },
    ]);
    expect(computePayment(10000, { ...cash, split: true, firstAmount: '100' }).splitInvalid).toBe(true);
  });

  it('fiado: soma só a parte no fiado e confere o limite', () => {
    const result = computePayment(10000, {
      ...cash,
      method: 'PIX',
      secondMethod: 'ACCOUNT',
      split: true,
      firstAmount: '40',
    });
    expect(result.accountCents).toBe(6000);
    expect(result.usesAccount).toBe(true);
    expect(exceedsCreditLimit({ balanceCents: 5000, creditLimitCents: 10000 }, result.accountCents)).toBe(true);
    expect(exceedsCreditLimit({ balanceCents: 4000, creditLimitCents: 10000 }, result.accountCents)).toBe(false);
    expect(exceedsCreditLimit({ balanceCents: 99999, creditLimitCents: null }, result.accountCents)).toBe(false);
  });

  it('venda só com brinde não tem pagamento', () => {
    expect(computePayment(0, cash).payments).toEqual([]);
  });
});
