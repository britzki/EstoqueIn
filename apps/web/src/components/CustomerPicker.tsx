import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, UserRound, X } from 'lucide-react';
import { api } from '../lib/api';
import { formatPhone } from '../lib/format';
import { useDebounced } from '../lib/hooks';
import type { Customer, Paginated } from '../lib/types';
import { Button, Input } from './ui';

export interface CustomerChoice {
  customer: Customer | null;
  /** Nome digitado sem cadastro (vai só na notinha). */
  name: string;
}

/**
 * Cliente da venda: busca no cadastro por nome ou telefone, ou cadastra na hora (nome + WhatsApp).
 * Com cliente cadastrado, a venda entra no histórico dele e no lembrete de recompra.
 */
export function CustomerPicker({
  value,
  onChange,
}: {
  value: CustomerChoice;
  onChange: (value: CustomerChoice) => void;
}) {
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState('');
  const [creating, setCreating] = useState(false);
  const search = useDebounced(value.name.trim(), 250);

  const { data: matches = [] } = useQuery({
    queryKey: ['customers', 'search', search],
    queryFn: () => api.get<Paginated<Customer>>('/customers', { search, pageSize: 5 }),
    enabled: search.length >= 2 && !value.customer,
    select: (page) => page.data,
  });

  const create = useMutation({
    mutationFn: () => api.post<Customer>('/customers', { name: value.name.trim(), phone }),
    onSuccess: (customer) => {
      onChange({ customer, name: customer.name });
      setCreating(false);
      setPhone('');
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });

  if (value.customer) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2">
        <span className="flex min-w-0 items-center gap-2 text-sm">
          <UserRound className="size-4 shrink-0 text-brand-700" />
          <span className="truncate font-medium text-slate-900">{value.customer.name}</span>
          {value.customer.phone && (
            <span className="text-xs whitespace-nowrap text-slate-500">{formatPhone(value.customer.phone)}</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => onChange({ customer: null, name: '' })}
          className="rounded p-1 text-slate-500 hover:bg-white hover:text-slate-900"
          aria-label="Tirar cliente da venda"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  const typed = value.name.trim();
  return (
    <div className="relative">
      <Input
        id="sale-customer"
        value={value.name}
        onChange={(e) => {
          onChange({ customer: null, name: e.target.value });
          setCreating(false);
        }}
        placeholder="Nome ou telefone"
        autoComplete="off"
      />
      {typed.length >= 2 && !creating && (
        <ul className="absolute inset-x-0 z-20 mt-1 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {matches.map((customer) => (
            <li key={customer.id}>
              <button
                type="button"
                onClick={() => onChange({ customer, name: customer.name })}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-100"
              >
                <span className="truncate font-medium text-slate-900">{customer.name}</span>
                {customer.phone && <span className="text-xs text-slate-500">{formatPhone(customer.phone)}</span>}
              </button>
            </li>
          ))}
          {/* Busca por telefone não vira nome de cliente novo. */}
          {!/^[\d\s()+-]+$/.test(typed) && (
            <li>
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-brand-700 hover:bg-slate-100"
              >
                <UserPlus className="size-4" /> Cadastrar &quot;{typed}&quot;
              </button>
            </li>
          )}
        </ul>
      )}
      {creating && (
        <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs text-slate-600">
            Novo cliente: <strong>{typed}</strong>. Com o WhatsApp, dá para avisar quando for hora de recomprar.
          </p>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="WhatsApp com DDD (opcional)"
            inputMode="tel"
            autoFocus
          />
          {create.error && <p className="text-xs text-red-600">{(create.error as Error).message}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>
              Cancelar
            </Button>
            <Button size="sm" loading={create.isPending} onClick={() => create.mutate()}>
              Cadastrar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
