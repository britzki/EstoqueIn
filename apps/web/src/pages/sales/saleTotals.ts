/**
 * Contas da tela de venda: total, troco, divisão em duas formas e quanto vai para o fiado.
 * O servidor refaz tudo ao gravar; aqui é o que o atendente vê antes de finalizar.
 */
import { parseMoneyInput } from '../../lib/format';
import type { PaymentMethod } from '../../lib/types';

/** Formas oferecidas no caixa, na ordem dos botões. */
export const SALE_METHODS: PaymentMethod[] = ['CASH', 'PIX', 'DEBIT', 'CREDIT', 'ACCOUNT'];

export interface PaymentChoice {
  method: PaymentMethod;
  /** Segunda forma, quando o pagamento é dividido. */
  secondMethod: PaymentMethod;
  split: boolean;
  /** Valor digitado para a primeira forma (divisão). */
  firstAmount: string;
  /** Valor recebido em dinheiro (para o troco). */
  received: string;
}

export function computePayment(total: number, choice: PaymentChoice) {
  const { method, split } = choice;
  const receivedCents = parseMoneyInput(choice.received) ?? 0;
  const firstCents = Math.min(parseMoneyInput(choice.firstAmount) ?? 0, total);
  // A segunda forma nunca repete a primeira.
  const otherMethod =
    choice.secondMethod === method ? SALE_METHODS.find((value) => value !== method)! : choice.secondMethod;
  const change = !split && method === 'CASH' && receivedCents > total ? receivedCents - total : 0;
  const cashShort = !split && method === 'CASH' && choice.received !== '' && receivedCents < total;
  const splitInvalid = split && (firstCents <= 0 || firstCents >= total);

  // Fiado: quanto vai para a conta do cliente nesta venda.
  const accountCents = split
    ? (method === 'ACCOUNT' ? firstCents : 0) + (otherMethod === 'ACCOUNT' ? total - firstCents : 0)
    : method === 'ACCOUNT'
      ? total
      : 0;
  const usesAccount = method === 'ACCOUNT' || (split && otherMethod === 'ACCOUNT');

  // Em dinheiro, a venda registra o valor recebido (o troco sai dele); venda só com brinde não tem pagamento.
  const payments =
    total === 0
      ? []
      : split
        ? [
            { method, amountCents: firstCents },
            { method: otherMethod, amountCents: total - firstCents },
          ]
        : [{ method, amountCents: method === 'CASH' && receivedCents > total ? receivedCents : total }];

  return {
    otherMethod,
    receivedCents,
    firstCents,
    change,
    cashShort,
    splitInvalid,
    accountCents,
    usesAccount,
    payments,
  };
}

/** Passou do limite de fiado do cliente com esta venda? (sem limite = nunca) */
export function exceedsCreditLimit(
  account: { balanceCents: number; creditLimitCents: number | null } | undefined,
  accountCents: number,
) {
  if (!account || account.creditLimitCents === null) return false;
  return account.balanceCents + accountCents > account.creditLimitCents;
}
