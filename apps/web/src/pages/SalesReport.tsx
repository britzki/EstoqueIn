import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { PAYMENT_LABEL, formatDate, formatMoney, formatNumber, formatPercent } from '../lib/format';
import type { PaymentMethod } from '../lib/types';
import { Card, CardHeader, EmptyState, ErrorMessage, Spinner, StatCard, Table, Td, Th } from '../components/ui';
import { ExportButton, PeriodFilters, usePeriod } from './ReportsPage';

interface SalesReportData {
  totals: {
    sales: number;
    cancelled: number;
    /** Devoluções do período, já descontadas do faturamento e do lucro. */
    returns: number;
    refundsCents: number;
    revenueCents: number;
    discountCents: number;
    costCents: number;
    profitCents: number;
    averageTicketCents: number;
  };
  byPayment: Partial<Record<PaymentMethod, number>>;
  byDay: Array<{ date: string; sales: number; revenueCents: number; profitCents: number }>;
  products: Array<{
    productId: string;
    name: string;
    unit: string;
    quantity: number;
    revenueCents: number;
    profitCents: number;
  }>;
}

export function SalesReport() {
  const periodState = usePeriod();
  const report = useQuery({
    queryKey: ['reports', 'sales', periodState.query],
    queryFn: () => api.get<SalesReportData>('/reports/sales', periodState.query),
  });

  return (
    <>
      <PeriodFilters {...periodState} />
      {report.isPending ? (
        <Spinner />
      ) : report.isError ? (
        <ErrorMessage error={report.error} />
      ) : report.data.totals.sales === 0 ? (
        <Card>
          <EmptyState title="Sem vendas no período" description="As vendas registradas no caixa aparecem aqui." />
        </Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Faturamento"
              value={formatMoney(report.data.totals.revenueCents)}
              hint={`${report.data.totals.sales} vendas${report.data.totals.cancelled ? ` · ${report.data.totals.cancelled} cancelada(s)` : ''}${report.data.totals.returns ? ` · menos ${formatMoney(report.data.totals.refundsCents)} em devoluções` : ''}`}
            />
            <StatCard
              label="Lucro bruto"
              value={formatMoney(report.data.totals.profitCents)}
              hint={`Margem ${formatPercent(report.data.totals.revenueCents ? report.data.totals.profitCents / report.data.totals.revenueCents : 0)} · pelo custo médio`}
            />
            <StatCard label="Ticket médio" value={formatMoney(report.data.totals.averageTicketCents)} tone="slate" />
            <StatCard label="Descontos" value={formatMoney(report.data.totals.discountCents)} tone="slate" />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader title="Por forma de pagamento" description="Dinheiro já sem o troco" />
              <ul className="divide-y divide-slate-100">
                {(Object.entries(report.data.byPayment) as Array<[PaymentMethod, number]>)
                  .sort((a, b) => b[1] - a[1])
                  .map(([method, cents]) => (
                    <li key={method} className="flex justify-between px-5 py-3 text-sm">
                      <span className="text-slate-700">{PAYMENT_LABEL[method]}</span>
                      <span className="font-medium text-slate-900 tabular-nums">{formatMoney(cents)}</span>
                    </li>
                  ))}
              </ul>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader title="Por dia" />
              <Table>
                <thead>
                  <tr>
                    <Th>Dia</Th>
                    <Th className="text-right">Vendas</Th>
                    <Th className="text-right">Faturamento</Th>
                    <Th className="text-right">Lucro</Th>
                  </tr>
                </thead>
                <tbody>
                  {report.data.byDay.map((day) => (
                    <tr key={day.date}>
                      <Td>{formatDate(`${day.date}T12:00:00`)}</Td>
                      <Td className="text-right tabular-nums">{day.sales}</Td>
                      <Td className="text-right tabular-nums">{formatMoney(day.revenueCents)}</Td>
                      <Td className="text-right tabular-nums">{formatMoney(day.profitCents)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Produtos vendidos"
              actions={<ExportButton path="/reports/sales" filename="vendas.csv" query={periodState.query} />}
            />
            <Table>
              <thead>
                <tr>
                  <Th>Produto</Th>
                  <Th className="text-right">Quantidade</Th>
                  <Th className="text-right">Faturamento</Th>
                  <Th className="text-right">Lucro</Th>
                </tr>
              </thead>
              <tbody>
                {report.data.products.map((product) => (
                  <tr key={product.productId}>
                    <Td className="font-medium text-slate-900">{product.name}</Td>
                    <Td className="text-right tabular-nums">
                      {formatNumber(product.quantity)} {product.unit}
                    </Td>
                    <Td className="text-right tabular-nums">{formatMoney(product.revenueCents)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(product.profitCents)}</Td>
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
