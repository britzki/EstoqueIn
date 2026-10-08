import { PAYMENT_LABEL, formatDateTime, formatMoney } from '../../lib/format';
import type { CashDetail, PaymentMethod, StoreSettings } from '../../lib/types';

const money = (cents: number) => formatMoney(cents).replace('R$', '').trim();
const METHODS: PaymentMethod[] = ['CASH', 'PIX', 'DEBIT', 'CREDIT', 'OTHER', 'ACCOUNT'];

/** Comprovante de fechamento de caixa para a bobina: fica guardado junto com o dinheiro. */
export function CashSlip({ cash, settings }: { cash: CashDetail; settings: StoreSettings }) {
  const narrow = settings.receiptWidth === 58;
  const row = 'flex justify-between gap-2';
  const rule = <div className="my-1.5 border-t border-dashed border-black" />;
  const { summary } = cash;

  return (
    <div
      className="bg-white font-mono leading-tight text-black"
      style={{ width: narrow ? '48mm' : '72mm', fontSize: narrow ? '10px' : '11.5px', padding: '2mm' }}
    >
      <p className="text-center text-[1.2em] font-bold uppercase">{settings.storeName}</p>
      <p className="text-center font-bold">FECHAMENTO DE CAIXA Nº {cash.number}</p>
      {rule}
      <p>Abertura: {formatDateTime(cash.openedAt)}</p>
      <p>Por: {cash.openedBy.name}</p>
      {cash.closedAt && <p>Fechamento: {formatDateTime(cash.closedAt)}</p>}
      {cash.closedBy && <p>Por: {cash.closedBy.name}</p>}
      {rule}
      <div className={row}>
        <span>Vendas</span>
        <span>{summary.salesCount}</span>
      </div>
      {summary.cancelledCount > 0 && (
        <div className={row}>
          <span>Canceladas</span>
          <span>{summary.cancelledCount}</span>
        </div>
      )}
      {summary.returnsCount > 0 && (
        <div className={row}>
          <span>Devoluções</span>
          <span>{summary.returnsCount}</span>
        </div>
      )}
      {summary.revenueCents !== null && (
        <div className={`${row} font-bold`}>
          <span>Faturamento</span>
          <span>{money(summary.revenueCents)}</span>
        </div>
      )}
      {rule}
      {METHODS.filter((method) => summary.byMethod[method]).map((method) => (
        <div key={method} className={row}>
          <span>{PAYMENT_LABEL[method]}</span>
          <span>{money(summary.byMethod[method] ?? 0)}</span>
        </div>
      ))}
      {rule}
      {summary.accountReceivedCents > 0 && (
        <>
          {METHODS.filter((method) => method !== 'ACCOUNT' && summary.accountReceivedByMethod[method as 'CASH']).map(
            (method) => (
              <div key={method} className={row}>
                <span>Fiado recebido ({PAYMENT_LABEL[method]})</span>
                <span>{money(summary.accountReceivedByMethod[method as 'CASH'])}</span>
              </div>
            ),
          )}
          {rule}
        </>
      )}
      <div className={row}>
        <span>Troco inicial</span>
        <span>{money(cash.openingCents)}</span>
      </div>
      <div className={row}>
        <span>Suprimentos</span>
        <span>{money(summary.depositsCents)}</span>
      </div>
      <div className={row}>
        <span>Sangrias</span>
        <span>-{money(summary.withdrawalsCents)}</span>
      </div>
      <div className={`${row} font-bold`}>
        <span>Esperado</span>
        <span>{money(cash.expectedCents ?? summary.expectedCashCents)}</span>
      </div>
      {cash.countedCents !== null && (
        <>
          <div className={`${row} font-bold`}>
            <span>Contado</span>
            <span>{money(cash.countedCents)}</span>
          </div>
          <div className={`${row} text-[1.15em] font-bold`}>
            <span>Diferença</span>
            <span>{money(summary.differenceCents ?? 0)}</span>
          </div>
          {cash.keptCents !== null && (
            <>
              {rule}
              <div className={`${row} font-bold`}>
                <span>Retirado</span>
                <span>{money(summary.closingWithdrawalCents ?? 0)}</span>
              </div>
              <div className={row}>
                <span>Fica na gaveta</span>
                <span>{money(cash.keptCents)}</span>
              </div>
            </>
          )}
        </>
      )}
      {cash.notes && (
        <>
          {rule}
          <p className="break-words">Obs.: {cash.notes}</p>
        </>
      )}
      {rule}
      <p className="mt-4 text-center">_______________________</p>
      <p className="text-center">Assinatura</p>
    </div>
  );
}
