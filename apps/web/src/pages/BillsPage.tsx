import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Repeat, WalletCards } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { cn } from '../lib/cn';
import { useAuth } from '../lib/auth';
import { useSaleWarehouse, useSuppliers } from '../lib/hooks';
import { useToast } from '../lib/toast';
import {
  PAYMENT_LABEL,
  centsToInput,
  dueDay,
  formatDate,
  formatDueDay,
  formatMoney,
  parseMoneyInput,
  toDateInput,
} from '../lib/format';
import type { Bill, Paginated, PaymentMethod } from '../lib/types';
import {
  Badge,
  Button,
  Card,
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
  Tabs,
  Td,
  Textarea,
  Th,
} from '../components/ui';

type Status = 'OPEN' | 'PAID' | 'CANCELLED';
const DAY_MS = 24 * 60 * 60 * 1000;
const PAY_METHODS: Array<Exclude<PaymentMethod, 'ACCOUNT'>> = ['PIX', 'CASH', 'DEBIT', 'CREDIT', 'OTHER'];

/** Data do vencimento sem fuso: o dia que a pessoa escolheu. */
const todayInput = () => toDateInput(new Date());

/** Situação do vencimento em palavras, para a coluna da lista. */
function dueLabel(bill: Bill) {
  const days = Math.round(
    (new Date(`${dueDay(bill.dueDate)}T12:00:00`).getTime() - new Date(`${todayInput()}T12:00:00`).getTime()) / DAY_MS,
  );
  if (days < 0) return { text: `vencida há ${-days} dia(s)`, tone: 'red' as const };
  if (days === 0) return { text: 'vence hoje', tone: 'yellow' as const };
  if (days <= 7) return { text: `vence em ${days} dia(s)`, tone: 'yellow' as const };
  return { text: `vence em ${days} dias`, tone: 'gray' as const };
}

