import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MapPin, Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { CustomerAddress } from '../../lib/types';
import { AddressForm, addressReady, emptyAddress, type AddressDraft } from '../../components/AddressForm';
import { Button, ErrorMessage } from '../../components/ui';

/** Endereços de entrega na ficha do cliente. Também são cadastrados direto na venda para entrega. */
export function CustomerAddresses({ customerId, addresses }: { customerId: string; addresses: CustomerAddress[] }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<AddressDraft | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['customers'] });

  const create = useMutation({
    mutationFn: (address: AddressDraft) => api.post(`/customers/${customerId}/addresses`, address),
    onSuccess: () => {
      setDraft(null);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/customers/${customerId}/addresses/${id}`),
    onSuccess: refresh,
  });

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Endereços de entrega</h3>
        {can('sales:create') && !draft && (
          <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setDraft(emptyAddress)}>
            Adicionar
          </Button>
        )}
      </div>
      {addresses.length === 0 && !draft && (
        <p className="text-sm text-slate-500">Nenhum endereço. Ele também é salvo na primeira venda para entrega.</p>
      )}
      {remove.error && <ErrorMessage error={remove.error} />}
      <ul className="space-y-2">
        {addresses.map((address) => (
          <li
            key={address.id}
            className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <span className="flex items-start gap-2">
              <MapPin className="mt-0.5 size-4 shrink-0 text-brand-700" />
              <span>
                {address.label && <strong>{address.label}: </strong>}
                {address.street}, {address.number}
                {address.complement && ` - ${address.complement}`} - {address.district}
                {address.reference && <span className="block text-xs text-slate-500">Ref.: {address.reference}</span>}
              </span>
            </span>
            {can('sales:create') && (
              <button
                type="button"
                disabled={remove.isPending}
                onClick={() => remove.mutate(address.id)}
                className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                aria-label="Apagar endereço"
              >
                <Trash2 className="size-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {draft && (
        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          {create.error && <ErrorMessage error={create.error} />}
          <AddressForm value={draft} onChange={setDraft} withLabel />
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={!addressReady(draft)}
              loading={create.isPending}
              onClick={() => create.mutate(draft)}
            >
              Salvar endereço
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
