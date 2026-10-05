import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HandCoins, MessageCircle, NotebookPen } from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useAuth } from '../../lib/auth';
import { useSaleWarehouse, useStoreSettings } from '../../lib/hooks';
import { useToast } from '../../lib/toast';
import { PAYMENT_LABEL, formatDate, formatMoney, formatPhone, parseMoneyInput, whatsappLink } from '../../lib/format';
import type { AccountStatement, Customer, Debtor, PaymentMethod } from '../../lib/types';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ErrorMessage,
  Input,
  Select,
  Spinner,
  Table,
  Td,
  Th,
} from '../../components/ui';

const RECEIVE_METHODS: Array<Exclude<PaymentMethod, 'ACCOUNT'>> = ['CASH', 'PIX', 'DEBIT', 'CREDIT', 'OTHER'];

const firstName = (name: string) => name.split(' ')[0];

/** Mensagem de cobrança educada, com o valor em aberto. */
const chargeMessage = (name: string, balanceCents: number, storeName?: string) =>
  `Olá, ${firstName(name)}! Aqui é da ${storeName ?? 'loja'}. Passando para lembrar do fiado em aberto de ` +
  `${formatMoney(balanceCents)}. Quando puder, é só passar aqui ou mandar um Pix. Obrigado!`;

function ChargeButton({ name, phone, balanceCents }: { name: string; phone: string | null; balanceCents: number }) {
  const { data: settings } = useStoreSettings();
  if (!phone) return <span className="text-xs text-slate-400">sem telefone</span>;
  return (
    <a
      href={whatsappLink(phone, chargeMessage(name, balanceCents, settings?.storeName))}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium whitespace-nowrap text-emerald-800 hover:bg-emerald-100"
    >
      <MessageCircle className="size-3.5" /> Cobrar
    </a>
  );
}

