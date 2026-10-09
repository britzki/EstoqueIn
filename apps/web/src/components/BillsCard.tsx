import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { WalletCards } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDueDay, formatMoney } from '../lib/format';
import type { BillsSummary } from '../lib/types';

/** Contas vencidas e vencendo nos próximos 7 dias, na tela inicial. Some quando não há nada. */
export function BillsCard() {
  const { can } = useAuth();
  const { data } = useQuery({
    queryKey: ['bills', 'summary'],
    queryFn: () => api.get<BillsSummary>('/bills/summary'),
    enabled: can('bills:manage'),
  });
  if (!data || (data.overdue.count === 0 && data.upcoming.count === 0)) return null;

  const overdue = data.overdue.count > 0;
  return (
    <div
      className={`mb-6 rounded-xl border px-5 py-4 ${overdue ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <WalletCards className={`mt-0.5 size-5 shrink-0 ${overdue ? 'text-red-600' : 'text-amber-700'}`} />
          <div>
            <p className={`font-semibold ${overdue ? 'text-red-900' : 'text-amber-900'}`}>
              {overdue
                ? `${data.overdue.count} conta(s) vencida(s): ${formatMoney(data.overdue.totalCents)}`
                : `${data.upcoming.count} conta(s) vencendo nos próximos 7 dias: ${formatMoney(data.upcoming.totalCents)}`}
            </p>
            {overdue && data.upcoming.count > 0 && (
              <p className="text-sm text-red-800">
                E mais {data.upcoming.count} vencendo nos próximos 7 dias ({formatMoney(data.upcoming.totalCents)}).
              </p>
            )}
            <ul className="mt-1 text-sm text-slate-700">
              {data.bills.slice(0, 4).map((bill) => (
                <li key={bill.id}>
                  {formatDueDay(bill.dueDate)} · {bill.description} · {formatMoney(bill.amountCents)}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <Link
          to="/bills"
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm ring-1 ring-slate-300 hover:bg-slate-50"
        >
          Ver contas
        </Link>
      </div>
    </div>
  );
}
