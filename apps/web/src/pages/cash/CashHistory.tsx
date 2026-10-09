import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer, Wallet } from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useStoreSettings } from '../../lib/hooks';
import { formatDateTime, formatMoney } from '../../lib/format';
import type { CashDetail, CashSession, Paginated } from '../../lib/types';
import { useSlipPrinter } from '../../components/Slip';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorMessage,
  Modal,
  Pagination,
  Spinner,
  Table,
  Td,
  Th,
} from '../../components/ui';
import { CashSlip } from './CashSlip';
import { CashSummaryView, DifferenceNotice } from './CashSummary';

/** Caixas anteriores do estoque (a página remonta a lista com key ao trocar de estoque). */
export function CashHistory({ warehouseId, onOpen }: { warehouseId: string; onOpen: (id: string) => void }) {
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useQuery({
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
      ) : error ? (
        <div className="p-4">
          <ErrorMessage error={error} />
        </div>
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

export function CashDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
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
