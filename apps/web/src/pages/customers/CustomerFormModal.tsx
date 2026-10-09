import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { centsToInput, parseMoneyInput } from '../../lib/format';
import type { Customer } from '../../lib/types';
import { Button, ErrorMessage, Field, Input, Modal, Textarea } from '../../components/ui';

/** Cadastro e edição do cliente. Limite e fiado anterior só para gerente ou administrador. */
export function CustomerFormModal({ customer, onClose }: { customer: Customer | null; onClose: () => void }) {
  const { can } = useAuth();
  const canSetLimit = can('sales:cancel');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: customer?.name ?? '',
    phone: customer?.phone ?? '',
    notes: customer?.notes ?? '',
    creditLimit: customer?.creditLimitCents != null ? centsToInput(customer.creditLimitCents) : '',
    openingBalance: customer?.openingBalanceCents ? centsToInput(customer.openingBalanceCents) : '',
  });
  const { creditLimit, openingBalance, ...fields } = form;
  // Valor digitado errado não pode virar "sem limite" nem apagar o fiado do caderno.
  const limitInvalid = creditLimit.trim() !== '' && parseMoneyInput(creditLimit) === null;
  const openingInvalid = openingBalance.trim() !== '' && parseMoneyInput(openingBalance) === null;
  const body = {
    ...fields,
    ...(canSetLimit && {
      creditLimitCents: creditLimit.trim() ? parseMoneyInput(creditLimit) : null,
      openingBalanceCents: parseMoneyInput(openingBalance) ?? 0,
    }),
  };
  const save = useMutation({
    mutationFn: () =>
      customer ? api.patch<Customer>(`/customers/${customer.id}`, body) : api.post<Customer>('/customers', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success(customer ? 'Cliente alterado' : 'Cliente cadastrado');
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.patch(`/customers/${customer!.id}`, { active: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Cliente removido da lista', 'As vendas dele continuam no histórico.');
      onClose();
    },
  });
  const errors = save.error instanceof ApiError ? save.error.fieldErrors : {};

  return (
    <Modal
      open
      onClose={onClose}
      title={customer ? 'Editar cliente' : 'Novo cliente'}
      footer={
        <>
          {customer && (
            <Button
              variant="ghost"
              className="mr-auto text-red-700"
              loading={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Remover
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            loading={save.isPending}
            disabled={form.name.trim().length < 2 || (canSetLimit && (limitInvalid || openingInvalid))}
            onClick={() => save.mutate()}
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.error && !Object.keys(errors).length ? <ErrorMessage error={save.error} /> : null}
        {remove.error ? <ErrorMessage error={remove.error} /> : null}
        <Field label="Nome" required error={errors.name?.[0]}>
          {(id) => (
            <Input id={id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          )}
        </Field>
        <Field label="WhatsApp" hint="Com DDD. Usado para avisar da recompra." error={errors.phone?.[0]}>
          {(id) => (
            <Input
              id={id}
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              inputMode="tel"
            />
          )}
        </Field>
        {canSetLimit && (
          <Field
            label="Limite de fiado (R$)"
            hint="Deixe em branco para não ter limite. A venda que passar do limite é recusada no caixa."
            error={limitInvalid ? 'Valor inválido' : errors.creditLimitCents?.[0]}
          >
            {(id) => (
              <Input
                id={id}
                value={form.creditLimit}
                onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
                inputMode="decimal"
                placeholder="Sem limite"
              />
            )}
          </Field>
        )}
        {canSetLimit && (
          <Field
            label="Fiado anterior, do caderno (R$)"
            hint="O que o cliente já devia antes de usar o sistema. Entra no saldo do fiado e pode ser pago normalmente."
            error={openingInvalid ? 'Valor inválido' : errors.openingBalanceCents?.[0]}
          >
            {(id) => (
              <Input
                id={id}
                value={form.openingBalance}
                onChange={(e) => setForm({ ...form, openingBalance: e.target.value })}
                inputMode="decimal"
                placeholder="0,00"
              />
            )}
          </Field>
        )}
        <Field label="Observações" hint="Ex.: nome e raça do pet, ração preferida.">
          {(id) => (
            <Textarea
              id={id}
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          )}
        </Field>
      </div>
    </Modal>
  );
}
