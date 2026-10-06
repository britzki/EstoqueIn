import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { api } from '../lib/api';
import { useStoreSettings } from '../lib/hooks';
import { PAYMENT_LABEL, formatMoney, formatNumber } from '../lib/format';
import type { PaymentMethod } from '../lib/types';
import { Button, Card, CardHeader, ErrorMessage, Input, Spinner, StatCard, Table, Td, Th } from '../components/ui';
import { cn } from '../lib/cn';

interface Monthly {
  sales: {
    count: number;
    cancelled: number;
    returns: number;
    revenueCents: number;
    refundsCents: number;
    discountCents: number;
    grossProfitCents: number;
    averageTicketCents: number;
    byPayment: Partial<Record<PaymentMethod, number>>;
    topProducts: Array<{ name: string; quantity: number; unit: string; revenueCents: number; profitCents: number }>;
  };
  expenses: {
    paidCents: number;
    bills: Array<{ description: string; supplier: string | null; amountCents: number }>;
    openCount: number;
    openCents: number;
  } | null;
  /** Sem permissão de contas a pagar, despesas e resultado não vêm. */
  resultCents: number | null;
  account: { soldCents: number; receivedCents: number; outstandingCents: number; debtors: number };
  cash: { sessions: number; differenceCents: number; withDifference: number };
  stock: { valueCents: number; products: number; outOfStock: number; staleProducts: number; staleValueCents: number };
  purchases: { orders: number; estimatedCents: number };
}

const monthInput = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

/** Primeiro e último instante do mês, no horário local. */
function monthRange(month: string) {
  const [year, m] = month.split('-').map(Number);
  return {
    from: new Date(year, m - 1, 1, 0, 0, 0, 0).toISOString(),
    to: new Date(year, m, 0, 23, 59, 59, 999).toISOString(),
    label: new Date(year, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
  };
}

/** Fechamento do mês: uma página com vendas, despesas, fiado, caixa e estoque, para o dono ou o contador. */
export function MonthlyReport() {
  const [month, setMonth] = useState(monthInput(new Date()));
  const [printing, setPrinting] = useState(false);
  const { data: settings } = useStoreSettings();
  const range = monthRange(month);
  const report = useQuery({
    queryKey: ['reports', 'monthly', month],
    queryFn: () => api.get<Monthly>('/reports/monthly', { from: range.from, to: range.to }),
  });

  const print = () => {
    setPrinting(true);
    setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 150);
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          type="month"
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
          className="w-auto"
          aria-label="Mês"
        />
        <Button variant="secondary" icon={<Printer className="size-4" />} onClick={print} disabled={!report.data}>
          Imprimir / PDF
        </Button>
      </div>
      {report.isPending ? (
        <Spinner />
      ) : report.isError ? (
        <ErrorMessage error={report.error} />
      ) : (
        <>
          <MonthlyContent data={report.data} />
          {printing &&
            createPortal(
              <div className="p-2 text-[11px] text-black">
                <style>{'@media print { @page { size: A4; margin: 12mm; } }'}</style>
                <p className="text-lg font-bold">
                  {settings?.storeName} · Fechamento de {range.label}
                </p>
                <p className="mb-3 text-gray-600">Gerado em {new Date().toLocaleString('pt-BR')}</p>
                <MonthlyContent data={report.data} printable />
              </div>,
              document.getElementById('print-root')!,
            )}
        </>
      )}
    </>
  );
}

function Line({
  label,
  value,
  strong,
  negative,
}: {
  label: string;
  value: number;
  strong?: boolean;
  negative?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex justify-between py-1',
        strong && 'border-t border-slate-200 pt-2 font-semibold text-slate-900',
      )}
    >
      <span>{label}</span>
      {/* "negative" = valor que sai (despesa); valor abaixo de zero sempre aparece com o sinal. */}
      <span className={cn('tabular-nums', ((negative && value !== 0) || value < 0) && 'text-red-700')}>
        {(negative && value > 0) || value < 0 ? '− ' : ''}
        {formatMoney(Math.abs(value))}
      </span>
    </div>
  );
}

