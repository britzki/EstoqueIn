import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { desktop } from '../lib/desktop';
import { PAYMENT_LABEL, formatDateTime, formatMoney, formatNumber } from '../lib/format';
import type { SaleDetail, StoreSettings } from '../lib/types';

const money = (cents: number) => formatMoney(cents).replace('R$', '').trim();

/** Notinha de venda para impressora térmica de bobina (58 ou 80 mm). Não é documento fiscal. */
export function Receipt({ sale, settings }: { sale: SaleDetail; settings: StoreSettings }) {
  const narrow = settings.receiptWidth === 58;
  const row = 'flex justify-between gap-2';
  const rule = <div className="my-1.5 border-t border-dashed border-black" />;

  return (
    <div
      className="bg-white font-mono leading-tight text-black"
      style={{ width: narrow ? '48mm' : '72mm', fontSize: narrow ? '10px' : '11.5px', padding: '2mm' }}
    >
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
      {sale.returns?.map((saleReturn) => (
        <div key={saleReturn.id} className={row}>
          <span>Devolução {formatDateTime(saleReturn.createdAt)}</span>
          <span>-{money(saleReturn.refundCents)}</span>
        </div>
      ))}
      {rule}
      {settings.receiptFooter && <p className="text-center">{settings.receiptFooter}</p>}
      <p className="mt-1 text-center text-[0.9em]">NÃO É DOCUMENTO FISCAL</p>
    </div>
  );
}

/**
 * Imprime um comprovante na bobina: monta o conteúdo na área de impressão (#print-root) e chama a impressora.
 * No programa desktop a impressão é direta (sem diálogo) se a impressora estiver configurada.
 */
export function useSlipPrinter(settings: StoreSettings | undefined) {
  const [content, setContent] = useState<ReactNode | null>(null);

  useEffect(() => {
    if (!content || !settings) return;
    // Espera o conteúdo aparecer na página antes de imprimir.
    const timer = setTimeout(async () => {
      try {
        if (desktop) await desktop.printReceipt(settings.receiptWidth);
        else window.print();
      } finally {
        setContent(null);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [content, settings]);

  const print = useCallback((node: ReactNode) => setContent(node), []);

  const portal =
    content && settings
      ? createPortal(
          <>
            <style>{`@media print { @page { size: ${settings.receiptWidth}mm auto; margin: 0; } }`}</style>
            {content}
          </>,
          document.getElementById('print-root')!,
        )
      : null;

  return { print, portal };
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
