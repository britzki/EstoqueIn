import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { PackageCheck, PackageX } from 'lucide-react';
import { api } from '../lib/api';
import { useWarehouses } from '../lib/hooks';
import { formatDate, formatMoney, formatNumber } from '../lib/format';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorMessage,
  Select,
  Spinner,
  StatCard,
  Table,
  Td,
  Th,
} from '../components/ui';
import { ExportButton } from './ReportsPage';

interface SuggestionRow {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  supplier: { id: string; name: string } | null;
  quantity: number;
  minStock: number;
  consumed: number;
  dailyAverage: number;
  daysLeft: number | null;
  suggested: number;
  costCents: number;
  estimatedCents: number;
}

interface Suggestion {
  rows: SuggestionRow[];
  suppliers: Array<{ supplier: { id: string; name: string } | null; items: number; estimatedCents: number }>;
  summary: { products: number; estimatedCents: number };
}

function WarehouseFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { data: warehouses = [] } = useWarehouses();
  if (warehouses.length < 2) return null;
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className="w-auto" aria-label="Estoque">
      <option value="">Todos os estoques</option>
      {warehouses.map((w) => (
        <option key={w.id} value={w.id}>
          {w.name}
        </option>
      ))}
    </Select>
  );
}

/** O que comprar: pelo ritmo de vendas, o que acaba antes da próxima compra e quanto pedir. */
export function PurchaseSuggestionReport() {
  const [filters, setFilters] = useState({ days: 30, coverDays: 15, warehouseId: '' });
  const report = useQuery({
    queryKey: ['reports', 'purchase-suggestion', filters],
    queryFn: () => api.get<Suggestion>('/reports/purchase-suggestion', filters),
  });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-slate-600">
        <span>Consumo médio dos últimos</span>
        <Select
          value={filters.days}
          onChange={(e) => setFilters({ ...filters, days: Number(e.target.value) })}
          className="w-auto"
          aria-label="Período de consumo"
        >
          {[15, 30, 60, 90].map((days) => (
            <option key={days} value={days}>
              {days} dias
            </option>
          ))}
        </Select>
        <span>comprando para</span>
        <Select
          value={filters.coverDays}
          onChange={(e) => setFilters({ ...filters, coverDays: Number(e.target.value) })}
          className="w-auto"
          aria-label="Dias de estoque"
        >
          {[7, 15, 30, 45, 60].map((days) => (
            <option key={days} value={days}>
              {days} dias
            </option>
          ))}
        </Select>
        <WarehouseFilter
          value={filters.warehouseId}
          onChange={(warehouseId) => setFilters({ ...filters, warehouseId })}
        />
      </div>

      {report.isPending ? (
        <Spinner />
      ) : report.isError ? (
        <ErrorMessage error={report.error} />
      ) : report.data.rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<PackageCheck />}
            title="Nada para comprar agora"
            description="Todos os produtos têm estoque para o período escolhido, acima do mínimo."
          />
        </Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Produtos a comprar" value={report.data.summary.products} />
            <StatCard label="Custo estimado" value={formatMoney(report.data.summary.estimatedCents)} tone="amber" />
          </div>
          <Card className="mb-6">
            <CardHeader title="Por fornecedor" description="Para montar o pedido de cada um." />
            <Table>
              <tbody>
                {report.data.suppliers.map((group) => (
                  <tr key={group.supplier?.id ?? 'none'}>
                    <Td className="font-medium text-slate-900">
                      {group.supplier?.name ?? 'Sem fornecedor no cadastro'}
                    </Td>
                    <Td className="text-right">{group.items} produto(s)</Td>
                    <Td className="text-right tabular-nums">{formatMoney(group.estimatedCents)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
          <Card>
            <CardHeader
              title="Sugestão por produto"
              description="Quantidade para cobrir o período escolhido e ainda ficar no mínimo. Produtos a granel entram pelo pacote de origem."
              actions={
                <ExportButton path="/reports/purchase-suggestion" filename="sugestao-de-compra.csv" query={filters} />
              }
            />
            <Table>
              <thead>
                <tr>
                  <Th>Produto</Th>
                  <Th className="hidden lg:table-cell">Fornecedor</Th>
                  <Th className="text-right">Saldo</Th>
                  <Th className="hidden sm:table-cell text-right">Vende por dia</Th>
                  <Th>Acaba em</Th>
                  <Th className="text-right">Comprar</Th>
                  <Th className="hidden md:table-cell text-right">Custo estimado</Th>
                </tr>
              </thead>
              <tbody>
                {report.data.rows.map((row) => (
                  <tr key={row.productId}>
                    <Td>
                      <Link to={`/products/${row.productId}`} className="font-medium text-slate-900 hover:underline">
                        {row.name}
                      </Link>
                      <p className="text-xs text-slate-500">{row.sku}</p>
                    </Td>
                    <Td className="hidden lg:table-cell">{row.supplier?.name ?? '—'}</Td>
                    <Td className="text-right tabular-nums">
                      {formatNumber(row.quantity)} <span className="text-xs text-slate-500">{row.unit}</span>
                    </Td>
                    <Td className="hidden sm:table-cell text-right tabular-nums">{formatNumber(row.dailyAverage)}</Td>
                    <Td>
                      {row.daysLeft === null ? (
                        <Badge tone="gray">abaixo do mínimo</Badge>
                      ) : (
                        <Badge tone={row.daysLeft <= 3 ? 'red' : row.daysLeft <= 7 ? 'yellow' : 'blue'}>
                          {row.daysLeft === 0 ? 'já acabou' : `${row.daysLeft} dia(s)`}
                        </Badge>
                      )}
                    </Td>
                    <Td className="text-right font-semibold text-slate-900 tabular-nums">
                      {formatNumber(row.suggested)}{' '}
                      <span className="text-xs font-normal text-slate-500">{row.unit}</span>
                    </Td>
                    <Td className="hidden md:table-cell text-right tabular-nums">
                      {row.costCents ? formatMoney(row.estimatedCents) : '—'}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}
    </>
  );
}

interface StaleRow {
  productId: string;
  sku: string;
  name: string;
  category: string | null;
  unit: string;
  quantity: number;
  valueCents: number;
  lastExitAt: string | null;
  daysSinceExit: number | null;
}

/** Dinheiro parado na prateleira: produtos com saldo que não saem há muito tempo. */
export function StaleProductsReport() {
  const [filters, setFilters] = useState({ days: 60, warehouseId: '' });
  const report = useQuery({
    queryKey: ['reports', 'stale-products', filters],
    queryFn: () =>
      api.get<{ rows: StaleRow[]; summary: { products: number; valueCents: number } }>(
        '/reports/stale-products',
        filters,
      ),
  });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-slate-600">
        <span>Sem venda nem saída há</span>
        <Select
          value={filters.days}
          onChange={(e) => setFilters({ ...filters, days: Number(e.target.value) })}
          className="w-auto"
          aria-label="Dias sem saída"
        >
          {[30, 60, 90, 180, 365].map((days) => (
            <option key={days} value={days}>
              {days} dias
            </option>
          ))}
        </Select>
        <WarehouseFilter
          value={filters.warehouseId}
          onChange={(warehouseId) => setFilters({ ...filters, warehouseId })}
        />
      </div>

      {report.isPending ? (
        <Spinner />
      ) : report.isError ? (
        <ErrorMessage error={report.error} />
      ) : report.data.rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<PackageCheck />}
            title="Nenhum produto parado"
            description="Tudo o que tem estoque saiu no período."
          />
        </Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Produtos parados" value={report.data.summary.products} icon={<PackageX />} tone="amber" />
            <StatCard
              label="Dinheiro parado (custo)"
              value={formatMoney(report.data.summary.valueCents)}
              hint="Candidatos a promoção ou a não recomprar."
              tone="red"
            />
          </div>
          <Card>
            <CardHeader
              title="Produtos sem saída"
              actions={<ExportButton path="/reports/stale-products" filename="produtos-parados.csv" query={filters} />}
            />
            <Table>
              <thead>
                <tr>
                  <Th>Produto</Th>
                  <Th className="hidden md:table-cell">Categoria</Th>
                  <Th className="text-right">Saldo</Th>
                  <Th className="text-right">Valor parado</Th>
                  <Th>Última saída</Th>
                </tr>
              </thead>
              <tbody>
                {report.data.rows.map((row) => (
                  <tr key={row.productId}>
                    <Td>
                      <Link to={`/products/${row.productId}`} className="font-medium text-slate-900 hover:underline">
                        {row.name}
                      </Link>
                      <p className="text-xs text-slate-500">{row.sku}</p>
                    </Td>
                    <Td className="hidden md:table-cell">{row.category ?? '—'}</Td>
                    <Td className="text-right tabular-nums">
                      {formatNumber(row.quantity)} <span className="text-xs text-slate-500">{row.unit}</span>
                    </Td>
                    <Td className="text-right font-medium text-slate-900 tabular-nums">
                      {formatMoney(row.valueCents)}
                    </Td>
                    <Td>
                      {row.lastExitAt ? (
                        <>
                          {formatDate(row.lastExitAt)}
                          <span className="block text-xs text-slate-500">há {row.daysSinceExit} dias</span>
                        </>
                      ) : (
                        <Badge tone="gray">nunca saiu</Badge>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}
    </>
  );
}
