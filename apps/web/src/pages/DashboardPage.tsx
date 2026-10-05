import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, ArrowRight, Bell, CircleDollarSign, Package, TriangleAlert } from 'lucide-react';
import { api } from '../lib/api';
import { BackupWarning } from '../components/BackupWarning';
import { useAuth } from '../lib/auth';
import {
  ALERT_LABEL,
  MOVEMENT_LABEL,
  MOVEMENT_TONE,
  formatCompactMoney,
  formatMoney,
  formatNumber,
  formatRelative,
} from '../lib/format';
import type { Movement, Paginated, StockAlert } from '../lib/types';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorMessage,
  PageHeader,
  Spinner,
  StatCard,
  Table,
  Td,
  Th,
} from '../components/ui';

interface Dashboard {
  totals: {
    products: number;
    warehouses: number;
    stockUnits: number;
    stockValueCents: number;
    openAlerts: number;
    movementsToday: number;
    salesToday: { count: number; totalCents: number };
  };
  movementsByDay: Array<{ date: string; entries: number; exits: number }>;
  recentMovements: Movement[];
  topExits: Array<{ product?: { id: string; name: string; unit: string }; quantity: number }>;
}

// Paleta categórica validada para daltonismo (azul = entradas, laranja = saídas).
const SERIES = ['#2a78d6', '#eb6834'];

const shortDate = (date: string) => date.slice(8, 10) + '/' + date.slice(5, 7);

export function DashboardPage() {
  const { session } = useAuth();
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dashboard>('/dashboard') });
  const alerts = useQuery({
    queryKey: ['alerts', 'list', 'dashboard'],
    queryFn: () => api.get<Paginated<StockAlert>>('/alerts', { status: 'OPEN', pageSize: 5 }),
  });

  if (dashboard.isPending) return <Spinner />;
  if (dashboard.isError) return <ErrorMessage error={dashboard.error} />;

  const { totals, movementsByDay, recentMovements, topExits } = dashboard.data;
  const maxExit = Math.max(1, ...topExits.map((item) => item.quantity));

  return (
    <>
      <PageHeader
        title={`Olá, ${session?.user.name.split(' ')[0]}`}
        description="Resumo da operação nos seus estoques."
      />

      <BackupWarning />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label="Produtos ativos"
          value={formatNumber(totals.products)}
          hint={`${formatNumber(totals.stockUnits)} unidades em ${totals.warehouses} estoques`}
          icon={<Package />}
        />
        <StatCard
          label="Valor em estoque"
          value={formatCompactMoney(totals.stockValueCents)}
          hint={`${formatMoney(totals.stockValueCents)} a custo médio`}
          icon={<CircleDollarSign />}
        />
        <StatCard
          label="Alertas abertos"
          value={formatNumber(totals.openAlerts)}
          hint={
            <Link to="/alerts" className="text-brand-700 hover:underline">
              Ver alertas
            </Link>
          }
          icon={<Bell />}
          tone={totals.openAlerts > 0 ? 'red' : 'slate'}
        />
        <StatCard
          label="Vendas hoje"
          value={formatMoney(totals.salesToday.totalCents)}
          hint={`${totals.salesToday.count} venda(s) · ${formatNumber(totals.movementsToday)} movimentações`}
          icon={<Activity />}
          tone="slate"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Entradas × saídas"
            description="Unidades movimentadas por dia, últimos 30 dias (sem transferências)"
          />
          <div className="h-72 px-2 pt-4 pb-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={movementsByDay} barGap={2} margin={{ top: 4, right: 12, left: -8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e2e8f0" />
                <XAxis
                  dataKey="date"
                  tickFormatter={shortDate}
                  tick={{ fontSize: 12, fill: '#64748b' }}
                  tickLine={false}
                  axisLine={{ stroke: '#cbd5e1' }}
                  minTickGap={24}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: '#64748b' }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={{ fill: '#f1f5f9' }}
                  labelFormatter={(label) =>
                    new Date(`${label}T12:00:00`).toLocaleDateString('pt-BR', {
                      weekday: 'short',
                      day: '2-digit',
                      month: '2-digit',
                    })
                  }
                  formatter={(value, name) => [`${formatNumber(Number(value))} un.`, name]}
                  contentStyle={{ borderRadius: 8, borderColor: '#e2e8f0', fontSize: 13 }}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 13, color: '#334155' }} />
                <Bar
                  dataKey="entries"
                  name="Entradas"
                  fill={SERIES[0]}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={14}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="exits"
                  name="Saídas"
                  fill={SERIES[1]}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={14}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Alertas de estoque"
            actions={
              <Link
                to="/alerts"
                className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
              >
                Todos <ArrowRight className="size-3.5" />
              </Link>
            }
          />
          {alerts.data?.data.length ? (
            <ul className="divide-y divide-slate-100">
              {alerts.data.data.map((alert) => (
                <li key={alert.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <Link
                      to={`/products/${alert.productId}`}
                      className="block truncate text-sm font-medium text-slate-900 hover:underline"
                    >
                      {alert.product?.name}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {alert.warehouse?.name} · saldo {alert.quantity} / mín. {alert.threshold}
                    </p>
                  </div>
                  <Badge tone={alert.type === 'LOW_STOCK' ? 'yellow' : 'red'} icon={<TriangleAlert />}>
                    {ALERT_LABEL[alert.type]}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Nenhum alerta aberto" description="Todos os produtos estão acima do mínimo." />
          )}
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Últimas movimentações"
            actions={
              <Link
                to="/movements"
                className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
              >
                Histórico <ArrowRight className="size-3.5" />
              </Link>
            }
          />
          <Table>
            <thead>
              <tr>
                <Th>Tipo</Th>
                <Th>Produto</Th>
                <Th className="hidden md:table-cell">Estoque</Th>
                <Th className="text-right">Qtd.</Th>
                <Th className="hidden sm:table-cell text-right">Quando</Th>
              </tr>
            </thead>
            <tbody>
              {recentMovements.map((movement) => (
                <tr key={movement.id}>
                  <Td>
                    <Badge tone={MOVEMENT_TONE[movement.type]}>{MOVEMENT_LABEL[movement.type]}</Badge>
                  </Td>
                  <Td className="max-w-56 truncate font-medium text-slate-900">{movement.product.name}</Td>
                  <Td className="hidden md:table-cell">{movement.warehouse.name}</Td>
                  <Td
                    className={`text-right font-medium tabular-nums ${movement.quantity > 0 ? 'text-emerald-700' : 'text-slate-900'}`}
                  >
                    {movement.quantity > 0 ? '+' : ''}
                    {formatNumber(movement.quantity)}
                  </Td>
                  <Td className="hidden sm:table-cell text-right text-slate-500">
                    {formatRelative(movement.createdAt)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card>
          <CardHeader title="Mais vendidos" description="Saídas nos últimos 30 dias" />
          <ul className="space-y-4 px-5 py-4">
            {topExits.map((item, index) => (
              <li key={item.product?.id ?? index}>
                <div className="mb-1 flex justify-between gap-3 text-sm">
                  <span className="truncate text-slate-700">{item.product?.name}</span>
                  <span className="font-medium text-slate-900 tabular-nums">
                    {formatNumber(item.quantity)} {item.product?.unit}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-100">
                  <div
                    className="h-2 rounded-full bg-series-1"
                    style={{ width: `${(item.quantity / maxExit) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