export function BillsPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState<Status>('OPEN');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Bill | 'new' | null>(null);
  const [paying, setPaying] = useState<Bill | null>(null);
  const bills = useQuery({
    queryKey: ['bills', status, page],
    queryFn: () => api.get<Paginated<Bill> & { openTotalCents: number }>('/bills', { status, page }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Contas a pagar"
        description="Boletos de fornecedor, aluguel, luz... Vencidas e próximas aparecem também na tela inicial."
        actions={
          can('bills:manage') && (
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Nova conta
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          options={[
            { value: 'OPEN', label: 'Em aberto' },
            { value: 'PAID', label: 'Pagas' },
            { value: 'CANCELLED', label: 'Canceladas' },
          ]}
        />
        {bills.data && (
          <p className="text-sm text-slate-600">
            Total em aberto: <strong className="text-slate-900">{formatMoney(bills.data.openTotalCents)}</strong>
          </p>
        )}
      </div>
      <Card>
        {bills.isPending ? (
          <Spinner />
        ) : bills.isError ? (
          <div className="p-4">
            <ErrorMessage error={bills.error} />
          </div>
        ) : bills.data.data.length === 0 ? (
          <EmptyState icon={<WalletCards />} title="Nenhuma conta aqui" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Conta</Th>
                  <Th>{status === 'PAID' ? 'Paga em' : 'Vencimento'}</Th>
                  <Th className="text-right">Valor</Th>
                  {status === 'OPEN' && can('bills:manage') && <Th />}
                </tr>
              </thead>
              <tbody>
                {bills.data.data.map((bill) => {
                  const due = dueLabel(bill);
                  return (
                    <tr key={bill.id}>
                      <Td>
                        <span className="flex items-center gap-1.5 font-medium text-slate-900">
                          {bill.description}
                          {bill.monthly && <Repeat className="size-3.5 text-slate-400" aria-label="Mensal" />}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {[bill.supplier?.name, bill.purchaseOrder && `Pedido nº ${bill.purchaseOrder.number}`]
                            .filter(Boolean)
                            .join(' · ') || '—'}
                        </span>
                      </Td>
                      <Td className="whitespace-nowrap">
                        {status === 'PAID' && bill.paidAt ? (
                          <>
                            {formatDate(bill.paidAt)}
                            <span className="block text-xs text-slate-500">
                              {bill.paidMethod && PAYMENT_LABEL[bill.paidMethod]}
                              {bill.paidFromCash && ' · da gaveta'}
                            </span>
                          </>
                        ) : (
                          <>
                            {formatDueDay(bill.dueDate)}
                            {status === 'OPEN' && (
                              <span className="block">
                                <Badge tone={due.tone}>{due.text}</Badge>
                              </span>
                            )}
                          </>
                        )}
                      </Td>
                      <Td className="text-right font-medium tabular-nums">
                        {formatMoney(bill.paidAmountCents ?? bill.amountCents)}
                      </Td>
                      {status === 'OPEN' && can('bills:manage') && (
                        <Td className="text-right whitespace-nowrap">
                          <Button size="sm" variant="ghost" onClick={() => setEditing(bill)}>
                            Editar
                          </Button>
                          <Button size="sm" onClick={() => setPaying(bill)}>
                            Pagar
                          </Button>
                        </Td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination
              page={bills.data.page}
              totalPages={bills.data.totalPages}
              total={bills.data.total}
              onChange={setPage}
            />
          </>
        )}
      </Card>
      {editing && <BillFormModal bill={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {paying && <PayBillModal bill={paying} onClose={() => setPaying(null)} />}
    </>
  );
}

/** Cadastro/edição de conta. Também é aberto pelo pedido de compra, já preenchido. */
export function BillFormModal({
  bill,
  initial,
  onClose,
}: {
  bill: Bill | null;
  initial?: { description: string; supplierId?: string; purchaseOrderId?: string; amountCents: number };
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: suppliers = [] } = useSuppliers();
  const [form, setForm] = useState({
    description: bill?.description ?? initial?.description ?? '',
    supplierId: bill?.supplier?.id ?? initial?.supplierId ?? '',
    amount: bill ? centsToInput(bill.amountCents) : initial ? centsToInput(initial.amountCents) : '',
    dueDate: bill ? dueDay(bill.dueDate) : toDateInput(new Date(Date.now() + 28 * DAY_MS)),
    monthly: bill?.monthly ?? false,
    notes: bill?.notes ?? '',
  });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        description: form.description,
        supplierId: form.supplierId || undefined,
        amountCents: parseMoneyInput(form.amount),
        // Meio-dia evita que o fuso horário mude o dia do vencimento.
        dueDate: `${form.dueDate}T12:00:00`,
        monthly: form.monthly,
        notes: form.notes,
        ...(!bill && initial?.purchaseOrderId && { purchaseOrderId: initial.purchaseOrderId }),
      };
      return bill ? api.patch(`/bills/${bill.id}`, body) : api.post('/bills', body);
    },
    onSuccess: () => {
      toast.success(bill ? 'Conta alterada' : 'Conta lançada');
      queryClient.invalidateQueries({ queryKey: ['bills'] });
      onClose();
    },
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/bills/${bill!.id}/cancel`),
    onSuccess: () => {
      toast.success('Conta cancelada');
      queryClient.invalidateQueries({ queryKey: ['bills'] });
      onClose();
    },
  });
  const errors = save.error instanceof ApiError ? save.error.fieldErrors : {};

  return (
    <Modal
      open
      onClose={onClose}
      title={bill ? 'Editar conta' : 'Nova conta a pagar'}
      footer={
        <>
          {bill && (
            <Button
              variant="ghost"
              className="mr-auto text-red-700"
              loading={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              Cancelar conta
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Voltar
          </Button>
          <Button
            loading={save.isPending}
            disabled={form.description.trim().length < 2 || !parseMoneyInput(form.amount)}
            onClick={() => save.mutate()}
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.error && !Object.keys(errors).length ? <ErrorMessage error={save.error} /> : null}
        <Field label="Descrição" required error={errors.description?.[0]}>
          {(id) => (
            <Input
              id={id}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Ex.: Aluguel, Boleto Distribuidora X"
              autoFocus
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor (R$)" required error={errors.amountCents?.[0]}>
            {(id) => (
              <Input
                id={id}
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                inputMode="decimal"
              />
            )}
          </Field>
          <Field label="Vencimento" required error={errors.dueDate?.[0]}>
            {(id) => (
              <Input
                id={id}
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            )}
          </Field>
        </div>
        <Field label="Fornecedor">
          {(id) => (
            <Select id={id} value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
              <option value="">Nenhum</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.monthly}
            onChange={(e) => setForm({ ...form, monthly: e.target.checked })}
            className="size-4 accent-brand-700"
          />
          Conta mensal (ao pagar, a do mês seguinte é lançada sozinha)
        </label>
        <Field label="Observações">
          {(id) => (
            <Textarea
              id={id}
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          )}
        </Field>
      </div>
    </Modal>
  );
}

function PayBillModal({ bill, onClose }: { bill: Bill; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { warehouseId } = useSaleWarehouse();
  const [method, setMethod] = useState<Exclude<PaymentMethod, 'ACCOUNT'>>('PIX');
  const [amount, setAmount] = useState(centsToInput(bill.amountCents));
  const [paidAt, setPaidAt] = useState(todayInput());
  const [fromCash, setFromCash] = useState(false);

  const pay = useMutation({
    mutationFn: () =>
      api.post<Bill & { next: Bill | null }>(`/bills/${bill.id}/pay`, {
        method,
        amountCents: parseMoneyInput(amount),
        paidAt: `${paidAt}T12:00:00`,
        fromCash: method === 'CASH' && fromCash,
        warehouseId: warehouseId || undefined,
      }),
    onSuccess: (paid) => {
      toast.success(
        'Conta paga',
        paid.next ? `A próxima foi lançada para ${formatDueDay(paid.next.dueDate)}.` : undefined,
      );
      for (const key of ['bills', 'cash']) queryClient.invalidateQueries({ queryKey: [key] });
      onClose();
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Pagar: ${bill.description}`}
      description={`Valor da conta: ${formatMoney(bill.amountCents)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={pay.isPending} disabled={!parseMoneyInput(amount)} onClick={() => pay.mutate()}>
            Confirmar pagamento
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {pay.error && <ErrorMessage error={pay.error} />}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor pago (R$)" hint="Altere se houve juros ou desconto.">
            {(id) => <Input id={id} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />}
          </Field>
          <Field label="Data do pagamento">
            {(id) => <Input id={id} type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />}
          </Field>
        </div>
        <Field label="Forma de pagamento">
          {(id) => (
            <Select id={id} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
              {PAY_METHODS.map((value) => (
                <option key={value} value={value}>
                  {PAYMENT_LABEL[value]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {method === 'CASH' && (
          <label className={cn('flex items-start gap-2 text-sm text-slate-700')}>
            <input
              type="checkbox"
              checked={fromCash}
              onChange={(e) => setFromCash(e.target.checked)}
              className="mt-0.5 size-4 accent-brand-700"
            />
            <span>
              Paguei com o dinheiro da gaveta do caixa
              <span className="block text-xs text-slate-500">
                Registra uma sangria no caixa aberto, para o fechamento bater.
              </span>
            </span>
          </label>
        )}
      </div>
    </Modal>
  );
}