function MonthlyContent({ data, printable }: { data: Monthly; printable?: boolean }) {
  const { sales, expenses, account, cash, stock } = data;
  return (
    <div className="space-y-6">
      {!printable && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Faturamento" value={formatMoney(sales.revenueCents)} hint={`${sales.count} venda(s)`} />
          <StatCard
            label="Lucro bruto"
            value={formatMoney(sales.grossProfitCents)}
            hint="Vendas − custo dos produtos"
          />
          {expenses && data.resultCents !== null && (
            <>
              <StatCard label="Contas pagas" value={formatMoney(expenses.paidCents)} tone="amber" />
              <StatCard
                label="Resultado do mês"
                value={formatMoney(data.resultCents)}
                hint="Lucro bruto − contas pagas"
                tone={data.resultCents < 0 ? 'red' : 'brand'}
              />
            </>
          )}
        </div>
      )}

      <div className={cn('grid gap-6', printable ? 'grid-cols-2' : 'grid-cols-1 lg:grid-cols-2')}>
        <Card className={printable ? 'border-gray-300 shadow-none' : undefined}>
          <CardHeader title="Resultado" />
          <div className="px-5 py-3 text-sm text-slate-600">
            <Line label={`Vendas (${sales.count}), já sem devoluções`} value={sales.revenueCents} />
            <Line label="Lucro bruto" value={sales.grossProfitCents} />
            {expenses && data.resultCents !== null && (
              <>
                <Line label="Contas pagas no mês" value={expenses.paidCents} negative />
                <Line label="Resultado" value={data.resultCents} strong />
              </>
            )}
            <p className="mt-2 text-xs text-slate-500">
              Ticket médio {formatMoney(sales.averageTicketCents)} · descontos {formatMoney(sales.discountCents)} ·{' '}
              {sales.cancelled} cancelada(s) · {sales.returns} devolução(ões) ({formatMoney(sales.refundsCents)})
            </p>
          </div>
        </Card>

        <Card className={printable ? 'border-gray-300 shadow-none' : undefined}>
          <CardHeader title="Recebido por forma de pagamento" />
          <div className="px-5 py-3 text-sm text-slate-600">
            {(Object.entries(sales.byPayment) as Array<[PaymentMethod, number]>)
              .filter(([, value]) => value > 0)
              .map(([method, value]) => (
                <Line
                  key={method}
                  label={method === 'ACCOUNT' ? 'Vendido no fiado' : PAYMENT_LABEL[method]}
                  value={value}
                />
              ))}
          </div>
        </Card>

        <Card className={printable ? 'border-gray-300 shadow-none' : undefined}>
          <CardHeader title="Fiado" />
          <div className="px-5 py-3 text-sm text-slate-600">
            <Line label="Vendido no fiado no mês" value={account.soldCents} />
            <Line label="Recebido de fiado no mês" value={account.receivedCents} />
            <Line label={`A receber hoje (${account.debtors} cliente(s))`} value={account.outstandingCents} strong />
          </div>
        </Card>

        <Card className={printable ? 'border-gray-300 shadow-none' : undefined}>
          <CardHeader title="Caixa, estoque e contas" />
          <div className="px-5 py-3 text-sm text-slate-600">
            <div className="flex justify-between py-1">
              <span>Caixas fechados</span>
              <span>
                {cash.sessions} ({cash.withDifference} com diferença)
              </span>
            </div>
            <Line label="Diferenças de caixa somadas" value={cash.differenceCents} />
            <Line label={`Valor em estoque hoje (${stock.products} produtos)`} value={stock.valueCents} />
            <Line label={`Parado há 60 dias (${stock.staleProducts} produtos)`} value={stock.staleValueCents} />
            {expenses && <Line label={`Contas em aberto hoje (${expenses.openCount})`} value={expenses.openCents} />}
            {data.purchases.orders > 0 && (
              <Line
                label={`Pedidos de compra no mês (${data.purchases.orders})`}
                value={data.purchases.estimatedCents}
              />
            )}
          </div>
        </Card>
      </div>

      <Card className={printable ? 'border-gray-300 shadow-none' : undefined}>
        <CardHeader title="Produtos mais vendidos" />
        {sales.topProducts.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-500">Nenhuma venda no mês.</p>
        ) : (
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
              {sales.topProducts.map((product) => (
                <tr key={product.name}>
                  <Td className="text-slate-900">{product.name}</Td>
                  <Td className="text-right tabular-nums">
                    {formatNumber(product.quantity)} {product.unit}
                  </Td>
                  <Td className="text-right tabular-nums">{formatMoney(product.revenueCents)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(product.profitCents)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {expenses && expenses.bills.length > 0 && (
        <Card className={printable ? 'border-gray-300 shadow-none' : undefined}>
          <CardHeader title="Contas pagas no mês" />
          <Table>
            <tbody>
              {expenses.bills.map((bill, index) => (
                <tr key={index}>
                  <Td className="text-slate-900">
                    {bill.description}
                    {bill.supplier && <span className="block text-xs text-slate-500">{bill.supplier}</span>}
                  </Td>
                  <Td className="text-right tabular-nums">{formatMoney(bill.amountCents)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
