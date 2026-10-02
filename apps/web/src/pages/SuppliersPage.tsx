import { useState, type FormEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Truck } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useDebounced } from '../lib/hooks';
import { useToast } from '../lib/toast';
import type { Paginated, Supplier } from '../lib/types';
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
  Spinner,
  Table,
  Td,
  Textarea,
  Th,
} from '../components/ui';

export function SuppliersPage() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const debounced = useDebounced(search);

  const suppliers = useQuery({
    queryKey: ['suppliers', { search: debounced, page }],
    queryFn: () => api.get<Paginated<Supplier>>('/suppliers', { search: debounced, page }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Fornecedores"
        description="Quem abastece seus estoques."
        actions={
          can('suppliers:write') && (
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Novo fornecedor
            </Button>
          )
        }
      />

      <Card>
        <div className="border-b border-slate-100 p-4">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Buscar por nome ou CNPJ"
              className="pl-9"
              aria-label="Buscar fornecedores"
            />
          </div>
        </div>

        {suppliers.isPending ? (
          <Spinner />
        ) : suppliers.isError ? (
          <div className="p-4">
            <ErrorMessage error={suppliers.error} />
          </div>
        ) : suppliers.data.data.length === 0 ? (
          <EmptyState icon={<Truck />} title="Nenhum fornecedor encontrado" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Fornecedor</Th>
                  <Th className="hidden md:table-cell">Contato</Th>
                  <Th className="hidden sm:table-cell text-right">Produtos</Th>
                  <Th>Situação</Th>
                  {can('suppliers:write') && <Th />}
                </tr>
              </thead>
              <tbody>
                {suppliers.data.data.map((supplier) => (
                  <tr key={supplier.id}>
                    <Td>
                      <p className="font-medium text-slate-900">{supplier.name}</p>
                      <p className="text-xs text-slate-500">{supplier.document ?? 'Sem documento'}</p>
                    </Td>
                    <Td className="hidden md:table-cell">
                      <p>{supplier.contactName ?? '—'}</p>
                      <p className="text-xs text-slate-500">
                        {[supplier.email, supplier.phone].filter(Boolean).join(' · ')}
                      </p>
                    </Td>
                    <Td className="hidden sm:table-cell text-right tabular-nums">{supplier._count?.products ?? 0}</Td>
                    <Td>{supplier.active ? <Badge tone="green">Ativo</Badge> : <Badge>Inativo</Badge>}</Td>
                    {can('suppliers:write') && (
                      <Td className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing(supplier)}
                          aria-label={`Editar ${supplier.name}`}
                        >
                          <Pencil className="size-4" />
                        </Button>
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination
              page={suppliers.data.page}
              totalPages={suppliers.data.totalPages}
              total={suppliers.data.total}
              onChange={setPage}
            />
          </>
        )}
      </Card>

      {editing && <SupplierModal supplier={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function SupplierModal({ supplier, onClose }: { supplier: Supplier | null; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: supplier?.name ?? '',
    document: supplier?.document ?? '',
    contactName: supplier?.contactName ?? '',
    email: supplier?.email ?? '',
    phone: supplier?.phone ?? '',
    notes: supplier?.notes ?? '',
    active: supplier?.active ?? true,
  });
  const set = (field: keyof typeof form) => (value: string | boolean) =>
    setForm((current) => ({ ...current, [field]: value }));

  const save = useMutation({
    mutationFn: () => (supplier ? api.patch(`/suppliers/${supplier.id}`, form) : api.post('/suppliers', form)),
    onSuccess: () => {
      toast.success(supplier ? 'Fornecedor atualizado' : 'Fornecedor cadastrado');
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
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
      title={supplier ? 'Editar fornecedor' : 'Novo fornecedor'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="supplier-form" loading={save.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="supplier-form" onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {save.error && !Object.keys(errors).length ? (
          <div className="sm:col-span-2">
            <ErrorMessage error={save.error} />
          </div>
        ) : null}
        <Field label="Razão social / nome" required error={errors.name?.[0]} className="sm:col-span-2">
          {(id) => <Input id={id} value={form.name} onChange={(e) => set('name')(e.target.value)} required />}
        </Field>
        <Field label="CNPJ / CPF" error={errors.document?.[0]}>
          {(id) => <Input id={id} value={form.document} onChange={(e) => set('document')(e.target.value)} />}
        </Field>
        <Field label="Contato">
          {(id) => <Input id={id} value={form.contactName} onChange={(e) => set('contactName')(e.target.value)} />}
        </Field>
        <Field label="E-mail" error={errors.email?.[0]}>
          {(id) => <Input id={id} type="email" value={form.email} onChange={(e) => set('email')(e.target.value)} />}
        </Field>
        <Field label="Telefone">
          {(id) => <Input id={id} value={form.phone} onChange={(e) => set('phone')(e.target.value)} />}
        </Field>
        <Field label="Observações" className="sm:col-span-2">
          {(id) => <Textarea id={id} value={form.notes} onChange={(e) => set('notes')(e.target.value)} />}
        </Field>
        {supplier && (
          <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => set('active')(e.target.checked)}
              className="size-4 accent-brand-700"
            />
            Fornecedor ativo
          </label>
        )}
      </form>
    </Modal>
  );
}
