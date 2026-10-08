import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, HandCoins, MapPin, ReceiptText } from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatMoney } from '../../lib/format';
import { formatDeadline } from '../../lib/delivery';
import type { CustomerAddress, StoreSettings } from '../../lib/types';
import { AddressForm, addressReady, emptyAddress, type AddressDraft } from '../../components/AddressForm';
import { Input } from '../../components/ui';

export interface DeliveryChoice {
  /** Endereço do cadastro, ou "new" para digitar um novo (que fica salvo no cliente). */
  addressId: string;
  address: AddressDraft;
  collectOnDelivery: boolean;
  schedule: boolean;
  /** datetime-local: "2026-10-07T10:30" */
  scheduledFor: string;
  waiveFee: boolean;
  notes: string;
}

export const newDeliveryChoice = (): DeliveryChoice => ({
  addressId: '',
  address: emptyAddress,
  collectOnDelivery: false,
  schedule: false,
  scheduledFor: '',
  waiveFee: false,
  notes: '',
});

export const deliveryReady = (d: DeliveryChoice) =>
  (d.addressId === 'new' ? addressReady(d.address) : d.addressId !== '') && (!d.schedule || d.scheduledFor !== '');

/** Formato que a API espera em "delivery" da venda. */
export const deliveryPayload = (d: DeliveryChoice) => ({
  ...(d.addressId === 'new' ? { address: d.address } : { addressId: d.addressId }),
  collectOnDelivery: d.collectOnDelivery,
  scheduledFor: d.schedule && d.scheduledFor ? new Date(d.scheduledFor).toISOString() : undefined,
  waiveFee: d.waiveFee,
  notes: d.notes,
});

const choiceButton = (active: boolean) =>
  cn(
    'flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium transition-colors',
    active ? 'border-brand-700 bg-brand-50 text-brand-800' : 'border-slate-300 text-slate-700 hover:bg-slate-50',
  );

/** Opções de entrega na tela de venda: endereço, taxa, cobrar na entrega ou já pago, horário. */
export function DeliveryOptions({
  value,
  onChange,
  customerId,
  feeCents,
  settings,
}: {
  value: DeliveryChoice;
  onChange: (value: DeliveryChoice) => void;
  customerId: string | undefined;
  feeCents: number;
  settings: StoreSettings | undefined;
}) {
  const { data: addresses } = useQuery({
    queryKey: ['customers', 'addresses', customerId],
    queryFn: () => api.get<CustomerAddress[]>(`/customers/${customerId}/addresses`),
    enabled: Boolean(customerId),
  });

  // Escolhe sozinho o primeiro endereço do cadastro; sem nenhum, abre o formulário.
  useEffect(() => {
    if (!addresses || value.addressId !== '') return;
    onChange({ ...value, addressId: addresses[0]?.id ?? 'new' });
  }, [addresses, value, onChange]);

  const set = (patch: Partial<DeliveryChoice>) => onChange({ ...value, ...patch });

  if (!customerId) {
    return (
      <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
        Para entregar, escolha ou cadastre o cliente acima (o endereço fica salvo no cadastro dele).
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-600">
          <MapPin className="size-3.5" /> Endereço de entrega
        </p>
        {addresses && addresses.length > 0 && (
          <div className="space-y-1">
            {addresses.map((address) => (
              <label key={address.id} className="flex cursor-pointer items-start gap-2 text-sm text-slate-800">
                <input
                  type="radio"
                  name="delivery-address"
                  checked={value.addressId === address.id}
                  onChange={() => set({ addressId: address.id })}
                  className="mt-1 accent-brand-700"
                />
                <span>
                  {address.label && <strong>{address.label}: </strong>}
                  {address.street}, {address.number}
                  {address.complement && ` - ${address.complement}`} - {address.district}
                </span>
              </label>
            ))}
            <label className="flex cursor-pointer items-center gap-2 text-sm text-brand-700">
              <input
                type="radio"
                name="delivery-address"
                checked={value.addressId === 'new'}
                onChange={() => set({ addressId: 'new' })}
                className="accent-brand-700"
              />
              Outro endereço
            </label>
          </div>
        )}
        {value.addressId === 'new' && (
          <div className="mt-2">
            <AddressForm value={value.address} onChange={(address) => set({ address })} />
            <p className="mt-1 text-xs text-slate-500">Fica salvo no cadastro do cliente para as próximas.</p>
          </div>
        )}
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-slate-600">Pagamento</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            aria-pressed={!value.collectOnDelivery}
            onClick={() => set({ collectOnDelivery: false })}
            className={choiceButton(!value.collectOnDelivery)}
          >
            <ReceiptText className="size-4" /> Já pago
          </button>
          <button
            type="button"
            aria-pressed={value.collectOnDelivery}
            onClick={() => set({ collectOnDelivery: true })}
            className={choiceButton(value.collectOnDelivery)}
          >
            <HandCoins className="size-4" /> Cobrar na entrega
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {value.collectOnDelivery
            ? 'O entregador recebe na porta pela forma escolhida acima. Em dinheiro, informe "troco para quanto".'
            : 'O cliente já pagou (ex.: Pix antes da entrega).'}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-slate-700">
          Taxa de entrega: <strong className="tabular-nums">{feeCents > 0 ? formatMoney(feeCents) : 'grátis'}</strong>
          {feeCents === 0 && !value.waiveFee && settings && settings.deliveryFeeCents > 0 && (
            <span className="text-xs text-slate-500"> (acima de {formatMoney(settings.deliveryFreeAboveCents)})</span>
          )}
        </span>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={value.waiveFee}
            onChange={(e) => set({ waiveFee: e.target.checked })}
            className="accent-brand-700"
          />
          Não cobrar taxa
        </label>
      </div>

      <div>
        <label className="flex items-center gap-1.5 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={value.schedule}
            onChange={(e) => set({ schedule: e.target.checked })}
            className="accent-brand-700"
          />
          <CalendarClock className="size-4 text-slate-500" />
          Agendar para outro horário
        </label>
        {value.schedule ? (
          <Input
            type="datetime-local"
            value={value.scheduledFor}
            onChange={(e) => set({ scheduledFor: e.target.value })}
            className="mt-1.5"
            aria-label="Data e hora da entrega"
          />
        ) : (
          settings && (
            <p className="mt-1 text-xs text-slate-500">
              Prazo: até {formatDeadline(settings.deliveryDeadlineMinutes)} a partir de agora.
            </p>
          )
        )}
      </div>

      <Input
        value={value.notes}
        onChange={(e) => set({ notes: e.target.value })}
        placeholder="Observação para o entregador (opcional)"
        aria-label="Observação da entrega"
      />
    </div>
  );
}
