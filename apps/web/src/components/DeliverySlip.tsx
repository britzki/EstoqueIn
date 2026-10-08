import { useCallback } from 'react';
import { api } from '../lib/api';
import { addressLine, collectInfo, formatDue } from '../lib/delivery';
import { formatDateTime, formatNumber, formatPhone, formatMoney, PAYMENT_LABEL } from '../lib/format';
import type { DeliveryDetail, StoreSettings } from '../lib/types';
import { useSlipPrinter } from './Receipt';

const money = (cents: number) => formatMoney(cents).replace('R$', '').trim();

/**
 * Guia de entrega: vai junto com o pacote. Endereço em destaque, o que cobrar na porta
 * (com o troco) e os itens para o cliente conferir.
 */
export function DeliverySlip({ delivery, settings }: { delivery: DeliveryDetail; settings: StoreSettings }) {
  const narrow = settings.receiptWidth === 58;
  const row = 'flex justify-between gap-2';
  const rule = <div className="my-1.5 border-t border-dashed border-black" />;
  const collect = collectInfo(delivery);
  const { sale } = delivery;

  return (
    <div
      className="bg-white font-mono leading-tight text-black"
      style={{ width: narrow ? '48mm' : '72mm', fontSize: narrow ? '10px' : '11.5px', padding: '2mm' }}
    >
      <p className="text-center font-bold uppercase">{settings.storeName}</p>
      <p className="text-center text-[1.3em] font-bold">ENTREGA Nº {delivery.number}</p>
      <div className={row}>
        <span>Venda nº {sale.number}</span>
        <span>{formatDateTime(sale.createdAt)}</span>
      </div>
      <p className="font-bold">
        {delivery.scheduled ? 'AGENDADA PARA' : 'ENTREGAR ATÉ'}: {formatDue(delivery.dueAt)}
      </p>
      {rule}
      <p className="text-[1.2em] font-bold">{delivery.customer.name}</p>
      {delivery.phone && <p>Tel: {formatPhone(delivery.phone)}</p>}
      <p className="mt-1 text-[1.2em] font-bold break-words">{addressLine(delivery)}</p>
      {delivery.reference && <p className="break-words">Ref.: {delivery.reference}</p>}
      {delivery.notes && <p className="break-words">Obs.: {delivery.notes}</p>}
      {rule}
      {sale.items.map((item) => (
        <div key={item.id} className={row}>
          <span className="break-words">
            {formatNumber(item.quantity)} {item.unit} {item.description}
          </span>
          <span>{money(item.totalCents)}</span>
        </div>
      ))}
      {sale.discountCents > 0 && (
        <div className={row}>
          <span>Desconto</span>
          <span>-{money(sale.discountCents)}</span>
        </div>
      )}
      <div className={row}>
        <span>Taxa de entrega</span>
        <span>{sale.deliveryFeeCents > 0 ? money(sale.deliveryFeeCents) : 'grátis'}</span>
      </div>
      <div className={`${row} text-[1.15em] font-bold`}>
        <span>TOTAL R$</span>
        <span>{money(sale.totalCents)}</span>
      </div>
      {rule}
      {collect ? (
        <>
          <p className="text-center text-[1.3em] font-bold">COBRAR: R$ {money(collect.amountCents)}</p>
          <p className="text-center">{collect.methods}</p>
          {collect.paysWithCents !== null && (
            <p className="text-center font-bold">
              Paga com {money(collect.paysWithCents)} · TROCO {money(collect.changeCents)}
            </p>
          )}
        </>
      ) : (
        <p className="text-center text-[1.2em] font-bold">
          JÁ PAGO
          {sale.payments.length > 0 && ` (${sale.payments.map((p) => PAYMENT_LABEL[p.method]).join(' + ')})`}
        </p>
      )}
      {rule}
      <p className="mt-5 text-center">_______________________</p>
      <p className="text-center">Recebido por</p>
      <p className="mt-2 text-center text-[0.9em]">NÃO É DOCUMENTO FISCAL</p>
    </div>
  );
}

/** Imprime a guia de entrega (busca os dados completos da entrega antes). */
export function useDeliverySlipPrinter(settings: StoreSettings | undefined) {
  const slip = useSlipPrinter(settings);
  const { print: printSlip } = slip;
  const print = useCallback(
    async (delivery: DeliveryDetail | string) => {
      if (!settings) return;
      const full = typeof delivery === 'string' ? await api.get<DeliveryDetail>(`/deliveries/${delivery}`) : delivery;
      printSlip(<DeliverySlip delivery={full} settings={settings} />);
    },
    [settings, printSlip],
  );
  return { print, portal: slip.portal };
}
