import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MapPin, Pencil, Plus, TriangleAlert, Warehouse as WarehouseIcon } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useWarehouses } from '../lib/hooks';
import { useToast } from '../lib/toast';
import { formatNumber } from '../lib/format';
import type { Warehouse } from '../lib/types';
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
  Spinner,
} from '../components/ui';

export function WarehousesPage() {
  const { can } = useAuth();
  const warehouses = useWarehouses();
  const [editing, setEditing] = useState<Warehouse | 'new' | null>(null);

  return (
    <>
      <PageHeader
        title="Estoques"
        description="Depósitos, lojas e demais locais onde os produtos ficam guardados."
        actions={
          can('warehouses:write') && (
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Novo estoque
            </Button>
          )
        }
      />

      {warehouses.isPending ? (
        <Spinner />
      ) : warehouses.isError ? (
        <ErrorMessage error={warehouses.error} />
      ) : warehouses.data.length === 0 ? (
        <Card>
          <EmptyState icon={<WarehouseIcon />} title="Nenhum estoque cadastrado" />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {warehouses.data.map((warehouse) => (
            <Card key={warehouse.id} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="rounded-lg bg-brand-50 p-2 text-brand-700">
                    <WarehouseIcon className="size-5" />
                  </span>
                  <div>
                    <p className="font-semibold text-slate-900">{warehouse.name}</p>
                    <p className="font-mono text-xs text-slate-500">{warehouse.code}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {!warehouse.active && <Badge>Inativo</Badge>}
                  {can('warehouses:write') && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(warehouse)}
                      aria-label={`Editar ${warehouse.name}`}
                    >
                      <Pencil className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
              {warehouse.address && (
                <p className="mt-3 flex items-center gap-1.5 text-sm text-slate-500">
                  <MapPin className="size-3.5" /> {warehouse.address}
                </p>
              )}
              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
                <div>
                  <dt className="text-xs text-slate-500">Unidades</dt>
                  <dd className="text-lg font-semibold tabular-nums">{formatNumber(warehouse.totalUnits ?? 0)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Produtos com saldo</dt>
                  <dd className="text-lg font-semibold tabular-nums">{warehouse.productsInStock ?? 0}</dd>
                </div>
              </dl>
              {warehouse.openAlerts ? (
                <Link
                  to="/alerts"
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-amber-700 hover:underline"
                >
                  <TriangleAlert className="size-4" /> {warehouse.openAlerts} alerta(s) aberto(s)
                </Link>
              ) : (
                <p className="mt-4 text-sm text-emerald-700">Sem alertas</p>
              )}
            </Card>
          ))}
        </div>
      )}

      {editing && <WarehouseModal warehouse={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function WarehouseModal({ warehouse, onClose }: { warehouse: Warehouse | null; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    code: warehouse?.code ?? '',
    name: warehouse?.name ?? '',
    address: warehouse?.address ?? '',
    active: warehouse?.active ?? true,
  });

  const save = useMutation({
    mutationFn: () => (warehouse ? api.patch(`/warehouses/${warehouse.id}`, form) : api.post('/warehouses', form)),
    onSuccess: () => {
      toast.success(warehouse ? 'Estoque atualizado' : 'Estoque cadastrado');
      queryClient.invalidateQueries({ queryKey: ['warehouses'] });
      onClose();
    },
  });
  const errors = save.error instanceof ApiError ? save.error.fieldErrors : {};

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={warehouse ? 'Editar estoque' : 'Novo estoque'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="warehouse-form" loading={save.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="warehouse-form" onSubmit={onSubmit} className="space-y-4">
        {save.error && !Object.keys(errors).length ? <ErrorMessage error={save.error} /> : null}
        <div className="grid grid-cols-3 gap-4">
          <Field label="Código" required error={errors.code?.[0]}>
            {(id) => (
              <Input
                id={id}
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                required
              />
            )}
          </Field>
          <Field label="Nome" required error={errors.name?.[0]} className="col-span-2">
            {(id) => (
              <Input id={id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            )}
          </Field>
        </div>
        <Field label="Endereço">
          {(id) => (
            <Input id={id} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          )}
        </Field>
        {warehouse && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
              className="size-4 accent-brand-700"
            />
            Estoque ativo (inativos não recebem movimentações)
          </label>
        )}
      </form>
    </Modal>
  );
}
