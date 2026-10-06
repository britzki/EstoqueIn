import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { PAYMENT_LABEL, formatMoney, formatNumber } from '../../lib/format';
import type { PaymentMethod, SaleDetail } from '../../lib/types';
import { Button, DecimalInput, ErrorMessage, Select, Textarea } from '../../components/ui';

const METHODS: PaymentMethod[] = ['CASH', 'PIX', 'DEBIT', 'CREDIT', 'OTHER'];
const toNumber = (text: string) => Number(text.replace(',', '.')) || 0;

/**
 * Devolução de parte da venda: o cliente traz um item de volta (defeito, tamanho errado...).
 * Os itens voltam ao estoque e o valor é estornado; com desconto na venda, o estorno é proporcional.
 */
export function ReturnPanel({ sale, onDone }: { sale: SaleDetail; onDone: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [method, setMethod] = useState<PaymentMethod>(sale.payments[0]?.method ?? 'CASH');
  const [reason, setReason] = useState('');

  const factor = sale.subtotalCents > 0 ? sale.totalCents / sale.subtotalCents : 1;
  const lines = sale.items
    .map((item) => ({ item, quantity: Math.min(toNumber(quantities[item.id] ?? ''), item.returnable ?? 0) }))
    .filter((line) => line.quantity > 0);
  const refund = lines.reduce((sum, line) => sum + Math.round(line.quantity * line.item.unitPriceCents * factor), 0);

  const save = useMutation({
    mutationFn: () =>
      api.post(`/sales/${sale.id}/returns`, {
        items: lines.map((line) => ({ saleItemId: line.item.id, quantity: line.quantity })),
        reason,
        refundMethod: method,
      }),
    onSuccess: () => {
      toast.success('Devolução registrada', `Devolver ${formatMoney(refund)} ao cliente (${PAYMENT_LABEL[method]}).`);
      for (const key of ['sales', 'sale', 'products', 'product', 'alerts', 'dashboard', 'movements', 'cash']) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      onDone();
    },
  });

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <p className="mb-3 text-sm font-medium text-slate-900">Quanto de cada item o cliente está devolvendo?</p>
      {save.error && (
        <div className="mb-3">
          <ErrorMessage error={save.error} />
        </div>
      )}
      <ul className="space-y-2">
        {sale.items.map((item) => {
          const max = item.returnable ?? 0;
          return (
            <li key={item.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="block truncate text-slate-900">{item.description}</span>
                <span className="text-xs text-slate-500">
                  {max > 0 ? `pode devolver até ${formatNumber(max)} ${item.unit}` : 'já devolvido'}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <DecimalInput
                  disabled={max <= 0}
                  value={quantities[item.id] ?? ''}
                  onChange={(value) => setQuantities((current) => ({ ...current, [item.id]: value }))}
                  placeholder="0"
                  className="h-9 w-24 text-right"
                  aria-label={`Quantidade devolvida de ${item.description}`}
                />
                <span className="w-8 text-xs text-slate-500">{item.unit}</span>
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="return-method" className="mb-1.5 block text-sm font-medium text-slate-700">
            Devolver o dinheiro em
          </label>
          <Select id="return-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {METHODS.map((value) => (
              <option key={value} value={value}>
                {PAYMENT_LABEL[value]}
              </option>
            ))}
            {sale.customer && <option value="ACCOUNT">Abater do fiado de {sale.customer.name}</option>}
          </Select>
        </div>
        <div className="flex flex-col justify-end rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span className="text-slate-600">Valor a devolver</span>
          <strong className="text-lg text-slate-900 tabular-nums">{formatMoney(refund)}</strong>
        </div>
      </div>
      {sale.discountCents > 0 && (
        <p className="mt-2 text-xs text-slate-500">A venda teve desconto: o valor devolvido é proporcional.</p>
      )}
      <label htmlFor="return-reason" className="mt-3 mb-1.5 block text-sm font-medium text-slate-700">
        Motivo
      </label>
      <Textarea id="return-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />

      <div className="mt-3 flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Voltar
        </Button>
        <Button
          disabled={lines.length === 0 || reason.trim().length < 3}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          Registrar devolução
        </Button>
      </div>
    </div>
  );
}
