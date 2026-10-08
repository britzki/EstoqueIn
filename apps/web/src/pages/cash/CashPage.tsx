import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine, Banknote, Lock, Printer, Receipt, Wallet } from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useCurrentCash, useSaleWarehouse, useStoreSettings } from '../../lib/hooks';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { PAYMENT_LABEL, centsToInput, formatDateTime, formatMoney, parseMoneyInput } from '../../lib/format';
import type { CashDetail, CashSession, Paginated, PaymentMethod } from '../../lib/types';
import { useSlipPrinter } from '../../components/Receipt';
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
  StatCard,
  Table,
  Td,
  Textarea,
  Th,
} from '../../components/ui';
import { CashSlip } from './CashSlip';

const METHODS: PaymentMethod[] = ['CASH', 'PIX', 'DEBIT', 'CREDIT', 'OTHER', 'ACCOUNT'];
const RECEIVED_METHODS = ['CASH', 'PIX', 'DEBIT', 'CREDIT', 'OTHER'] as const;

const invalidateCash = (queryClient: ReturnType<typeof useQueryClient>) =>
  queryClient.invalidateQueries({ queryKey: ['cash'] });

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
  const [typed, setOpening] = useState<string | null>(null);
  const opening = typed ?? (suggestion?.suggestedCents ? centsToInput(suggestion.suggestedCents) : '');
  const open = useMutation({
    mutationFn: () => api.post<CashDetail>('/cash/open', { warehouseId, openingCents: parseMoneyInput(opening) ?? 0 }),
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
        open.mutate();
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
          onChange={(e) => setOpening(e.target.value)}
          inputMode="decimal"
          placeholder="0,00"
          autoFocus={!compact}
        />
      </div>
      <Button type="submit" loading={open.isPending} icon={<Wallet className="size-4" />}>
        Abrir caixa
      </Button>
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

export function CashPage() {
  const { can } = useAuth();
  const { warehouses, warehouseId, setWarehouseId } = useSaleWarehouse();
  const current = useCurrentCash(warehouseId);
  const [viewing, setViewing] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Caixa"
        description="Abertura com o troco, sangrias e suprimentos, e o fechamento com a conferência do dinheiro."
        actions={
          warehouses.length > 1 && (
            <Select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="w-auto"
              aria-label="Estoque do caixa"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  Caixa de: {w.name}
                </option>
              ))}
            </Select>
          )
        }
      />

      {current.isLoading ? (
        <Spinner />
      ) : current.error ? (
        <ErrorMessage error={current.error} />
      ) : current.data ? (
        <OpenCash cash={current.data} canOperate={can('sales:create')} />
      ) : (
        <Card className="mb-6">
          <CardHeader
            title="Caixa fechado"
            description="Conte o dinheiro da gaveta e informe o troco para começar o dia."
          />
          {can('sales:create') ? (
            <OpenCashForm warehouseId={warehouseId} />
          ) : (
            <p className="p-5 text-sm text-slate-500">Seu perfil não abre o caixa.</p>
          )}
        </Card>
      )}

      <CashHistory warehouseId={warehouseId} onOpen={setViewing} />
      {viewing && <CashDetailModal id={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

function CashSummaryView({ cash }: { cash: CashDetail }) {
  const { summary } = cash;
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Vendas"
          value={summary.salesCount}
          hint={`${summary.cancelledCount} cancelada(s)`}
          icon={<Receipt />}
        />
        {summary.revenueCents !== null && (
          <StatCard
            label="Faturamento"
            value={formatMoney(summary.revenueCents)}
            hint={summary.returnsCount ? `já sem ${summary.returnsCount} devolução(ões)` : undefined}
            icon={<Banknote />}
          />
        )}
        <StatCard label="Troco inicial" value={formatMoney(cash.openingCents)} icon={<Wallet />} tone="slate" />
        <StatCard
          label="Dinheiro esperado na gaveta"
          value={formatMoney(summary.expectedCashCents)}
          hint="troco + dinheiro (vendas e fiado recebido) − sangrias + suprimentos"
          icon={<Banknote />}
          tone="amber"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Recebido por forma de pagamento" />
          <Table>
            <tbody>
              {METHODS.filter(
                (method) =>
                  summary.byMethod[method] !== undefined &&
                  (!['OTHER', 'ACCOUNT'].includes(method) || summary.byMethod[method]),
              ).map((method) => (
                <tr key={method}>
                  <Td>{method === 'ACCOUNT' ? 'Vendido no fiado (a receber)' : PAYMENT_LABEL[method]}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(summary.byMethod[method] ?? 0)}</Td>
                </tr>
              ))}
              {RECEIVED_METHODS.filter((method) => summary.accountReceivedByMethod[method] > 0).map((method) => (
                <tr key={`fiado-${method}`}>
                  <Td>Fiado recebido ({PAYMENT_LABEL[method]})</Td>
                  <Td className="text-right tabular-nums">{formatMoney(summary.accountReceivedByMethod[method])}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Sangrias e suprimentos" />
          {cash.movements.length === 0 ? (
            <p className="px-5 py-4 text-sm text-slate-500">Nenhuma retirada ou reforço de troco.</p>
          ) : (
            <Table>
              <tbody>
                {cash.movements.map((movement) => (
                  <tr key={movement.id}>
                    <Td className="whitespace-nowrap">{formatDateTime(movement.createdAt)}</Td>
                    <Td>
                      {movement.reason}
                      <span className="block text-xs text-slate-500">{movement.user.name}</span>
                    </Td>
                    <Td
                      className={cn(
                        'text-right whitespace-nowrap tabular-nums',
                        movement.type === 'WITHDRAWAL' ? 'text-red-700' : 'text-emerald-700',
                      )}
                    >
                      {movement.type === 'WITHDRAWAL' ? '−' : '+'} {formatMoney(movement.amountCents)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}

function OpenCash({ cash, canOperate }: { cash: CashDetail; canOperate: boolean }) {
  const [movement, setMovement] = useState<'WITHDRAWAL' | 'DEPOSIT' | null>(null);
  const [closing, setClosing] = useState(false);

  return (
    <div className="mb-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-slate-600">
          <Badge tone="green">Aberto</Badge>
          Caixa nº {cash.number} · aberto por {cash.openedBy.name} em {formatDateTime(cash.openedAt)}
        </p>
        {cash.summary.openingDifferenceCents ? (
          <p className="w-full rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800 lg:order-last">
            Abriu com {formatMoney(cash.openingCents)}, mas no último fechamento ficaram{' '}
            {formatMoney(cash.summary.previousKeptCents ?? 0)} na gaveta (diferença de{' '}
            {formatMoney(cash.summary.openingDifferenceCents)}).
          </p>
        ) : null}
        {canOperate && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              icon={<ArrowUpFromLine className="size-4" />}
              onClick={() => setMovement('WITHDRAWAL')}
            >
              Sangria
            </Button>
            <Button
              variant="secondary"
              icon={<ArrowDownToLine className="size-4" />}
              onClick={() => setMovement('DEPOSIT')}
            >
              Suprimento
            </Button>
            <Button icon={<Lock className="size-4" />} onClick={() => setClosing(true)}>
              Fechar caixa
            </Button>
          </div>
        )}
      </div>
      <CashSummaryView cash={cash} />
      {movement && <MovementModal cash={cash} type={movement} onClose={() => setMovement(null)} />}
      {closing && <CloseModal cash={cash} onClose={() => setClosing(false)} />}
    </div>
  );
}

function MovementModal({
  cash,
  type,
  onClose,
}: {
  cash: CashDetail;
  type: 'WITHDRAWAL' | 'DEPOSIT';
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const withdrawal = type === 'WITHDRAWAL';
  const save = useMutation({
    mutationFn: () =>
      api.post<CashDetail>(`/cash/${cash.id}/movements`, {
        type,
        amountCents: parseMoneyInput(amount) ?? 0,
        reason,
      }),
    onSuccess: () => {
      invalidateCash(queryClient);
      toast.success(withdrawal ? 'Sangria registrada' : 'Suprimento registrado');
      onClose();
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={withdrawal ? 'Sangria (retirada de dinheiro)' : 'Suprimento (reforço de troco)'}
      description={
        withdrawal
          ? 'Dinheiro tirado da gaveta: depósito no banco, pagamento de fornecedor, motoboy...'
          : 'Dinheiro colocado na gaveta durante o dia.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} disabled={!parseMoneyInput(amount)} onClick={() => save.mutate()}>
            Registrar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.error && <ErrorMessage error={save.error} />}
        <Field label="Valor (R$)" required>
          {(id) => (
            <Input id={id} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoFocus />
          )}
        </Field>
        <Field label="Motivo" required>
          {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={160} />}
        </Field>
      </div>
    </Modal>
  );
}

function CloseModal({ cash, onClose }: { cash: CashDetail; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: settings } = useStoreSettings();
  const slip = useSlipPrinter(settings);
  const [counted, setCounted] = useState('');
  const [kept, setKept] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [closed, setClosed] = useState<CashDetail | null>(null);

  const countedCents = parseMoneyInput(counted);
  const difference = countedCents === null ? null : countedCents - cash.summary.expectedCashCents;
  // Fica na gaveta: o troco fixo da loja (ou tudo o que houver, se faltar dinheiro), a menos que o usuário mude.
  const floatCents = settings?.cashFloatCents ?? 0;
  const keptCents =
    kept !== null
      ? parseMoneyInput(kept)
      : floatCents > 0 && countedCents !== null
        ? Math.min(floatCents, countedCents)
        : null;
  const withdrawal = countedCents !== null && keptCents !== null ? countedCents - keptCents : null;
  const keptTooHigh = withdrawal !== null && withdrawal < 0;

  const close = useMutation({
    mutationFn: () =>
      api.post<CashDetail>(`/cash/${cash.id}/close`, { countedCents, keptCents: keptCents ?? undefined, notes }),
    onSuccess: (result) => {
      setClosed(result);
      // A tela só troca para "caixa fechado" ao concluir; antes disso, dá para imprimir o fechamento.
      toast.success(`Caixa nº ${result.number} fechado`);
    },
  });

  const finish = () => {
    invalidateCash(queryClient);
    onClose();
  };

  if (closed) {
    return (
      <Modal
        open
        onClose={finish}
        title={`Caixa nº ${closed.number} fechado`}
        footer={
          <>
            <Button
              variant="secondary"
              icon={<Printer className="size-4" />}
              disabled={!settings}
              onClick={() => settings && slip.print(<CashSlip cash={closed} settings={settings} />)}
            >
              Imprimir fechamento
            </Button>
            <Button onClick={finish}>Concluir</Button>
          </>
        }
      >
        {slip.portal}
        <div className="space-y-3">
          <DifferenceNotice difference={closed.summary.differenceCents ?? 0} />
          {closed.keptCents !== null && (
            <WithdrawalNotice withdrawal={closed.summary.closingWithdrawalCents ?? 0} kept={closed.keptCents} />
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Fechar caixa nº ${cash.number}`}
      description="Conte o dinheiro da gaveta (sem contar Pix e cartão) e informe o total."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            loading={close.isPending}
            disabled={countedCents === null || keptTooHigh}
            onClick={() => close.mutate()}
          >
            Fechar caixa
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {close.error && <ErrorMessage error={close.error} />}
        <dl className="space-y-1 rounded-lg bg-slate-50 px-4 py-3 text-sm">
          <Row label="Troco inicial" value={cash.openingCents} />
          <Row label="Vendas em dinheiro (já sem troco e devoluções)" value={cash.summary.byMethod.CASH ?? 0} />
          {cash.summary.accountReceivedByMethod.CASH > 0 && (
            <Row label="Fiado recebido em dinheiro" value={cash.summary.accountReceivedByMethod.CASH} />
          )}
          <Row label="Suprimentos" value={cash.summary.depositsCents} />
          <Row label="Sangrias" value={-cash.summary.withdrawalsCents || 0} />
          <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold text-slate-900">
            <dt>Esperado na gaveta</dt>
            <dd className="tabular-nums">{formatMoney(cash.summary.expectedCashCents)}</dd>
          </div>
        </dl>
        <Field label="Dinheiro contado (R$)" required>
          {(id) => (
            <Input id={id} value={counted} onChange={(e) => setCounted(e.target.value)} inputMode="decimal" autoFocus />
          )}
        </Field>
        {difference !== null && <DifferenceNotice difference={difference} />}
        <Field
          label="Fica na gaveta para amanhã (R$)"
          hint={
            floatCents > 0
              ? `Troco fixo da loja: ${formatMoney(floatCents)}. O resto é retirado.`
              : 'Deixe em branco para não registrar a retirada.'
          }
          error={keptTooHigh ? 'Não pode ser maior que o dinheiro contado' : undefined}
        >
          {(id) => (
            <Input
              id={id}
              value={kept ?? (keptCents !== null ? centsToInput(keptCents) : '')}
              onChange={(e) => setKept(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
            />
          )}
        </Field>
        {withdrawal !== null && !keptTooHigh && keptCents !== null && (
          <WithdrawalNotice withdrawal={withdrawal} kept={keptCents} />
        )}
        <Field label="Observação" hint="Ex.: explicação da diferença.">
          {(id) => <Textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}

/** Quanto tirar da gaveta (o lucro do dia em dinheiro) e quanto deixar para o troco de amanhã. */
function WithdrawalNotice({ withdrawal, kept }: { withdrawal: number; kept: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 text-sm">
      <div className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-3">
        <p className="text-brand-800">Retirar da gaveta</p>
        <p className="text-xl font-semibold text-slate-900 tabular-nums">{formatMoney(withdrawal)}</p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-slate-600">Fica na gaveta</p>
        <p className="text-xl font-semibold text-slate-900 tabular-nums">{formatMoney(kept)}</p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-slate-600">
      <dt>{label}</dt>
      <dd className="tabular-nums">{formatMoney(value)}</dd>
    </div>
  );
}

function DifferenceNotice({ difference }: { difference: number }) {
  if (difference === 0) {
    return (
      <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
        Caixa bateu: sem diferença.
      </p>
    );
  }
  return (
    <p
      className={cn(
        'rounded-lg px-4 py-3 text-sm font-medium',
        difference < 0 ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800',
      )}
    >
      {difference < 0 ? 'Falta' : 'Sobra'} de {formatMoney(Math.abs(difference))} em relação ao esperado.
    </p>
  );
}

function CashHistory({ warehouseId, onOpen }: { warehouseId: string; onOpen: (id: string) => void }) {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['cash', 'history', warehouseId, page],
    queryFn: () =>
      api.get<Paginated<CashSession & { differenceCents: number | null }>>('/cash', {
        warehouseId,
        page,
        pageSize: 10,
      }),
    enabled: Boolean(warehouseId),
  });

  return (
    <Card>
      <CardHeader title="Caixas anteriores" />
      {isLoading ? (
        <Spinner />
      ) : !data?.data.length ? (
        <EmptyState icon={<Wallet />} title="Nenhum caixa ainda" />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Nº</Th>
                <Th>Abertura</Th>
                <Th>Fechamento</Th>
                <Th className="text-right">Esperado</Th>
                <Th className="text-right">Contado</Th>
                <Th className="text-right">Diferença</Th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((session) => (
                <tr key={session.id} className="cursor-pointer hover:bg-slate-50" onClick={() => onOpen(session.id)}>
                  <Td className="font-medium text-slate-900">{session.number}</Td>
                  <Td>
                    {formatDateTime(session.openedAt)}
                    <span className="block text-xs text-slate-500">{session.openedBy.name}</span>
                  </Td>
                  <Td>
                    {session.closedAt ? (
                      <>
                        {formatDateTime(session.closedAt)}
                        <span className="block text-xs text-slate-500">{session.closedBy?.name}</span>
                      </>
                    ) : (
                      <Badge tone="green">Aberto</Badge>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {session.expectedCents === null ? '—' : formatMoney(session.expectedCents)}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {session.countedCents === null ? '—' : formatMoney(session.countedCents)}
                  </Td>
                  <Td
                    className={cn(
                      'text-right font-medium tabular-nums',
                      session.differenceCents && session.differenceCents < 0 && 'text-red-700',
                      session.differenceCents && session.differenceCents > 0 && 'text-amber-700',
                    )}
                  >
                    {session.differenceCents === null ? '—' : formatMoney(session.differenceCents)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} totalPages={data.totalPages} total={data.total} onChange={setPage} />
        </>
      )}
    </Card>
  );
}

function CashDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: cash, error } = useQuery({
    queryKey: ['cash', 'detail', id],
    queryFn: () => api.get<CashDetail>(`/cash/${id}`),
  });
  const { data: settings } = useStoreSettings();
  const slip = useSlipPrinter(settings);

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={cash ? `Caixa nº ${cash.number}` : 'Caixa'}
      description={
        cash
          ? `${formatDateTime(cash.openedAt)}${cash.closedAt ? ` até ${formatDateTime(cash.closedAt)}` : ' (aberto)'}`
          : undefined
      }
      footer={
        cash?.status === 'CLOSED' && settings ? (
          <Button
            variant="secondary"
            icon={<Printer className="size-4" />}
            onClick={() => slip.print(<CashSlip cash={cash} settings={settings} />)}
          >
            Imprimir fechamento
          </Button>
        ) : undefined
      }
    >
      {slip.portal}
      {error ? (
        <ErrorMessage error={error} />
      ) : !cash ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          {cash.status === 'CLOSED' && <DifferenceNotice difference={cash.summary.differenceCents ?? 0} />}
          {cash.notes && <p className="text-sm text-slate-600">Observação: {cash.notes}</p>}
          <CashSummaryView cash={cash} />
        </div>
      )}
    </Modal>
  );
}
