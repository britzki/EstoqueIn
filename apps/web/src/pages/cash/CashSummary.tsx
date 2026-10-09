import { Banknote, Receipt, Wallet } from 'lucide-react';
import { cn } from '../../lib/cn';
import { PAYMENT_LABEL, PAYMENT_METHODS, RECEIVING_METHODS, formatDateTime, formatMoney } from '../../lib/format';
import type { CashDetail } from '../../lib/types';
import { Card, CardHeader, StatCard, Table, Td } from '../../components/ui';

/** Resumo de um caixa: vendas, dinheiro esperado na gaveta, formas de pagamento e sangrias. */
export function CashSummaryView({ cash }: { cash: CashDetail }) {
  const { summary } = cash;
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Vendas"
          value={summary.salesCount}
          hint={`${summary.cancelledCount} cancelada(s)`}
          icon={<Receipt />}
        />
        {summary.revenueCents !== null && (
          <StatCard
            label="Faturamento"
            value={formatMoney(summary.revenueCents)}
            hint={summary.returnsCount ? `já sem ${summary.returnsCount} devolução(ões)` : undefined}
            icon={<Banknote />}
          />
        )}
        <StatCard label="Troco inicial" value={formatMoney(cash.openingCents)} icon={<Wallet />} tone="slate" />
        <StatCard
          label="Dinheiro esperado na gaveta"
          value={formatMoney(summary.expectedCashCents)}
          hint="troco + dinheiro (vendas e fiado recebido) − sangrias + suprimentos"
          icon={<Banknote />}
          tone="amber"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Recebido por forma de pagamento" />
          <Table>
            <tbody>
              {PAYMENT_METHODS.filter(
                (method) =>
                  summary.byMethod[method] !== undefined &&
                  (!['OTHER', 'ACCOUNT'].includes(method) || summary.byMethod[method]),
              ).map((method) => (
                <tr key={method}>
                  <Td>{method === 'ACCOUNT' ? 'Vendido no fiado (a receber)' : PAYMENT_LABEL[method]}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(summary.byMethod[method] ?? 0)}</Td>
                </tr>
              ))}
              {RECEIVING_METHODS.filter((method) => summary.accountReceivedByMethod[method] > 0).map((method) => (
                <tr key={`fiado-${method}`}>
                  <Td>Fiado recebido ({PAYMENT_LABEL[method]})</Td>
                  <Td className="text-right tabular-nums">{formatMoney(summary.accountReceivedByMethod[method])}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Sangrias e suprimentos" />
          {cash.movements.length === 0 ? (
            <p className="px-5 py-4 text-sm text-slate-500">Nenhuma retirada ou reforço de troco.</p>
          ) : (
            <Table>
              <tbody>
                {cash.movements.map((movement) => (
                  <tr key={movement.id}>
                    <Td className="whitespace-nowrap">{formatDateTime(movement.createdAt)}</Td>
                    <Td>
                      {movement.reason}
                      <span className="block text-xs text-slate-500">{movement.user.name}</span>
                    </Td>
                    <Td
                      className={cn(
                        'text-right whitespace-nowrap tabular-nums',
                        movement.type === 'WITHDRAWAL' ? 'text-red-700' : 'text-emerald-700',
                      )}
                    >
                      {movement.type === 'WITHDRAWAL' ? '−' : '+'} {formatMoney(movement.amountCents)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}

/** Quanto tirar da gaveta (o lucro do dia em dinheiro) e quanto deixar para o troco de amanhã. */
export function WithdrawalNotice({ withdrawal, kept }: { withdrawal: number; kept: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 text-sm">
      <div className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-3">
        <p className="text-brand-800">Retirar da gaveta</p>
        <p className="text-xl font-semibold text-slate-900 tabular-nums">{formatMoney(withdrawal)}</p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-slate-600">Fica na gaveta</p>
        <p className="text-xl font-semibold text-slate-900 tabular-nums">{formatMoney(kept)}</p>
      </div>
    </div>
  );
}

export function DifferenceNotice({ difference }: { difference: number }) {
  if (difference === 0) {
    return (
      <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
        Caixa bateu: sem diferença.
      </p>
    );
  }
  return (
    <p
      className={cn(
        'rounded-lg px-4 py-3 text-sm font-medium',
        difference < 0 ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800',
      )}
    >
      {difference < 0 ? 'Falta' : 'Sobra'} de {formatMoney(Math.abs(difference))} em relação ao esperado.
    </p>
  );
}
