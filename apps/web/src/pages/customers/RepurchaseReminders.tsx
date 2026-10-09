import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BellRing } from 'lucide-react';
import { api } from '../../lib/api';
import { useStoreSettings } from '../../lib/hooks';
import { firstName, formatDate, formatPhone } from '../../lib/format';
import type { RepurchaseReminder } from '../../lib/types';
import { WhatsAppChip } from '../../components/WhatsAppChip';
import { Badge, Card, CardHeader, ErrorMessage, Select, Spinner, Table, Td, Th } from '../../components/ui';

/** Mensagem pronta para o WhatsApp, com o nome da loja. */
function reminderMessage(reminder: RepurchaseReminder, storeName?: string) {
  return (
    `Olá, ${firstName(reminder.customer.name)}! Aqui é da ${storeName ?? 'loja'}. ` +
    `Pela sua última compra de ${reminder.product.name}, ele deve estar acabando. ` +
    'Quer que a gente separe para você?'
  );
}

export const whenLabel = (days: number) =>
  days < 0 ? `atrasado ${-days} dia(s)` : days === 0 ? 'hoje' : days === 1 ? 'amanhã' : `em ${days} dias`;

/** Botão "Avisar" do lembrete de recompra. */
export function ReminderWhatsApp({ reminder }: { reminder: RepurchaseReminder }) {
  const { data: settings } = useStoreSettings();
  return (
    <WhatsAppChip
      phone={reminder.customer.phone}
      message={reminderMessage(reminder, settings?.storeName)}
      label="Avisar"
    />
  );
}

/** Hora de recomprar: quem costuma levar um produto e está perto de precisar de novo. */
export function RepurchaseReminders({ onOpen }: { onOpen: (id: string) => void }) {
  const [days, setDays] = useState(7);
  const { data, isLoading, error } = useQuery({
    queryKey: ['customers', 'reminders', days],
    queryFn: () => api.get<RepurchaseReminder[]>('/customers/reminders', { days }),
  });

  return (
    <Card className="mb-6">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <BellRing className="size-4 text-brand-700" /> Hora de recomprar
          </span>
        }
        description="Calculado pelo intervalo médio entre as compras de cada cliente (precisa de pelo menos duas compras do mesmo produto)."
        actions={
          <Select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="h-8 w-auto"
            aria-label="Período"
          >
            <option value={0}>Atrasados e hoje</option>
            <option value={7}>Próximos 7 dias</option>
            <option value={15}>Próximos 15 dias</option>
            <option value={30}>Próximos 30 dias</option>
          </Select>
        }
      />
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <div className="p-4">
          <ErrorMessage error={error} />
        </div>
      ) : !data?.length ? (
        <p className="px-5 py-4 text-sm text-slate-500">
          Ninguém para avisar neste período. Escolha o cliente na hora da venda para o sistema aprender o ritmo de cada
          um.
        </p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Cliente</Th>
              <Th>Produto</Th>
              <Th className="hidden md:table-cell">Costuma comprar</Th>
              <Th className="hidden sm:table-cell">Última compra</Th>
              <Th>Previsão</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.map((reminder) => (
              <tr key={`${reminder.customer.id}:${reminder.product.id}`}>
                <Td>
                  <button
                    type="button"
                    className="font-medium text-slate-900 hover:underline"
                    onClick={() => onOpen(reminder.customer.id)}
                  >
                    {reminder.customer.name}
                  </button>
                  {reminder.customer.phone && (
                    <span className="block text-xs text-slate-500">{formatPhone(reminder.customer.phone)}</span>
                  )}
                </Td>
                <Td>{reminder.product.name}</Td>
                <Td className="hidden md:table-cell">
                  a cada {reminder.averageIntervalDays} dias
                  <span className="block text-xs text-slate-500">{reminder.purchases} compras</span>
                </Td>
                <Td className="hidden sm:table-cell whitespace-nowrap">{formatDate(reminder.lastPurchaseAt)}</Td>
                <Td>
                  <Badge tone={reminder.daysUntil < 0 ? 'red' : reminder.daysUntil <= 2 ? 'yellow' : 'blue'}>
                    {whenLabel(reminder.daysUntil)}
                  </Badge>
                </Td>
                <Td className="text-right">
                  <ReminderWhatsApp reminder={reminder} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
