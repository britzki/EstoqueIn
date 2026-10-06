import { useQuery } from '@tanstack/react-query';
import { Gift } from 'lucide-react';
import { api } from '../../lib/api';
import { formatNumber } from '../../lib/format';
import type { LoyaltyProgress } from '../../lib/types';

/** Cartões fidelidade do cliente, com uma barra de progresso até o próximo brinde. */
export function CustomerLoyalty({ customerId }: { customerId: string }) {
  const { data = [] } = useQuery({
    queryKey: ['customers', 'loyalty', customerId],
    queryFn: () => api.get<LoyaltyProgress[]>(`/customers/${customerId}/loyalty`),
  });
  if (data.length === 0) return null;

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-slate-900">Cartão fidelidade</h3>
      <ul className="space-y-2">
        {data.map((card) => (
          <li key={card.rule.id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 font-medium text-slate-900">
                <Gift className="size-4 text-brand-700" /> {card.rule.name}
              </span>
              <span className={card.available > 0 ? 'font-medium text-emerald-700' : 'text-slate-500'}>
                {card.available > 0
                  ? `${card.available} brinde(s) disponível(is): ${card.rule.rewardProduct.name}`
                  : `falta ${formatNumber(card.missing)} para o brinde`}
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
              <div
                className="h-full rounded-full bg-brand-600"
                style={{ width: `${Math.min(100, (card.progress / card.rule.requiredQuantity) * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {formatNumber(card.progress)} de {formatNumber(card.rule.requiredQuantity)} · total comprado{' '}
              {formatNumber(card.purchased)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
