import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Package, Plus, Search, TriangleAlert, Upload } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useCategories, useDebounced } from '../../lib/hooks';
import { formatMoney, formatNumber } from '../../lib/format';
import type { Paginated, Product } from '../../lib/types';
import {
  Badge,
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
  Table,
  Td,
  Th,
} from '../../components/ui';
import { ProductFormModal } from './ProductFormModal';

export function ProductsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [creating, setCreating] = useState(false);
  const debouncedSearch = useDebounced(search);
  const { data: categories = [] } = useCategories();

  const page = Number(params.get('page') ?? 1);
  const category = params.get('category') ?? '';
  const withAlerts = params.get('withAlerts') === 'true';
  const status = params.get('status') ?? 'active';

  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };

  const query = useQuery({
    queryKey: ['products', { page, search: debouncedSearch, category, withAlerts, status }],
    queryFn: () =>
      api.get<Paginated<Product>>('/products', {
        page,
        search: debouncedSearch,
        category,
        withAlerts: withAlerts || undefined,
        active: status === 'all' ? undefined : status === 'active',
      }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Produtos"
        description="Catálogo, saldos consolidados e situação de estoque."
        actions={
          <>
            {can('products:import') && (
              <LinkButton to="/products/import" variant="secondary" icon={<Upload className="size-4" />}>
                Importar CSV
              </LinkButton>
            )}
            {can('products:write') && (
              <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                Novo produto
              </Button>
            )}
          </>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <div className="relative min-w-56 flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                update({ search: e.target.value });
              }}
              placeholder="Buscar por nome, SKU ou código de barras"
              className="pl-9"
              aria-label="Buscar produtos"
            />
          </div>
          <Select
            value={category}
            onChange={(e) => update({ category: e.target.value })}
            className="w-auto"
            aria-label="Categoria"
          >
            <option value="">Todas as categorias</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
          <Select
            value={status}
            onChange={(e) => update({ status: e.target.value })}
            className="w-auto"
            aria-label="Situação do cadastro"
          >
            <option value="active">Ativos</option>
            <option value="inactive">Inativos</option>
            <option value="all">Todos</option>
          </Select>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={withAlerts}
              onChange={(e) => update({ withAlerts: e.target.checked ? 'true' : '' })}
              className="size-4 accent-brand-700"
            />
            Só com alerta
          </label>
        </div>

        {query.isPending ? (
          <Spinner />
        ) : query.isError ? (
          <div className="p-4">
            <ErrorMessage error={query.error} />
          </div>
        ) : query.data.data.length === 0 ? (
          <EmptyState
            icon={<Package />}
            title="Nenhum produto encontrado"
            description="Ajuste os filtros ou cadastre um novo produto."
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Produto</Th>
                  <Th className="hidden md:table-cell">Categoria</Th>
                  <Th className="text-right">Saldo</Th>
                  <Th className="hidden sm:table-cell text-right">Mín.</Th>
                  <Th className="hidden lg:table-cell text-right">Custo médio</Th>
                  <Th className="hidden lg:table-cell text-right">Preço</Th>
                  <Th>Situação</Th>
                </tr>
              </thead>
              <tbody>
                {query.data.data.map((product) => (
                  <tr
                    key={product.id}
                    onClick={() => navigate(`/products/${product.id}`)}
                    className="cursor-pointer hover:bg-slate-50"
                  >
                    <Td>
                      <Link
                        to={`/products/${product.id}`}
                        className="font-medium text-slate-900 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {product.name}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {product.sku}
                        {product.barcode && ` · ${product.barcode}`}
                      </p>
                    </Td>
                    <Td className="hidden md:table-cell">{product.category ?? '—'}</Td>
                    <Td className="text-right font-medium text-slate-900 tabular-nums">
                      {formatNumber(product.totalQuantity ?? 0)}{' '}
                      <span className="text-xs font-normal text-slate-500">{product.unit}</span>
                    </Td>
                    <Td className="hidden sm:table-cell text-right tabular-nums">{product.minStock}</Td>
                    <Td className="hidden lg:table-cell text-right tabular-nums">{formatMoney(product.costCents)}</Td>
                    <Td className="hidden lg:table-cell text-right tabular-nums">{formatMoney(product.priceCents)}</Td>
                    <Td>
                      {!product.active ? (
                        <Badge>Inativo</Badge>
                      ) : product.openAlerts ? (
                        <Badge tone="yellow" icon={<TriangleAlert />}>
                          {product.openAlerts} alerta{product.openAlerts > 1 ? 's' : ''}
                        </Badge>
                      ) : (
                        <Badge tone="green">OK</Badge>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination
              page={query.data.page}
              totalPages={query.data.totalPages}
              total={query.data.total}
              onChange={(next) => update({ page: String(next) })}
            />
          </>
        )}
      </Card>

      {creating && (
        <ProductFormModal
          open
          onClose={() => setCreating(false)}
          onSaved={(product) => navigate(`/products/${product.id}`)}
        />
      )}
    </>
  );
}
