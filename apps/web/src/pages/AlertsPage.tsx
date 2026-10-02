import { useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowLeftRight, BellRing, Check, CircleCheck, TriangleAlert } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useWarehouses } from '../lib/hooks';
import { useToast } from '../lib/toast';
import { ALERT_LABEL, formatDateTime, formatRelative } from '../lib/format';
import type { Paginated, StockAlert } from '../lib/types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorMessage,
  LinkButton,
  PageHeader,
  Pagination,
  Select,
  Spinner,
  Table,
  Tabs,
  Td,
  Th,
} from '../components/ui';

export function AlertsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: warehouses = [] } = useWarehouses();
  const [status, setStatus] = useState<'OPEN' | 'RESOLVED'>('OPEN');
  const [warehouseId, setWarehouseId] = useState('');
  const [page, setPage] = useState(1);

  const alerts = useQuery({
    queryKey: ['alerts', 'list', { status, warehouseId, page }],
    queryFn: () => api.get<Paginated<StockAlert>>('/alerts', { status, warehouseId, page }),
    placeholderData: keepPreviousData,
  });

  const acknowledge = useMutation({
    mutationFn: (id: string) => api.post(`/alerts/${id}/acknowledge`),
    onSuccess: () => {
      toast.success('Alerta marcado como ciente');
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
    onError: (error) => toast.error('Não foi possível atualizar', error.message),
  });

  return (
    <>
      <PageHeader
        title="Alertas de estoque"
        description="Gerados automaticamente quando o saldo atinge o mínimo; resolvidos sozinhos quando o estoque é reposto."
      />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
          <Tabs
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={[
              { value: 'OPEN', label: 'Abertos', icon: <BellRing /> },
              { value: 'RESOLVED', label: 'Resolvidos', icon: <CircleCheck /> },
            ]}
          />
          <Select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            className="w-auto"
            aria-label="Estoque"
          >
            <option value="">Todos os estoques</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </div>

        {alerts.isPending ? (
          <Spinner />
        ) : alerts.isError ? (
          <div className="p-4">
            <ErrorMessage error={alerts.error} />
          </div>
        ) : alerts.data.data.length === 0 ? (
          <EmptyState
            icon={<CircleCheck />}
            title={status === 'OPEN' ? 'Nenhum alerta aberto' : 'Nenhum alerta resolvido'}
            description={status === 'OPEN' ? 'Todos os produtos estão acima do estoque mínimo.' : undefined}
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Situação</Th>
                  <Th>Produto</Th>
                  <Th>Estoque</Th>
                  <Th className="text-right">Saldo / mín.</Th>
                  <Th className="hidden md:table-cell">{status === 'OPEN' ? 'Aberto' : 'Resolvido em'}</Th>
                  {status === 'OPEN' && <Th className="text-right">Ações</Th>}
                </tr>
              </thead>
              <tbody>
                {alerts.data.data.map((alert) => (
                  <tr key={alert.id}>
                    <Td>
                      {alert.status === 'RESOLVED' ? (
                        <Badge tone="green" icon={<CircleCheck />}>
                          Resolvido
                        </Badge>
                      ) : (
                        <Badge tone={alert.type === 'LOW_STOCK' ? 'yellow' : 'red'} icon={<TriangleAlert />}>
                          {ALERT_LABEL[alert.type]}
                        </Badge>
                      )}
                    </Td>
                    <Td>
                      <Link to={`/products/${alert.productId}`} className="font-medium text-slate-900 hover:underline">
                        {alert.product?.name}
                      </Link>
                      <p className="text-xs text-slate-500">{alert.product?.sku}</p>
                    </Td>
                    <Td>{alert.warehouse?.name}</Td>
                    <Td className="text-right tabular-nums">
                      <span className="font-medium text-slate-900">{alert.quantity}</span> / {alert.threshold}
                    </Td>
                    <Td className="hidden text-slate-500 md:table-cell">
                      {status === 'OPEN' ? (
                        <>
                          <span title={formatDateTime(alert.createdAt)}>{formatRelative(alert.createdAt)}</span>
                          {alert.acknowledgedBy && (
                            <p className="text-xs text-emerald-700">
                              <Check className="inline size-3" /> Ciente: {alert.acknowledgedBy.name}
                            </p>
                          )}
                        </>
                      ) : (
                        alert.resolvedAt && formatDateTime(alert.resolvedAt)
                      )}
                    </Td>
                    {status === 'OPEN' && (
                      <Td>
                        <div className="flex justify-end gap-2">
                          {can('stock:move') && (
                            <>
                              <LinkButton
                                to={`/movements/new?type=transfer&productId=${alert.productId}`}
                                title="Transferir de outro estoque"
                                aria-label="Transferir de outro estoque"
                                size="sm"
                                variant="ghost"
                                icon={<ArrowLeftRight className="size-4" />}
                              >
                                <span className="hidden xl:inline">Transferir</span>
                              </LinkButton>
                              <LinkButton
                                to={`/movements/new?type=entry&productId=${alert.productId}&warehouseId=${alert.warehouseId}`}
                                size="sm"
                                variant="secondary"
                                icon={<ArrowDownToLine className="size-4" />}
                              >
                                Repor
                              </LinkButton>
                            </>
                          )}
                          {can('alerts:ack') && !alert.acknowledgedAt && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => acknowledge.mutate(alert.id)}
                              loading={acknowledge.isPending && acknowledge.variables === alert.id}
                            >
                              Ciente
                            </Button>
                          )}
                        </div>
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination
              page={alerts.data.page}
              totalPages={alerts.data.totalPages}
              total={alerts.data.total}
              onChange={setPage}
            />
          </>
        )}
      </Card>
    </>
  );
}
