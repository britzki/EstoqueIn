import { useQuery } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, formatDateTime, formatMoney, formatNumber, formatPhone } from '../../lib/format';
import type { Customer, CustomerAddress, RepurchaseReminder } from '../../lib/types';
import { Button, ErrorMessage, Modal, Spinner } from '../../components/ui';
import { AccountSection } from './CustomerAccount';
import { CustomerAddresses } from './CustomerAddresses';
import { CustomerLoyalty } from './CustomerLoyalty';
import { ReminderWhatsApp, whenLabel } from './RepurchaseReminders';

interface CustomerDetail extends Customer {
  addresses: CustomerAddress[];
  sales: Array<{
    id: string;
    number: number;
    createdAt: string;
    totalCents: number;
    items: Array<{ description: string; quantity: number; unit: string }>;
  }>;
  reminders: RepurchaseReminder[];
}

/** Ficha do cliente: fiado, cartão fidelidade, endereços, compras recorrentes e últimas compras. */
export function CustomerModal({
  id,
  onClose,
  onEdit,
}: {
  id: string;
  onClose: () => void;
  onEdit: (customer: Customer) => void;
}) {
  const { can } = useAuth();
  const { data, error } = useQuery({
    queryKey: ['customers', 'detail', id],
    queryFn: () => api.get<CustomerDetail>(`/customers/${id}`),
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={data?.name ?? 'Cliente'}
      description={data?.phone ? formatPhone(data.phone) : undefined}
      footer={
        data &&
        can('sales:create') && (
          <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => onEdit(data)}>
            Editar
          </Button>
        )
      }
    >
      {error ? (
        <ErrorMessage error={error} />
      ) : !data ? (
        <Spinner />
      ) : (
        <div className="space-y-5">
          <AccountSection customer={data} />
          <CustomerLoyalty customerId={data.id} />
          <CustomerAddresses customerId={data.id} addresses={data.addresses} />
          {data.notes && <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-700">{data.notes}</p>}
          {data.reminders.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">Compras recorrentes</h3>
              <ul className="space-y-2">
                {data.reminders.map((reminder) => (
                  <li
                    key={reminder.product.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    <span>
                      <span className="font-medium text-slate-900">{reminder.product.name}</span>
                      <span className="block text-xs text-slate-500">
                        a cada {reminder.averageIntervalDays} dias · próxima {formatDate(reminder.expectedAt)} (
                        {whenLabel(reminder.daysUntil)})
                      </span>
                    </span>
                    <ReminderWhatsApp reminder={reminder} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Últimas compras</h3>
            {data.sales.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhuma compra registrada com este cliente.</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
                {data.sales.map((sale) => (
                  <li key={sale.id} className="flex justify-between gap-3 px-3 py-2">
                    <span className="min-w-0">
                      <span className="text-slate-900">
                        {sale.items
                          .map((item) => `${formatNumber(item.quantity)} ${item.unit} ${item.description}`)
                          .join(', ')}
                      </span>
                      <span className="block text-xs text-slate-500">
                        Venda nº {sale.number} · {formatDateTime(sale.createdAt)}
                      </span>
                    </span>
                    <span className="whitespace-nowrap tabular-nums">{formatMoney(sale.totalCents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
