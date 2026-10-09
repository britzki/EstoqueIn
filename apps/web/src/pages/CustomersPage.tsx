import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Search, UsersRound } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { useAuth } from '../lib/auth';
import { useDebounced } from '../lib/hooks';
import { formatMoney, formatPhone } from '../lib/format';
import type { Customer, Paginated } from '../lib/types';
import { DebtorsCard } from './customers/CustomerAccount';
import { CustomerFormModal } from './customers/CustomerFormModal';
import { CustomerModal } from './customers/CustomerModal';
import { RepurchaseReminders } from './customers/RepurchaseReminders';
import {
  Button,
  Card,
  EmptyState,
  ErrorMessage,
  Input,
  PageHeader,
  Pagination,
  Spinner,
  Table,
  Td,
  Th,
} from '../components/ui';

export function CustomersPage() {
  const { can } = useAuth();
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Cadastro de clientes, fiado e aviso de recompra."
        actions={
          can('sales:create') && (
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Novo cliente
            </Button>
          )
        }
      />
      <DebtorsCard onOpen={setViewing} />
      <RepurchaseReminders onOpen={setViewing} />
      <CustomerList onOpen={setViewing} />
      {editing && <CustomerFormModal customer={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {viewing && (
        <CustomerModal
          id={viewing}
          onClose={() => setViewing(null)}
          onEdit={(customer) => {
            setViewing(null);
            setEditing(customer);
          }}
        />
      )}
    </>
  );
}

function CustomerList({ onOpen }: { onOpen: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search.trim());
  const { data, isPending, error } = useQuery({
    queryKey: ['customers', 'list', debounced, page],
    queryFn: () => api.get<Paginated<Customer>>('/customers', { search: debounced, page }),
    placeholderData: keepPreviousData,
  });

  return (
    <Card>
      <div className="relative border-b border-slate-100 p-4">
        <Search className="pointer-events-none absolute top-1/2 left-7 size-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Buscar por nome ou telefone"
          className="pl-9"
          aria-label="Buscar cliente"
        />
      </div>
      {isPending ? (
        <Spinner />
      ) : error ? (
        <div className="p-4">
          <ErrorMessage error={error} />
        </div>
      ) : !data.data.length ? (
        <EmptyState
          icon={<UsersRound />}
          title={debounced ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado'}
          description="Clientes também podem ser cadastrados na hora da venda."
        />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Nome</Th>
                <Th>Telefone</Th>
                <Th className="text-right">Compras</Th>
                <Th className="text-right">Fiado</Th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((customer) => (
                <tr key={customer.id} className="cursor-pointer hover:bg-slate-50" onClick={() => onOpen(customer.id)}>
                  <Td className="font-medium text-slate-900">{customer.name}</Td>
                  <Td>{customer.phone ? formatPhone(customer.phone) : '—'}</Td>
                  <Td className="text-right tabular-nums">{customer._count?.sales ?? 0}</Td>
                  <Td
                    className={cn(
                      'text-right tabular-nums',
                      customer.balanceCents ? 'font-medium text-slate-900' : 'text-slate-400',
                    )}
                  >
                    {customer.balanceCents ? formatMoney(customer.balanceCents) : '—'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onChange={setPage} />
        </>
      )}
    </Card>
  );
}
