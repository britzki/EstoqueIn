import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  Boxes,
  CalendarCheck,
  Download,
  PackagePlus,
  PackageX,
  ShoppingCart,
  TrendingUp,
} from 'lucide-react';
import { SalesReport } from './SalesReport';
import { MonthlyReport } from './MonthlyReport';
import { PurchaseSuggestionReport, StaleProductsReport } from './PurchasingReports';
import { api, type Query } from '../lib/api';
import { useCategories, useWarehouses } from '../lib/hooks';
import { useToast } from '../lib/toast';
import { dayEndIso, dayStartIso, formatMoney, formatNumber, formatPercent, toDateInput } from '../lib/format';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorMessage,
  Input,
  PageHeader,
  Select,
  Spinner,
  StatCard,
  Table,
  Tabs,
  Td,
  Th,
  type Tone,
} from '../components/ui';

type Report = 'monthly' | 'sales' | 'position' | 'purchase' | 'stale' | 'movements' | 'abc';

export function ReportsPage() {
  // ?tab=purchase abre direto a sugestão de compra (link da tela de pedidos).
  const [params] = useSearchParams();
  const [report, setReport] = useState<Report>(() => (params.get('tab') as Report | null) ?? 'sales');

  return (
    <>
      <PageHeader
        title="Relatórios"
        description="Todos os relatórios podem ser exportados em CSV (abre direto no Excel)."
      />
      <div className="mb-6">
        <Tabs
          value={report}
          onChange={setReport}
          options={[
            { value: 'monthly', label: 'Fechamento do mês', icon: <CalendarCheck /> },
            { value: 'sales', label: 'Vendas', icon: <ShoppingCart /> },
            { value: 'position', label: 'Posição de estoque', icon: <Boxes /> },
            { value: 'purchase', label: 'Sugestão de compra', icon: <PackagePlus /> },
            { value: 'stale', label: 'Produtos parados', icon: <PackageX /> },
            { value: 'movements', label: 'Movimentações', icon: <ArrowLeftRight /> },
            { value: 'abc', label: 'Curva ABC', icon: <TrendingUp /> },
          ]}
        />
      </div>
      {report === 'monthly' && <MonthlyReport />}
      {report === 'sales' && <SalesReport />}
      {report === 'position' && <StockPositionReport />}
      {report === 'purchase' && <PurchaseSuggestionReport />}
      {report === 'stale' && <StaleProductsReport />}
      {report === 'movements' && <MovementsReport />}
      {report === 'abc' && <AbcReport />}
    </>
  );
}

export function ExportButton({ path, filename, query }: { path: string; filename: string; query: Query }) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      icon={<Download className="size-4" />}
      loading={loading}
      onClick={async () => {
        setLoading(true);
        try {
          await api.download(path, filename, { ...query, format: 'csv' });
        } catch (error) {
          toast.error('Falha ao exportar', (error as Error).message);
        } finally {
          setLoading(false);
        }
      }}
    >
      CSV
    </Button>
  );
}

/* ---------- Posição de estoque ---------- */

interface PositionRow {
  productId: string;
  sku: string;
  name: string;
  category: string | null;
  unit: string;
  quantity: number;
  minStock: number;
  costCents: number;
  valueCents: number;
  status: 'OK' | 'LOW' | 'OUT';
}

const STATUS: Record<PositionRow['status'], { label: string; tone: Tone }> = {
  OK: { label: 'OK', tone: 'green' },
  LOW: { label: 'Baixo', tone: 'yellow' },
  OUT: { label: 'Sem estoque', tone: 'red' },
};

