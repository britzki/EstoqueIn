import { useCallback } from 'react';
import { PAYMENT_LABEL, formatDateTime, formatNumber, formatMoneyPlain } from '../lib/format';
import { SLIP_ROW, SlipFrame, SlipRule, useSlipPrinter } from './Slip';
import type { SaleDetail, StoreSettings } from '../lib/types';

const money = formatMoneyPlain;

/** Notinha de venda para impressora térmica de bobina (58 ou 80 mm). Não é documento fiscal. */
export function Receipt({ sale, settings }: { sale: SaleDetail; settings: StoreSettings }) {
  const row = SLIP_ROW;
  const rule = <SlipRule />;

  return (
    <SlipFrame settings={settings}>
      <p className="text-center text-[1.2em] font-bold uppercase">{settings.storeName}</p>
      {settings.document && <p className="text-center">CNPJ {settings.document}</p>}
      {settings.address && <p className="text-center">{settings.address}</p>}
      {settings.phone && <p className="text-center">{settings.phone}</p>}
      {rule}
      <div className={row}>
        <span className="font-bold">VENDA Nº {sale.number}</span>
        <span>{formatDateTime(sale.createdAt)}</span>
      </div>
      <p>Atendente: {sale.user.name}</p>
      {sale.customerName && <p>Cliente: {sale.customerName}</p>}
      {sale.status === 'CANCELLED' && <p className="text-center font-bold">*** VENDA CANCELADA ***</p>}
      {rule}
      {sale.items.map((item) => (
        <div key={item.id} className="mb-1">
          <p className="break-words">{item.description}</p>
          <div className={row}>
            <span>
              {formatNumber(item.quantity)} {item.unit} x {money(item.unitPriceCents)}
            </span>
            <span>{money(item.totalCents)}</span>
          </div>
          {item.promoDiscountCents ? (
            <div className={row}>
              <span>Promoção (economia)</span>
              <span>-{money(item.promoDiscountCents)}</span>
            </div>
          ) : null}
        </div>
      ))}
      {rule}
      {sale.discountCents > 0 && (
        <>
          <div className={row}>
            <span>Subtotal</span>
            <span>{money(sale.subtotalCents)}</span>
          </div>
          <div className={row}>
            <span>Desconto</span>
            <span>-{money(sale.discountCents)}</span>
          </div>
        </>
      )}
      {(sale.deliveryFeeCents ?? 0) > 0 && (
        <div className={row}>
          <span>Taxa de entrega</span>
          <span>{money(sale.deliveryFeeCents!)}</span>
        </div>
      )}
      <div className={`${row} text-[1.25em] font-bold`}>
        <span>TOTAL R$</span>
        <span>{money(sale.totalCents)}</span>
      </div>
      {sale.payments.map((payment, index) => (
        <div key={index} className={row}>
          <span>{PAYMENT_LABEL[payment.method]}</span>
          <span>{money(payment.amountCents)}</span>
        </div>
      ))}
      {sale.changeCents > 0 && (
        <div className={row}>
          <span>Troco</span>
          <span>{money(sale.changeCents)}</span>
        </div>
      )}
      {sale.payments.some((payment) => payment.method === 'ACCOUNT') && (
        <>
          {rule}
          <p className="font-bold">FIADO: {sale.customerName}</p>
          {sale.customerBalanceCents !== undefined && (
            <div className={row}>
              <span>Total em aberto</span>
              <span>{money(sale.customerBalanceCents)}</span>
            </div>
          )}
          <p className="mt-5 text-center">_______________________</p>
          <p className="text-center">Assinatura do cliente</p>
        </>
      )}
      {sale.returns?.map((saleReturn) => (
        <div key={saleReturn.id} className={row}>
          <span>Devolução {formatDateTime(saleReturn.createdAt)}</span>
          <span>-{money(saleReturn.refundCents)}</span>
        </div>
      ))}
      {rule}
      {settings.receiptFooter && <p className="text-center">{settings.receiptFooter}</p>}
      <p className="mt-1 text-center text-[0.9em]">NÃO É DOCUMENTO FISCAL</p>
    </SlipFrame>
  );
}

/** Imprime a notinha de uma venda. */
export function useReceiptPrinter(settings: StoreSettings | undefined) {
  const slip = useSlipPrinter(settings);
  const { print: printSlip } = slip;
  const print = useCallback(
    (sale: SaleDetail) => settings && printSlip(<Receipt sale={sale} settings={settings} />),
    [settings, printSlip],
  );
  return { print, portal: slip.portal };
}
