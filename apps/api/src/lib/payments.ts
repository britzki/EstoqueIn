import { PaymentMethod } from '@prisma/client';
import { z } from 'zod';

/** Todas as formas de pagamento. ACCOUNT = fiado (o valor fica na conta do cliente). */
export const PAYMENT_METHODS = Object.values(PaymentMethod);

export const paymentMethodSchema = z.enum(PaymentMethod);

/** Formas em que o dinheiro entra (ou sai) na hora: todas menos o fiado (pagar fiado, pagar conta). */
export const receivingMethodSchema = paymentMethodSchema.exclude(['ACCOUNT']);

/** Valor zerado para cada forma de pagamento (para somar por forma). */
export const zeroByMethod = () =>
  Object.fromEntries(PAYMENT_METHODS.map((method) => [method, 0])) as Record<PaymentMethod, number>;

/**
 * O que a venda recebeu em cada forma de pagamento. O troco sai do dinheiro: em dinheiro, conta só o
 * valor líquido (cliente pagou R$ 50 numa compra de R$ 42 → entraram R$ 42 em dinheiro).
 */
export function netPayments(payments: Array<{ method: PaymentMethod; amountCents: number }>, changeCents: number) {
  let change = changeCents;
  return payments.map((payment) => {
    let amountCents = payment.amountCents;
    if (payment.method === 'CASH' && change > 0) {
      const deducted = Math.min(change, amountCents);
      amountCents -= deducted;
      change -= deducted;
    }
    return { method: payment.method, amountCents };
  });
}
