import { useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Wallet } from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useToast } from '../../lib/toast';
import { centsToInput, formatMoney, parseMoneyInput } from '../../lib/format';
import type { CashDetail } from '../../lib/types';
import { Button, ErrorMessage, Input } from '../../components/ui';

export const invalidateCash = (queryClient: QueryClient) => queryClient.invalidateQueries({ queryKey: ['cash'] });

/** Abertura do caixa: só o troco inicial. Usado também no PDV quando o caixa está fechado. */
export function OpenCashForm({ warehouseId, compact }: { warehouseId: string; compact?: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  // Sugestão: o que ficou na gaveta no último fechamento (ou o troco fixo da loja).
  const { data: suggestion } = useQuery({
    queryKey: ['cash', 'opening-suggestion', warehouseId],
    queryFn: () =>
      api.get<{ suggestedCents: number; previousKeptCents: number | null }>('/cash/opening-suggestion', {
        warehouseId,
      }),
    enabled: Boolean(warehouseId),
  });
  const [typed, setTyped] = useState<string | null>(null);
  const opening = typed ?? (suggestion?.suggestedCents ? centsToInput(suggestion.suggestedCents) : '');
  // Vazio abre com R$ 0,00; texto que não é valor não pode virar zero sem ninguém perceber.
  const openingCents = parseMoneyInput(opening);
  const invalid = opening.trim() !== '' && openingCents === null;

  const open = useMutation({
    mutationFn: () => api.post<CashDetail>('/cash/open', { warehouseId, openingCents: openingCents ?? 0 }),
    onSuccess: (cash) => {
      queryClient.setQueryData(['cash', 'current', warehouseId], cash);
      invalidateCash(queryClient);
      toast.success(`Caixa nº ${cash.number} aberto`);
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!invalid) open.mutate();
      }}
      className={cn('flex flex-wrap items-end gap-3', !compact && 'p-5')}
    >
      <div className={compact ? 'w-40' : 'w-56'}>
        <label htmlFor="cash-opening" className="mb-1.5 block text-sm font-medium text-slate-700">
          Troco inicial (R$)
        </label>
        <Input
          id="cash-opening"
          value={opening}
          onChange={(e) => setTyped(e.target.value)}
          inputMode="decimal"
          placeholder="0,00"
          autoFocus={!compact}
        />
      </div>
      <Button type="submit" loading={open.isPending} disabled={invalid} icon={<Wallet className="size-4" />}>
        Abrir caixa
      </Button>
      {invalid && <p className="w-full text-xs text-red-600">Valor inválido. Use o formato 250,00.</p>}
      {suggestion?.previousKeptCents !== null && suggestion?.previousKeptCents !== undefined && (
        <p className="w-full text-xs text-slate-500">
          No último fechamento ficaram {formatMoney(suggestion.previousKeptCents)} na gaveta. Confira antes de abrir.
        </p>
      )}
      {open.error && (
        <div className="w-full">
          <ErrorMessage error={open.error} />
        </div>
      )}
    </form>
  );
}