/** Caderneta: quem está devendo, quanto e há quanto tempo. */
export function DebtorsCard({ onOpen }: { onOpen: (id: string) => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['customers', 'debtors'],
    queryFn: () => api.get<{ debtors: Debtor[]; totalCents: number }>('/customers/debtors'),
  });

  return (
    <Card className="mb-6">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <NotebookPen className="size-4 text-brand-700" /> Fiado
          </span>
        }
        description={
          data?.debtors.length
            ? `${data.debtors.length} cliente(s) devendo, total a receber ${formatMoney(data.totalCents)}.`
            : 'Vendas no fiado aparecem aqui até serem pagas.'
        }
      />
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <div className="p-4">
          <ErrorMessage error={error} />
        </div>
      ) : !data?.debtors.length ? (
        <p className="px-5 py-4 text-sm text-slate-500">
          Ninguém devendo. Para vender fiado, escolha o cliente na tela de venda e a forma de pagamento Fiado.
        </p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Cliente</Th>
              <Th className="text-right">Em aberto</Th>
              <Th>Desde</Th>
              <Th className="hidden md:table-cell">Último pagamento</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.debtors.map((debtor) => {
              const overLimit =
                debtor.customer.creditLimitCents !== null && debtor.balanceCents > debtor.customer.creditLimitCents;
              return (
                <tr
                  key={debtor.customer.id}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => onOpen(debtor.customer.id)}
                >
                  <Td>
                    <span className="font-medium text-slate-900">{debtor.customer.name}</span>
                    {debtor.customer.phone && (
                      <span className="block text-xs text-slate-500">{formatPhone(debtor.customer.phone)}</span>
                    )}
                  </Td>
                  <Td
                    className={cn(
                      'text-right font-semibold tabular-nums',
                      overLimit ? 'text-red-700' : 'text-slate-900',
                    )}
                  >
                    {formatMoney(debtor.balanceCents)}
                    {debtor.customer.creditLimitCents !== null && (
                      <span className="block text-xs font-normal text-slate-500">
                        limite {formatMoney(debtor.customer.creditLimitCents)}
                      </span>
                    )}
                  </Td>
                  <Td>
                    {debtor.openSince && (
                      <>
                        <Badge
                          tone={(debtor.daysOpen ?? 0) > 30 ? 'red' : (debtor.daysOpen ?? 0) > 15 ? 'yellow' : 'gray'}
                        >
                          {debtor.daysOpen === 0 ? 'hoje' : `${debtor.daysOpen} dia(s)`}
                        </Badge>
                        <span className="block text-xs text-slate-500">{formatDate(debtor.openSince)}</span>
                      </>
                    )}
                  </Td>
                  <Td className="hidden md:table-cell">
                    {debtor.lastPaymentAt ? (
                      formatDate(debtor.lastPaymentAt)
                    ) : (
                      <span className="text-slate-400">nenhum</span>
                    )}
                  </Td>
                  <Td className="text-right">
                    <ChargeButton
                      name={debtor.customer.name}
                      phone={debtor.customer.phone}
                      balanceCents={debtor.balanceCents}
                    />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

/** Fiado dentro da ficha do cliente: saldo, receber pagamento e extrato. */
export function AccountSection({ customer }: { customer: Customer }) {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { warehouseId } = useSaleWarehouse();
  const [receiving, setReceiving] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<Exclude<PaymentMethod, 'ACCOUNT'>>('CASH');
  const [notes, setNotes] = useState('');

  const { data, error } = useQuery({
    queryKey: ['customers', 'account', customer.id],
    queryFn: () => api.get<AccountStatement>(`/customers/${customer.id}/account`),
  });

  const pay = useMutation({
    mutationFn: () =>
      api.post<{ balanceCents: number }>(`/customers/${customer.id}/payments`, {
        amountCents: parseMoneyInput(amount) ?? 0,
        method,
        notes,
        warehouseId: warehouseId || undefined,
      }),
    onSuccess: (result) => {
      toast.success(
        'Pagamento recebido',
        result.balanceCents > 0 ? `Ainda em aberto: ${formatMoney(result.balanceCents)}` : 'Fiado quitado.',
      );
      setReceiving(false);
      setAmount('');
      setNotes('');
      for (const key of ['customers', 'cash']) queryClient.invalidateQueries({ queryKey: [key] });
    },
  });

  if (error) return <ErrorMessage error={error} />;
  if (!data) return <Spinner />;
  if (data.entries.length === 0 && data.creditLimitCents === null) return null;

  const amountCents = parseMoneyInput(amount);
  return (
    <div className="rounded-lg border border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <p className="text-sm text-slate-600">Fiado em aberto</p>
          <p
            className={cn(
              'text-xl font-semibold tabular-nums',
              data.balanceCents > 0 ? 'text-slate-900' : 'text-emerald-700',
            )}
          >
            {data.balanceCents > 0
              ? formatMoney(data.balanceCents)
              : data.balanceCents < 0
                ? `Crédito de ${formatMoney(-data.balanceCents)}`
                : 'Nada em aberto'}
          </p>
          <p className="text-xs text-slate-500">
            {data.creditLimitCents !== null ? `Limite ${formatMoney(data.creditLimitCents)}` : 'Sem limite definido'}
            {data.openSince && ` · em aberto desde ${formatDate(data.openSince)}`}
          </p>
        </div>
        {data.balanceCents > 0 && (
          <div className="flex flex-wrap gap-2">
            <ChargeButton name={customer.name} phone={customer.phone} balanceCents={data.balanceCents} />
            {can('sales:create') && !receiving && (
              <Button size="sm" icon={<HandCoins className="size-4" />} onClick={() => setReceiving(true)}>
                Receber pagamento
              </Button>
            )}
          </div>
        )}
      </div>

      {receiving && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            pay.mutate();
          }}
          className="space-y-3 border-b border-slate-100 bg-slate-50 px-4 py-3"
        >
          {pay.error && <ErrorMessage error={pay.error} />}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="account-amount" className="mb-1.5 block text-sm font-medium text-slate-700">
                Valor (R$)
              </label>
              <Input
                id="account-amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder={formatMoney(data.balanceCents).replace('R$', '').trim()}
                autoFocus
              />
              <button
                type="button"
                className="mt-1 text-xs text-brand-700 hover:underline"
                onClick={() => setAmount(formatMoney(data.balanceCents).replace('R$', '').trim())}
              >
                Quitar tudo
              </button>
            </div>
            <div>
              <label htmlFor="account-method" className="mb-1.5 block text-sm font-medium text-slate-700">
                Forma
              </label>
              <Select id="account-method" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                {RECEIVE_METHODS.map((value) => (
                  <option key={value} value={value}>
                    {PAYMENT_LABEL[value]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label htmlFor="account-notes" className="mb-1.5 block text-sm font-medium text-slate-700">
                Observação
              </label>
              <Input id="account-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={160} />
            </div>
          </div>
          {method === 'CASH' && (
            <p className="text-xs text-slate-500">Em dinheiro, o valor entra na conferência do caixa aberto.</p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setReceiving(false)}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" loading={pay.isPending} disabled={!amountCents}>
              Confirmar recebimento
            </Button>
          </div>
        </form>
      )}

      {data.entries.length > 0 && (
        <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto text-sm">
          {data.entries.map((entry, index) => (
            <li key={index} className="flex items-center justify-between gap-3 px-4 py-2">
              <span>
                <span className="text-slate-900">{entry.description}</span>
                <span className="block text-xs text-slate-500">{formatDate(entry.date)}</span>
              </span>
              <span className="text-right tabular-nums">
                <span className={entry.amountCents > 0 ? 'text-slate-900' : 'text-emerald-700'}>
                  {entry.amountCents > 0 ? '+' : '−'} {formatMoney(Math.abs(entry.amountCents))}
                </span>
                <span className="block text-xs text-slate-500">saldo {formatMoney(entry.balanceCents)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
