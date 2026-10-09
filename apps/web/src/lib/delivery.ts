import type { Delivery, DeliveryDetail, DeliveryStatus, StoreSettings } from './types';
import { firstName, formatMoney, PAYMENT_LABEL } from './format';

/** Mesma regra do servidor: cobra a taxa quando os produtos (com desconto) ficam abaixo do mínimo. */
export const deliveryFee = (
  itemsCents: number,
  settings: Pick<StoreSettings, 'deliveryFeeCents' | 'deliveryFreeAboveCents'> | undefined,
  waive = false,
) => (!settings || waive || itemsCents >= settings.deliveryFreeAboveCents ? 0 : settings.deliveryFeeCents);

export const DELIVERY_STATUS: Record<DeliveryStatus, string> = {
  PENDING: 'A separar',
  OUT: 'Saiu para entrega',
  DELIVERED: 'Entregue',
  FAILED: 'Não entregue',
  CANCELLED: 'Cancelada',
};

/** "Rua das Flores, 120 - ap 3 - Centro" */
export const addressLine = (d: Pick<Delivery, 'street' | 'addressNumber' | 'complement' | 'district'>) =>
  [`${d.street}, ${d.addressNumber}`, d.complement, d.district].filter(Boolean).join(' - ');

/** Entrega que ainda precisa de atenção no painel (a separar, na rua ou não entregue). */
export const isOpenDelivery = (d: Pick<Delivery, 'status'>) =>
  d.status === 'PENDING' || d.status === 'OUT' || d.status === 'FAILED';

/** Entrega em aberto que passou do prazo. */
export const isLate = (d: Pick<Delivery, 'status' | 'dueAt'>, now = Date.now()) =>
  (d.status === 'PENDING' || d.status === 'OUT') && new Date(d.dueAt).getTime() < now;

/** O que o entregador cobra na porta: valor, forma e troco. */
export function collectInfo(d: DeliveryDetail) {
  if (!d.collectOnDelivery) return null;
  const methods = d.sale.payments.filter((p) => p.method !== 'ACCOUNT');
  if (methods.length === 0) return null;
  const cash = methods.find((p) => p.method === 'CASH');
  return {
    amountCents:
      d.sale.totalCents - d.sale.payments.filter((p) => p.method === 'ACCOUNT').reduce((s, p) => s + p.amountCents, 0),
    methods: methods.map((p) => PAYMENT_LABEL[p.method]).join(' + '),
    /** Cliente paga com uma nota maior: o entregador leva o troco. */
    changeCents: d.sale.changeCents,
    paysWithCents: cash && d.sale.changeCents > 0 ? cash.amountCents : null,
  };
}

/** Mensagem de "saiu para entrega" para o WhatsApp do cliente. */
export function outForDeliveryMessage(d: DeliveryDetail, storeName: string) {
  const first = firstName(d.customer.name);
  const collect = collectInfo(d);
  const lines = [
    `Olá, ${first}! Seu pedido da ${storeName} saiu para entrega${d.courier ? ` com ${d.courier.name}` : ''}.`,
    `Endereço: ${addressLine(d)}.`,
  ];
  if (collect) {
    lines.push(
      `Valor a pagar na entrega: ${formatMoney(collect.amountCents)} (${collect.methods})` +
        (collect.paysWithCents ? `, troco para ${formatMoney(collect.paysWithCents)}.` : '.'),
    );
  }
  lines.push('Obrigado pela preferência!');
  return lines.join('\n');
}

/** "2 h", "1,5 h", "45 min" */
export const formatDeadline = (minutes: number) =>
  minutes < 60 ? `${minutes} min` : `${String(Math.round(minutes / 6) / 10).replace('.', ',')} h`;

/** Hora do prazo: "14:30", ou "07/10 10:30" se não for hoje. */
export function formatDue(iso: string) {
  const date = new Date(iso);
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return date.toDateString() === new Date().toDateString()
    ? time
    : `${date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${time}`;
}
