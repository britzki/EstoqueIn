import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, MessageCircle, Pencil, Plus, Search, UsersRound } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { cn } from '../lib/cn';
import { useAuth } from '../lib/auth';
import { useDebounced, useStoreSettings } from '../lib/hooks';
import { useToast } from '../lib/toast';
import { formatDate, formatDateTime, formatMoney, formatNumber, formatPhone, whatsappLink } from '../lib/format';
import type { Customer, Paginated, RepurchaseReminder } from '../lib/types';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorMessage,
  Field,
  Input,
  Modal,
  PageHeader,
  Pagination,
  Select,
  Spinner,
  Table,
  Td,
  Textarea,
  Th,
} from '../components/ui';

interface CustomerDetail extends Customer {
  sales: Array<{
    id: string;
    number: number;
    createdAt: string;
    totalCents: number;
    items: Array<{ description: string; quantity: number; unit: string }>;
  }>;
  reminders: RepurchaseReminder[];
}

const firstName = (name: string) => name.split(' ')[0];

/** Mensagem pronta para o WhatsApp, com o nome da loja. */
function reminderMessage(reminder: RepurchaseReminder, storeName?: string) {
  return (
    `Olá, ${firstName(reminder.customer.name)}! Aqui é da ${storeName ?? 'loja'}. ` +
    `Pela sua última compra de ${reminder.product.name}, ele deve estar acabando. ` +
    'Quer que a gente separe para você?'
  );
}

const whenLabel = (days: number) =>
  days < 0 ? `atrasado ${-days} dia(s)` : days === 0 ? 'hoje' : days === 1 ? 'amanhã' : `em ${days} dias`;

export function CustomersPage() {
  const { can } = useAuth();
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Cadastro de clientes e aviso de recompra: quem costuma voltar e está perto de precisar de novo."
        actions={
          can('sales:create') && (
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Novo cliente
            </Button>
          )
        }
      />
      <Reminders onOpen={setViewing} />
      <CustomerList onOpen={setViewing} />
      {editing && <CustomerFormModal customer={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {viewing && (
        <CustomerModal
          id={viewing}
          onClose={() => setViewing(null)}
          onEdit={(customer) => {
            setViewing(null);
            setEditing(customer);
          }}
        />
      )}
    </>
  );
}

/** Abre a conversa no WhatsApp (no programa instalado, abre no navegador padrão). */
function WhatsAppButton({ reminder }: { reminder: RepurchaseReminder }) {
  const { data: settings } = useStoreSettings();
  if (!reminder.customer.phone) return <span className="text-xs text-slate-400">sem telefone</span>;
  return (
    <a
      href={whatsappLink(reminder.customer.phone, reminderMessage(reminder, settings?.storeName))}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
    >
      <MessageCircle className="size-3.5" /> Avisar
    </a>
  );
}

function Reminders({ onOpen }: { onOpen: (id: string) => void }) {
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
                  <WhatsAppButton reminder={reminder} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function CustomerList({ onOpen }: { onOpen: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search.trim());
  const { data, isPending, error } = useQuery({
    queryKey: ['customers', 'list', debounced, page],
    queryFn: () => api.get<Paginated<Customer>>('/customers', { search: debounced, page }),
    placeholderData: keepPreviousData,
  });

  return (
    <Card>
      <div className="relative border-b border-slate-100 p-4">
        <Search className="pointer-events-none absolute top-1/2 left-7 size-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Buscar por nome ou telefone"
          className="pl-9"
          aria-label="Buscar cliente"
        />
      </div>
      {isPending ? (
        <Spinner />
      ) : error ? (
        <div className="p-4">
          <ErrorMessage error={error} />
        </div>
      ) : !data.data.length ? (
        <EmptyState
          icon={<UsersRound />}
          title={debounced ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado'}
          description="Clientes também podem ser cadastrados na hora da venda."
        />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Nome</Th>
                <Th>Telefone</Th>
                <Th className="text-right">Compras</Th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((customer) => (
                <tr key={customer.id} className="cursor-pointer hover:bg-slate-50" onClick={() => onOpen(customer.id)}>
                  <Td className="font-medium text-slate-900">{customer.name}</Td>
                  <Td>{customer.phone ? formatPhone(customer.phone) : '—'}</Td>
                  <Td className="text-right tabular-nums">{customer._count?.sales ?? 0}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onChange={setPage} />
        </>
      )}
    </Card>
  );
}

function CustomerModal({
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
                    <WhatsAppButton reminder={reminder} />
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
                    <span className={cn('whitespace-nowrap tabular-nums')}>{formatMoney(sale.totalCents)}</span>
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

function CustomerFormModal({ customer, onClose }: { customer: Customer | null; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: customer?.name ?? '',
    phone: customer?.phone ?? '',
    notes: customer?.notes ?? '',
  });
  const save = useMutation({
    mutationFn: () =>
      customer ? api.patch<Customer>(`/customers/${customer.id}`, form) : api.post<Customer>('/customers', form),
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
          <Button loading={save.isPending} disabled={form.name.trim().length < 2} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.error && !Object.keys(errors).length ? <ErrorMessage error={save.error} /> : null}
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
