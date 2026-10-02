import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ClockArrowDown, Download, Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useWarehouses } from '../../lib/hooks';
import { useToast } from '../../lib/toast';
import { MOVEMENT_LABEL, dayEndIso, dayStartIso } from '../../lib/format';
import type { Movement, MovementType, Paginated } from '../../lib/types';
import { MovementsTable } from '../../components/MovementsTable';
import {
  Button,
  Card,
  EmptyState,
  ErrorMessage,
  Input,
  LinkButton,
  PageHeader,
  Pagination,
  Select,
  Spinner,
} from '../../components/ui';

export function MovementsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const { data: warehouses = [] } = useWarehouses();
  const [filters, setFilters] = useState({ type: '', warehouseId: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const query = {
    type: filters.type,
    warehouseId: filters.warehouseId,
    from: filters.from ? dayStartIso(filters.from) : undefined,
    to: filters.to ? dayEndIso(filters.to) : undefined,
  };

  const movements = useQuery({
    queryKey: ['movements', { ...query, page }],
    queryFn: () => api.get<Paginated<Movement>>('/stock/movements', { ...query, page, pageSize: 25 }),
    placeholderData: keepPreviousData,
  });

  const set = (field: keyof typeof filters) => (value: string) => {
    setFilters((current) => ({ ...current, [field]: value }));
    setPage(1);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      await api.download('/stock/movements', 'movimentacoes.csv', { ...query, format: 'csv' });
    } catch (error) {
      toast.error('Falha ao exportar', (error as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Histórico de movimentações"
        description="Registro imutável de tudo que entrou, saiu ou mudou de lugar."
        actions={
          <>
            <Button variant="secondary" icon={<Download className="size-4" />} onClick={exportCsv} loading={exporting}>
              Exportar CSV
            </Button>
            {can('stock:move') && (
              <LinkButton to="/movements/new" icon={<Plus className="size-4" />}>
                Nova movimentação
              </LinkButton>
            )}
          </>
        }
      />

      <Card>
        <div className="grid grid-cols-1 gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Select value={filters.type} onChange={(e) => set('type')(e.target.value)} aria-label="Tipo">
            <option value="">Todos os tipos</option>
            {(Object.keys(MOVEMENT_LABEL) as MovementType[]).map((type) => (
              <option key={type} value={type}>
                {MOVEMENT_LABEL[type]}
              </option>
            ))}
          </Select>
          <Select value={filters.warehouseId} onChange={(e) => set('warehouseId')(e.target.value)} aria-label="Estoque">
            <option value="">Todos os estoques</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
          <Input type="date" value={filters.from} onChange={(e) => set('from')(e.target.value)} aria-label="De" />
          <Input type="date" value={filters.to} onChange={(e) => set('to')(e.target.value)} aria-label="Até" />
        </div>

        {movements.isPending ? (
          <Spinner />
        ) : movements.isError ? (
          <div className="p-4">
            <ErrorMessage error={movements.error} />
          </div>
        ) : movements.data.data.length === 0 ? (
          <EmptyState
            icon={<ClockArrowDown />}
            title="Nenhuma movimentação encontrada"
            description="Ajuste os filtros."
          />
        ) : (
          <>
            <MovementsTable movements={movements.data.data} />
            <Pagination
              page={movements.data.page}
              totalPages={movements.data.totalPages}
              total={movements.data.total}
              onChange={setPage}
            />
          </>
        )}
      </Card>
    </>
  );
}
