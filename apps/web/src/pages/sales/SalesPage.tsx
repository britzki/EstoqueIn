import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Printer, Receipt as ReceiptIcon, Undo2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useStoreSettings } from '../../lib/hooks';
import { useToast } from '../../lib/toast';
import { PAYMENT_LABEL, dayEndIso, dayStartIso, formatDateTime, formatMoney, formatNumber } from '../../lib/format';
import type { Paginated, SaleDetail, SaleListItem } from '../../lib/types';
import { useReceiptPrinter } from '../../components/Receipt';
import { ReturnPanel } from './ReturnPanel';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorMessage,
  Input,
  LinkButton,
  Modal,
  PageHeader,
  Pagination,
  Select,
  Spinner,
  Table,
  Td,
  Textarea,
  Th,
} from '../../components/ui';

export function SalesPage() {
  const { can } = useAuth();
  const [filters, setFilters] = useState({ from: '', to: '', status: '' });
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const query = {
    from: filters.from ? dayStartIso(filters.from) : undefined,
    to: filters.to ? dayEndIso(filters.to) : undefined,
    status: filters.status,
  };
  const sales = useQuery({
    queryKey: ['sales', { ...query, page }],
    queryFn: () => api.get<Paginated<SaleListItem>>('/sales', { ...query, page }),
    placeholderData: keepPreviousData,
  });

  const set = (field: keyof typeof filters) => (value: string) => {
    setFilters((current) => ({ ...current, [field]: value }));
    setPage(1);
  };

  return (
    <>
      <PageHeader
        title="Vendas"
        description="Histórico de vendas registradas no caixa."
        actions={
          can('sales:create') && (
            <LinkButton to="/sales/new" icon={<Plus className="size-4" />}>
              Nova venda
            </LinkButton>
          )
        }
      />

      <Card>
        <div className="grid grid-cols-1 gap-3 border-b border-slate-100 p-4 sm:grid-cols-3">
          <Input type="date" value={filters.from} onChange={(e) => set('from')(e.target.value)} aria-label="De" />
          <Input type="date" value={filters.to} onChange={(e) => set('to')(e.target.value)} aria-label="Até" />
          <Select value={filters.status} onChange={(e) => set('status')(e.target.value)} aria-label="Situação">
            <option value="">Todas</option>
            <option value="COMPLETED">Concluídas</option>
            <option value="CANCELLED">Canceladas</option>
          </Select>
        </div>

        {sales.isPending ? (
          <Spinner />
        ) : sales.isError ? (
          <div className="p-4">
            <ErrorMessage error={sales.error} />
          </div>
        ) : sales.data.data.length === 0 ? (
          <EmptyState icon={<ReceiptIcon />} title="Nenhuma venda encontrada" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Venda</Th>
                  <Th>Data</Th>
                  <Th className="hidden sm:table-cell text-right">Itens</Th>
                  <Th className="text-right">Total</Th>
                  <Th className="hidden md:table-cell">Pagamento</Th>
                  <Th className="hidden lg:table-cell">Atendente</Th>
                  <Th>Situação</Th>
                </tr>
              </thead>
              <tbody>
                {sales.data.data.map((sale) => (
                  <tr key={sale.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpenId(sale.id)}>
                    <Td className="font-medium text-slate-900">nº {sale.number}</Td>
                    <Td className="whitespace-nowrap text-slate-500 tabular-nums">{formatDateTime(sale.createdAt)}</Td>
                    <Td className="hidden sm:table-cell text-right tabular-nums">{sale._count.items}</Td>
                    <Td className="text-right font-medium text-slate-900 tabular-nums">
                      {formatMoney(sale.totalCents)}
                    </Td>
                    <Td className="hidden md:table-cell">
                      {sale.payments.map((payment) => PAYMENT_LABEL[payment.method]).join(' + ')}
                    </Td>
                    <Td className="hidden lg:table-cell text-slate-500">{sale.user.name}</Td>
                    <Td>
                      {sale.status === 'CANCELLED' ? (
                        <Badge tone="red">Cancelada</Badge>
                      ) : sale._count.returns ? (
                        <Badge tone="yellow">Com devolução</Badge>
                      ) : (
                        <Badge tone="green">Concluída</Badge>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination
              page={sales.data.page}
              totalPages={sales.data.totalPages}
              total={sales.data.total}
              onChange={setPage}
            />
          </>
        )}
      </Card>

      {openId && <SaleModal saleId={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function SaleModal({ saleId, onClose }: { saleId: string; onClose: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: settings } = useStoreSettings();
  const receipt = useReceiptPrinter(settings);
  const [mode, setMode] = useState<'cancel' | 'return' | null>(null);
  const cancelling = mode === 'cancel';
  const [reason, setReason] = useState('');
  const sale = useQuery({ queryKey: ['sale', saleId], queryFn: () => api.get<SaleDetail>(`/sales/${saleId}`) });

  const cancel = useMutation({
    mutationFn: () => api.post<SaleDetail>(`/sales/${saleId}/cancel`, { reason }),
    onSuccess: () => {
      toast.success('Venda cancelada', 'Os itens voltaram ao estoque.');
      for (const key of ['sales', 'sale', 'products', 'product', 'alerts', 'dashboard', 'movements']) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      setMode(null);
    },
  });

  const data = sale.data;
  const hasReturns = Boolean(data?.returns.length);
  const canReturn = data?.status === 'COMPLETED' && data.items.some((item) => (item.returnable ?? 0) > 0);

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={data ? `Venda nº ${data.number}` : 'Venda'}
      description={data ? `${formatDateTime(data.createdAt)} · ${data.user.name} · ${data.warehouse.name}` : undefined}
      footer={
        data && (
          <>
            {can('sales:cancel') && data.status === 'COMPLETED' && !hasReturns && !mode && (
              <Button variant="ghost" onClick={() => setMode('cancel')}>
                Cancelar venda
              </Button>
            )}
            {can('sales:cancel') && canReturn && !mode && (
              <Button variant="secondary" icon={<Undo2 className="size-4" />} onClick={() => setMode('return')}>
                Devolver itens
              </Button>
            )}
            <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => receipt.print(data)}>
              Imprimir notinha
            </Button>
          </>
        )
      }
    >
      {receipt.portal}
      {sale.isPending ? (
        <Spinner />
      ) : sale.isError ? (
        <ErrorMessage error={sale.error} />
      ) : (
        data && (
          <div className="space-y-4">
            {data.status === 'CANCELLED' && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                Cancelada em {data.cancelledAt && formatDateTime(data.cancelledAt)}
                {data.cancelledBy && ` por ${data.cancelledBy.name}`}: {data.cancelReason}
              </div>
            )}
            <Table>
              <thead>
                <tr>
                  <Th>Produto</Th>
                  <Th className="text-right">Qtd.</Th>
                  <Th className="text-right">Preço</Th>
                  <Th className="text-right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <Td className="text-slate-900">{item.description}</Td>
                    <Td className="text-right tabular-nums">
                      {formatNumber(item.quantity)} {item.unit}
                    </Td>
                    <Td className="text-right tabular-nums">{formatMoney(item.unitPriceCents)}</Td>
                    <Td className="text-right font-medium tabular-nums">{formatMoney(item.totalCents)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <dl className="ml-auto max-w-xs space-y-1 text-sm">
              {data.discountCents > 0 && (
                <div className="flex justify-between text-slate-600">
                  <dt>Desconto</dt>
                  <dd className="tabular-nums">- {formatMoney(data.discountCents)}</dd>
                </div>
              )}
              <div className="flex justify-between text-base font-semibold text-slate-900">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatMoney(data.totalCents)}</dd>
              </div>
              {data.payments.map((payment, index) => (
                <div key={index} className="flex justify-between text-slate-600">
                  <dt>{PAYMENT_LABEL[payment.method]}</dt>
                  <dd className="tabular-nums">{formatMoney(payment.amountCents)}</dd>
                </div>
              ))}
              {data.changeCents > 0 && (
                <div className="flex justify-between text-slate-600">
                  <dt>Troco</dt>
                  <dd className="tabular-nums">{formatMoney(data.changeCents)}</dd>
                </div>
              )}
            </dl>
            {data.customerName && <p className="text-sm text-slate-600">Cliente: {data.customerName}</p>}

            {hasReturns && (
              <div className="rounded-lg border border-slate-200">
                <p className="border-b border-slate-100 px-4 py-2 text-sm font-medium text-slate-900">Devoluções</p>
                <ul className="divide-y divide-slate-100 text-sm">
                  {data.returns.map((saleReturn) => (
                    <li key={saleReturn.id} className="flex flex-wrap justify-between gap-2 px-4 py-2">
                      <span>
                        <span className="text-slate-900">
                          {saleReturn.items
                            .map((line) => {
                              const item = data.items.find((saleItem) => saleItem.id === line.saleItemId);
                              return `${formatNumber(line.quantity)} ${item?.unit ?? ''} ${item?.description ?? ''}`;
                            })
                            .join(', ')}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {formatDateTime(saleReturn.createdAt)} · {saleReturn.user.name} · {saleReturn.reason}
                        </span>
                      </span>
                      <span className="text-right tabular-nums">
                        − {formatMoney(saleReturn.refundCents)}
                        <span className="block text-xs text-slate-500">{PAYMENT_LABEL[saleReturn.refundMethod]}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {mode === 'return' && <ReturnPanel sale={data} onDone={() => setMode(null)} />}

            {cancelling && (
              <div className="rounded-lg border border-slate-200 p-4">
                {cancel.error && <ErrorMessage error={cancel.error} />}
                <label htmlFor="cancel-reason" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Motivo do cancelamento
                </label>
                <Textarea id="cancel-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                <p className="mt-1 text-xs text-slate-500">
                  Os itens voltam ao estoque. A venda continua no histórico.
                </p>
                <div className="mt-3 flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setMode(null)}>
                    Voltar
                  </Button>
                  <Button
                    variant="danger"
                    disabled={reason.trim().length < 3}
                    loading={cancel.isPending}
                    onClick={() => cancel.mutate()}
                  >
                    Confirmar cancelamento
                  </Button>
                </div>
              </div>
            )}
          </div>
        )
      )}
    </Modal>
  );
}
