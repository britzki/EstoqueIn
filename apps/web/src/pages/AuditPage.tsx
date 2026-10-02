import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRight, ScrollText, Search } from 'lucide-react';
import { api } from '../lib/api';
import { useDebounced } from '../lib/hooks';
import { dayEndIso, dayStartIso, formatDateTime, formatMoney, formatNumber, ROLE_LABEL } from '../lib/format';
import type { Paginated, Role } from '../lib/types';
import {
  Badge,
  Card,
  EmptyState,
  ErrorMessage,
  Input,
  PageHeader,
  Pagination,
  Select,
  Spinner,
  type Tone,
} from '../components/ui';

interface AuditEntry {
  id: string;
  userName: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'IMPORT' | 'SECURITY';
  entity: string;
  summary: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  createdAt: string;
}

const ACTION: Record<AuditEntry['action'], { label: string; tone: Tone }> = {
  CREATE: { label: 'Cadastro', tone: 'green' },
  UPDATE: { label: 'Alteração', tone: 'blue' },
  DELETE: { label: 'Exclusão', tone: 'red' },
  IMPORT: { label: 'Importação', tone: 'violet' },
  SECURITY: { label: 'Segurança', tone: 'yellow' },
};

const ENTITY: Record<string, string> = {
  Product: 'Produtos',
  Supplier: 'Fornecedores',
  Warehouse: 'Estoques',
  User: 'Usuários',
  Settings: 'Configurações',
  Sale: 'Vendas',
  NfeImport: 'Notas fiscais',
};

const FIELD: Record<string, string> = {
  sku: 'SKU',
  name: 'Nome',
  barcode: 'Código de barras',
  category: 'Categoria',
  unit: 'Unidade',
  costCents: 'Custo',
  priceCents: 'Preço de venda',
  minStock: 'Estoque mínimo',
  active: 'Ativo',
  fractional: 'Vendido por peso',
  scaleCode: 'Código na balança',
  supplierId: 'Fornecedor',
  sourceProductId: 'Produto de origem (granel)',
  sourceYield: 'Rendimento do pacote',
  description: 'Descrição',
  document: 'CNPJ/CPF',
  email: 'E-mail',
  phone: 'Telefone',
  contactName: 'Contato',
  notes: 'Observações',
  code: 'Código',
  address: 'Endereço',
  role: 'Perfil',
  password: 'Senha',
  storeName: 'Nome da loja',
  receiptFooter: 'Rodapé da notinha',
  receiptWidth: 'Largura da bobina',
  autoPrint: 'Impressão automática',
  scalePrefix: 'Balança: dígito inicial',
  scaleCodeDigits: 'Balança: dígitos do código',
  scaleValueType: 'Balança: conteúdo da etiqueta',
};

function formatValue(field: string, value: unknown) {
  if (value === null || value === undefined || value === '') return '(vazio)';
  if (typeof value === 'boolean') return value ? 'sim' : 'não';
  if (field.endsWith('Cents') && typeof value === 'number') return formatMoney(value);
  if (field === 'role' && typeof value === 'string') return ROLE_LABEL[value as Role] ?? value;
  if (typeof value === 'number') return formatNumber(value);
  return String(value);
}

export function AuditPage() {
  const [filters, setFilters] = useState({ entity: '', action: '', from: '', to: '' });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);

  const query = {
    entity: filters.entity,
    action: filters.action,
    search: debounced,
    from: filters.from ? dayStartIso(filters.from) : undefined,
    to: filters.to ? dayEndIso(filters.to) : undefined,
  };
  const audit = useQuery({
    queryKey: ['audit', { ...query, page }],
    queryFn: () => api.get<Paginated<AuditEntry>>('/audit', { ...query, page, pageSize: 30 }),
    placeholderData: keepPreviousData,
  });

  const set = (field: keyof typeof filters) => (value: string) => {
    setFilters((current) => ({ ...current, [field]: value }));
    setPage(1);
  };

  return (
    <>
      <PageHeader
        title="Registro de alterações"
        description="Quem cadastrou ou alterou o quê, e quando. O registro é só de leitura: não pode ser editado nem apagado pelo sistema."
      />

      <Card>
        <div className="grid grid-cols-1 gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="relative lg:col-span-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Buscar por nome ou usuário"
              className="pl-9"
              aria-label="Buscar"
            />
          </div>
          <Select value={filters.entity} onChange={(e) => set('entity')(e.target.value)} aria-label="Área">
            <option value="">Todas as áreas</option>
            {Object.entries(ENTITY).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Select value={filters.action} onChange={(e) => set('action')(e.target.value)} aria-label="Tipo">
            <option value="">Todos os tipos</option>
            {Object.entries(ACTION).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Input type="date" value={filters.from} onChange={(e) => set('from')(e.target.value)} aria-label="De" />
          <Input type="date" value={filters.to} onChange={(e) => set('to')(e.target.value)} aria-label="Até" />
        </div>

        {audit.isPending ? (
          <Spinner />
        ) : audit.isError ? (
          <div className="p-4">
            <ErrorMessage error={audit.error} />
          </div>
        ) : audit.data.data.length === 0 ? (
          <EmptyState
            icon={<ScrollText />}
            title="Nenhum registro encontrado"
            description="As alterações de cadastro aparecem aqui."
          />
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {audit.data.data.map((entry) => (
                <li key={entry.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Badge tone={ACTION[entry.action].tone}>{ACTION[entry.action].label}</Badge>
                    <p className="min-w-0 flex-1 font-medium text-slate-900">{entry.summary}</p>
                    <p className="text-sm whitespace-nowrap text-slate-500">
                      {entry.userName} · {formatDateTime(entry.createdAt)}
                    </p>
                  </div>
                  {entry.changes && (
                    <dl className="mt-2 space-y-1 pl-1 text-sm">
                      {Object.entries(entry.changes).map(([field, change]) => (
                        <div key={field} className="flex flex-wrap items-center gap-x-2 text-slate-600">
                          <dt className="font-medium text-slate-700">{FIELD[field] ?? field}:</dt>
                          <dd className="flex flex-wrap items-center gap-2">
                            <span className="text-slate-500 line-through">{formatValue(field, change.from)}</span>
                            <ArrowRight className="size-3.5 text-slate-400" aria-label="passou para" />
                            <span className="font-medium text-slate-900">{formatValue(field, change.to)}</span>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </li>
              ))}
            </ul>
            <Pagination
              page={audit.data.page}
              totalPages={audit.data.totalPages}
              total={audit.data.total}
              onChange={setPage}
            />
          </>
        )}
      </Card>
    </>
  );
}