function StockPositionReport() {
  const { data: warehouses = [] } = useWarehouses();
  const { data: categories = [] } = useCategories();
  const [filters, setFilters] = useState({ warehouseId: '', category: '' });

  const report = useQuery({
    queryKey: ['reports', 'position', filters],
    queryFn: () =>
      api.get<{
        rows: PositionRow[];
        summary: { products: number; totalUnits: number; totalValueCents: number; outOfStock: number; low: number };
      }>('/reports/stock-position', filters),
  });

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-3">
        <Select
          value={filters.warehouseId}
          onChange={(e) => setFilters({ ...filters, warehouseId: e.target.value })}
          className="w-auto"
          aria-label="Estoque"
        >
          <option value="">Consolidado (todos os estoques)</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
        <Select
          value={filters.category}
          onChange={(e) => setFilters({ ...filters, category: e.target.value })}
          className="w-auto"
          aria-label="Categoria"
        >
          <option value="">Todas as categorias</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
      </div>

      {report.isPending ? (
        <Spinner />
      ) : report.isError ? (
        <ErrorMessage error={report.error} />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Valor total (custo)" value={formatMoney(report.data.summary.totalValueCents)} />
            <StatCard
              label="Unidades"
              value={formatNumber(report.data.summary.totalUnits)}
              hint={`${report.data.summary.products} produtos`}
            />
            <StatCard label="Abaixo do mínimo" value={report.data.summary.low} tone="amber" />
            <StatCard label="Sem estoque" value={report.data.summary.outOfStock} tone="red" />
          </div>
          <Card>
            <CardHeader
              title="Posição por produto"
              actions={<ExportButton path="/reports/stock-position" filename="posicao-estoque.csv" query={filters} />}
            />
            <Table>
              <thead>
                <tr>
                  <Th>Produto</Th>
                  <Th className="hidden md:table-cell">Categoria</Th>
                  <Th className="text-right">Saldo</Th>
                  <Th className="hidden sm:table-cell text-right">Mín.</Th>
                  <Th className="hidden lg:table-cell text-right">Custo médio</Th>
                  <Th className="text-right">Valor</Th>
                  <Th>Situação</Th>
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
                    <Td className="hidden sm:table-cell text-right tabular-nums">{row.minStock}</Td>
                    <Td className="hidden lg:table-cell text-right tabular-nums">{formatMoney(row.costCents)}</Td>
                    <Td className="text-right font-medium text-slate-900 tabular-nums">
                      {formatMoney(row.valueCents)}
                    </Td>
                    <Td>
                      <Badge tone={STATUS[row.status].tone}>{STATUS[row.status].label}</Badge>
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

/* ---------- Período ---------- */

export function usePeriod() {
  const today = new Date();
  const [period, setPeriod] = useState({
    from: toDateInput(new Date(today.getTime() - 29 * 86_400_000)),
    to: toDateInput(today),
    warehouseId: '',
  });
  const query = { from: dayStartIso(period.from), to: dayEndIso(period.to), warehouseId: period.warehouseId };
  return { period, setPeriod, query };
}

export function PeriodFilters({ period, setPeriod }: ReturnType<typeof usePeriod>) {
  const { data: warehouses = [] } = useWarehouses();
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <Input
        type="date"
        value={period.from}
        max={period.to}
        onChange={(e) => e.target.value && setPeriod({ ...period, from: e.target.value })}
        className="w-auto"
        aria-label="De"
      />
      <span className="text-sm text-slate-500">até</span>
      <Input
        type="date"
        value={period.to}
        min={period.from}
        onChange={(e) => e.target.value && setPeriod({ ...period, to: e.target.value })}
        className="w-auto"
        aria-label="Até"
      />
      <Select
        value={period.warehouseId}
        onChange={(e) => setPeriod({ ...period, warehouseId: e.target.value })}
        className="w-auto"
        aria-label="Estoque"
      >
        <option value="">Todos os estoques</option>
        {warehouses.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </Select>
    </div>
  );
}

/* ---------- Movimentações ---------- */

interface MovementSummaryRow {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  entries: number;
  exits: number;
  transfersIn: number;
  transfersOut: number;
  adjustments: number;
  entryValueCents: number;
  exitValueCents: number;
}

function MovementsReport() {
  const periodState = usePeriod();
  const report = useQuery({
    queryKey: ['reports', 'movements', periodState.query],
    queryFn: () =>
      api.get<{
        rows: MovementSummaryRow[];
        totals: {
          ENTRY: number;
          EXIT: number;
          ADJUSTMENT: number;
          movements: number;
          entryValueCents: number;
          exitValueCents: number;
        };
      }>('/reports/movements', periodState.query),
  });

  return (
    <>
      <PeriodFilters {...periodState} />
      {report.isPending ? (
        <Spinner />
      ) : report.isError ? (
        <ErrorMessage error={report.error} />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Movimentações" value={formatNumber(report.data.totals.movements)} />
            <StatCard
              label="Unidades recebidas"
              value={formatNumber(report.data.totals.ENTRY)}
              hint={formatMoney(report.data.totals.entryValueCents)}
            />
            <StatCard
              label="Unidades saídas"
              value={formatNumber(report.data.totals.EXIT)}
              hint={`Custo ${formatMoney(report.data.totals.exitValueCents)}`}
            />
            <StatCard label="Unidades ajustadas" value={formatNumber(report.data.totals.ADJUSTMENT)} tone="slate" />
          </div>
          <Card>
            <CardHeader
              title="Resumo por produto"
              actions={
                <ExportButton path="/reports/movements" filename="resumo-movimentacoes.csv" query={periodState.query} />
              }
            />
            {report.data.rows.length === 0 ? (
              <EmptyState title="Sem movimentações no período" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Produto</Th>
                    <Th className="text-right">Entradas</Th>
                    <Th className="text-right">Saídas</Th>
                    <Th className="hidden md:table-cell text-right">Transf. (rec./env.)</Th>
                    <Th className="hidden md:table-cell text-right">Ajustes</Th>
                    <Th className="hidden lg:table-cell text-right">Custo das saídas</Th>
                  </tr>
                </thead>
                <tbody>
                  {report.data.rows.map((row) => (
                    <tr key={row.productId}>
                      <Td>
                        <p className="font-medium text-slate-900">{row.name}</p>
                        <p className="text-xs text-slate-500">{row.sku}</p>
                      </Td>
                      <Td className="text-right tabular-nums">{formatNumber(row.entries)}</Td>
                      <Td className="text-right tabular-nums">{formatNumber(row.exits)}</Td>
                      <Td className="hidden md:table-cell text-right tabular-nums">
                        {formatNumber(row.transfersIn)} / {formatNumber(row.transfersOut)}
                      </Td>
                      <Td className="hidden md:table-cell text-right tabular-nums">
                        {row.adjustments > 0 ? '+' : ''}
                        {formatNumber(row.adjustments)}
                      </Td>
                      <Td className="hidden lg:table-cell text-right tabular-nums">
                        {formatMoney(row.exitValueCents)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      )}
    </>
  );
}

/* ---------- Curva ABC ---------- */

interface AbcItem {
  productId: string;
  sku: string;
  name: string;
  exits: number;
  exitValueCents: number;
  share: number;
  cumulativeShare: number;
  class: 'A' | 'B' | 'C';
}

// Rampa sequencial azul (mesma cor na barra, na legenda e nos selos da tabela).
const CLASS_INFO = {
  A: {
    color: '#1c5cab',
    ink: '#ffffff',
    text: 'Poucos itens, maior parte do valor: controle rigoroso e contagem frequente.',
  },
  B: { color: '#3987e5', ink: '#ffffff', text: 'Importância intermediária.' },
  C: { color: '#86b6ef', ink: '#0d366b', text: 'Muitos itens, pouco valor: controle simplificado.' },
};

function AbcReport() {
  const periodState = usePeriod();
  const report = useQuery({
    queryKey: ['reports', 'abc', periodState.query],
    queryFn: () =>
      api.get<{
        items: AbcItem[];
        totalValueCents: number;
        classes: Record<'A' | 'B' | 'C', { items: number; valueCents: number }>;
      }>('/reports/abc', periodState.query),
  });

  return (
    <>
      <PeriodFilters {...periodState} />
      {report.isPending ? (
        <Spinner />
      ) : report.isError ? (
        <ErrorMessage error={report.error} />
      ) : report.data.items.length === 0 ? (
        <Card>
          <EmptyState title="Sem saídas no período" description="A curva ABC é calculada pelo custo das saídas." />
        </Card>
      ) : (
        <>
          <Card className="mb-6 p-5">
            <p className="text-sm font-medium text-slate-700">
              Participação no custo das saídas · total {formatMoney(report.data.totalValueCents)}
            </p>
            <div
              className="mt-3 flex h-8 gap-0.5 overflow-hidden rounded-md"
              role="img"
              aria-label="Distribuição do valor por classe"
            >
              {(['A', 'B', 'C'] as const).map((cls) => {
                const share = report.data.classes[cls].valueCents / report.data.totalValueCents;
                return share > 0 ? (
                  <div
                    key={cls}
                    className="flex items-center justify-center text-xs font-semibold text-white"
                    style={{ width: `${share * 100}%`, background: CLASS_INFO[cls].color, color: CLASS_INFO[cls].ink }}
                    title={`Classe ${cls}: ${formatPercent(share)}`}
                  >
                    {share > 0.06 && `${cls} · ${formatPercent(share)}`}
                  </div>
                ) : null;
              })}
            </div>
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
              {(['A', 'B', 'C'] as const).map((cls) => (
                <div key={cls} className="flex gap-3">
                  <span
                    className="mt-1 size-3 shrink-0 rounded-sm"
                    style={{ background: CLASS_INFO[cls].color }}
                    aria-hidden
                  />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      Classe {cls} · {report.data.classes[cls].items} itens ·{' '}
                      {formatMoney(report.data.classes[cls].valueCents)}
                    </p>
                    <p className="text-xs text-slate-500">{CLASS_INFO[cls].text}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Ranking por custo das saídas"
              actions={<ExportButton path="/reports/abc" filename="curva-abc.csv" query={periodState.query} />}
            />
            <Table>
              <thead>
                <tr>
                  <Th>Classe</Th>
                  <Th>Produto</Th>
                  <Th className="hidden sm:table-cell text-right">Qtd. saída</Th>
                  <Th className="text-right">Custo saídas</Th>
                  <Th className="hidden md:table-cell text-right">% do total</Th>
                  <Th className="text-right">% acumulado</Th>
                </tr>
              </thead>
              <tbody>
                {report.data.items.map((item) => (
                  <tr key={item.productId}>
                    <Td>
                      <span
                        className="inline-flex size-6 items-center justify-center rounded-md text-xs font-semibold"
                        style={{ background: CLASS_INFO[item.class].color, color: CLASS_INFO[item.class].ink }}
                      >
                        {item.class}
                      </span>
                    </Td>
                    <Td>
                      <p className="font-medium text-slate-900">{item.name}</p>
                      <p className="text-xs text-slate-500">{item.sku}</p>
                    </Td>
                    <Td className="hidden sm:table-cell text-right tabular-nums">{formatNumber(item.exits)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(item.exitValueCents)}</Td>
                    <Td className="hidden md:table-cell text-right tabular-nums">{formatPercent(item.share)}</Td>
                    <Td className="text-right tabular-nums">{formatPercent(item.cumulativeShare)}</Td>
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
