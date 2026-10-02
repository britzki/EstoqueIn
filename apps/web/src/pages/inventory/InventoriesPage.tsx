import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useActiveWarehouses, useCategories } from '../../lib/hooks';
import { formatDateTime } from '../../lib/format';
import type { InventorySummary } from '../../lib/types';
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
  Select,
  Spinner,
  Table,
  Td,
  Th,
} from '../../components/ui';

export const INVENTORY_STATUS = {
  OPEN: { label: 'Em contagem', tone: 'blue' },
  COMPLETED: { label: 'Concluído', tone: 'green' },
  CANCELLED: { label: 'Cancelado', tone: 'gray' },
} as const;

export function InventoriesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const inventories = useQuery({
    queryKey: ['inventories'],
    queryFn: () => api.get<InventorySummary[]>('/inventories'),
  });

  return (
    <>
      <PageHeader
        title="Inventário"
        description="Contagem física do estoque. Ao concluir, as diferenças viram ajustes automáticos."
        actions={
          can('inventory:manage') && (
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Novo inventário
            </Button>
          )
        }
      />

      <Card>
        {inventories.isPending ? (
          <Spinner />
        ) : inventories.isError ? (
          <div className="p-4">
            <ErrorMessage error={inventories.error} />
          </div>
        ) : inventories.data.length === 0 ? (
          <EmptyState icon={<ClipboardList />} title="Nenhum inventário ainda" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Estoque</Th>
                <Th>Situação</Th>
                <Th>Progresso</Th>
                <Th className="hidden md:table-cell">Aberto por</Th>
                <Th className="hidden sm:table-cell">Data</Th>
              </tr>
            </thead>
            <tbody>
              {inventories.data.map((inventory) => {
                const progress = inventory.totalItems ? inventory.countedItems / inventory.totalItems : 0;
                const status = INVENTORY_STATUS[inventory.status];
                return (
                  <tr
                    key={inventory.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => navigate(`/inventories/${inventory.id}`)}
                  >
                    <Td>
                      <Link
                        to={`/inventories/${inventory.id}`}
                        className="font-medium text-slate-900 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {inventory.warehouse.name}
                      </Link>
                      {inventory.notes && <p className="text-xs text-slate-500">{inventory.notes}</p>}
                    </Td>
                    <Td>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </Td>
                    <Td className="min-w-40">
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 rounded-full bg-slate-100">
                          <div className="h-2 rounded-full bg-brand-600" style={{ width: `${progress * 100}%` }} />
                        </div>
                        <span className="text-xs text-slate-500 tabular-nums">
                          {inventory.countedItems}/{inventory.totalItems}
                        </span>
                      </div>
                    </Td>
                    <Td className="hidden md:table-cell">{inventory.createdBy.name}</Td>
                    <Td className="hidden whitespace-nowrap text-slate-500 sm:table-cell">
                      {formatDateTime(inventory.createdAt)}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {creating && <NewInventoryModal onClose={() => setCreating(false)} />}
    </>
  );
}

function NewInventoryModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: warehouses = [] } = useActiveWarehouses();
  const { data: categories = [] } = useCategories();
  const [form, setForm] = useState({ warehouseId: '', category: '', notes: '' });

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>('/inventories', { ...form, warehouseId: form.warehouseId || warehouses[0]?.id }),
    onSuccess: (inventory) => {
      queryClient.invalidateQueries({ queryKey: ['inventories'] });
      navigate(`/inventories/${inventory.id}`);
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Novo inventário"
      description="O sistema registra o saldo atual de cada produto como referência para a contagem."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="inventory-form" loading={create.isPending}>
            Abrir inventário
          </Button>
        </>
      }
    >
      <form id="inventory-form" onSubmit={onSubmit} className="space-y-4">
        {create.error && <ErrorMessage error={create.error} />}
        <Field label="Estoque" required>
          {(id) => (
            <Select
              id={id}
              value={form.warehouseId}
              onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Categoria" hint="Opcional: inventário parcial (contagem cíclica) de uma categoria.">
          {(id) => (
            <Select id={id} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="">Todas as categorias</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Observação">
          {(id) => <Input id={id} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />}
        </Field>
      </form>
    </Modal>
  );
}
