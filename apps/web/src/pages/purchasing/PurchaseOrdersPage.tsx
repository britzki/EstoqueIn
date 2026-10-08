import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, formatMoney } from '../../lib/format';
import type { Paginated, PurchaseOrder } from '../../lib/types';
import {
  Badge,
  Card,
  EmptyState,
  ErrorMessage,
  LinkButton,
  PageHeader,
  Pagination,
  Select,
  Spinner,
  Table,
  Td,
  Th,
} from '../../components/ui';
import { ORDER_STATUS, OrderModal } from './PurchaseOrderParts';

export function PurchaseOrdersPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const orders = useQuery({
    queryKey: ['purchase-orders', status, page],
    queryFn: () => api.get<Paginated<PurchaseOrder>>('/purchase-orders', { status, page }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Pedidos de compra"
        description="O que foi pedido a cada fornecedor. Para fazer um pedido novo, use a sugestão de compra."
        actions={
          can('reports:read') && (
            <LinkButton to="/reports?tab=purchase" variant="secondary">
              Sugestão de compra
            </LinkButton>
          )
        }
      />
      <Card>
        <div className="border-b border-slate-100 p-4">
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="w-auto"
            aria-label="Situação"
          >
            <option value="">Todos</option>
            <option value="OPEN">Aguardando entrega</option>
            <option value="RECEIVED">Recebidos</option>
            <option value="CANCELLED">Cancelados</option>
          </Select>
        </div>
        {orders.isPending ? (
          <Spinner />
        ) : orders.isError ? (
          <div className="p-4">
            <ErrorMessage error={orders.error} />
          </div>
        ) : orders.data.data.length === 0 ? (
          <EmptyState
            icon={<ClipboardList />}
            title="Nenhum pedido"
            description="Em Relatórios → Sugestão de compra, use o botão Gerar pedido ao lado de cada fornecedor."
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Pedido</Th>
                  <Th>Fornecedor</Th>
                  <Th className="hidden sm:table-cell">Data</Th>
                  <Th className="hidden md:table-cell text-right">Itens</Th>
                  <Th className="text-right">Estimado</Th>
                  <Th>Situação</Th>
                </tr>
              </thead>
              <tbody>
                {orders.data.data.map((order) => (
                  <tr key={order.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpenId(order.id)}>
                    <Td className="font-medium text-slate-900">nº {order.number}</Td>
                    <Td>{order.supplier?.name ?? '—'}</Td>
                    <Td className="hidden sm:table-cell">{formatDate(order.createdAt)}</Td>
                    <Td className="hidden md:table-cell text-right tabular-nums">{order.items.length}</Td>
                    <Td className="text-right tabular-nums">
                      {order.totalCents === null ? '—' : formatMoney(order.totalCents)}
                    </Td>
                    <Td>
                      <Badge tone={ORDER_STATUS[order.status].tone}>{ORDER_STATUS[order.status].label}</Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination
              page={orders.data.page}
              totalPages={orders.data.totalPages}
              total={orders.data.total}
              onChange={setPage}
            />
          </>
        )}
      </Card>
      {openId && <OrderModal id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}
