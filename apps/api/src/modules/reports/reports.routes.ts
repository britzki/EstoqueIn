import { Router } from 'express';
import { z } from 'zod';
import { centsToDecimal, sendCsv, toCsv } from '../../lib/csv.js';
import { badRequest } from '../../lib/errors.js';
import { currentUser, requirePermission } from '../../middleware/auth.js';
import { can } from '../../auth/permissions.js';
import { getSalesReport } from '../sales/sales.report.js';
import { getPurchaseSuggestion, getStaleProducts } from './purchasing.report.js';
import { getMonthlyReport } from './monthly.report.js';
import { getAbcCurve, getDashboard, getMovementSummary, getStockPosition } from './reports.service.js';

export const dashboardRoutes = Router();
export const reportsRoutes = Router();

dashboardRoutes.get('/', async (_req, res) => {
  res.json(await getDashboard());
});

reportsRoutes.use(requirePermission('reports:read'));

const STATUS_LABEL = { OK: 'OK', LOW: 'Baixo', OUT: 'Sem estoque' } as const;

const format = z.enum(['json', 'csv']).default('json');

const positionSchema = z.object({
  warehouseId: z.string().optional(),
  category: z.string().optional(),
  format,
});

const periodSchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    warehouseId: z.string().optional(),
    format,
  })
  .refine((value) => value.from <= value.to, 'A data inicial deve ser anterior à final');

const parsePeriod = (query: unknown) => {
  const result = periodSchema.safeParse(query);
  if (!result.success) throw badRequest('Informe um período válido (from/to)', result.error.issues);
  return result.data;
};

reportsRoutes.get('/stock-position', async (req, res) => {
  const filters = positionSchema.parse(req.query);
  const report = await getStockPosition(filters);

  if (filters.format === 'csv') {
    const csv = toCsv(report.rows, [
      { header: 'SKU', value: (r) => r.sku },
      { header: 'Produto', value: (r) => r.name },
      { header: 'Categoria', value: (r) => r.category },
      { header: 'Unidade', value: (r) => r.unit },
      { header: 'Saldo', value: (r) => r.quantity },
      { header: 'Mínimo', value: (r) => r.minStock },
      { header: 'Custo médio', value: (r) => centsToDecimal(r.costCents) },
      { header: 'Valor em estoque', value: (r) => centsToDecimal(r.valueCents) },
      { header: 'Situação', value: (r) => STATUS_LABEL[r.status] },
    ]);
    sendCsv(res, 'posicao-estoque.csv', csv);
    return;
  }
  res.json(report);
});

reportsRoutes.get('/movements', async (req, res) => {
  const filters = parsePeriod(req.query);
  const report = await getMovementSummary(filters);

  if (filters.format === 'csv') {
    const csv = toCsv(report.rows, [
      { header: 'SKU', value: (r) => r.sku },
      { header: 'Produto', value: (r) => r.name },
      { header: 'Entradas', value: (r) => r.entries },
      { header: 'Saídas', value: (r) => r.exits },
      { header: 'Transf. recebidas', value: (r) => r.transfersIn },
      { header: 'Transf. enviadas', value: (r) => r.transfersOut },
      { header: 'Ajustes', value: (r) => r.adjustments },
      { header: 'Valor entradas', value: (r) => centsToDecimal(r.entryValueCents) },
      { header: 'Custo das saídas', value: (r) => centsToDecimal(r.exitValueCents) },
    ]);
    sendCsv(res, 'resumo-movimentacoes.csv', csv);
    return;
  }
  res.json(report);
});

const PAYMENT_LABEL: Record<string, string> = {
  CASH: 'Dinheiro',
  PIX: 'Pix',
  DEBIT: 'Débito',
  CREDIT: 'Crédito',
  OTHER: 'Outro',
  ACCOUNT: 'Fiado',
};

/** Fechamento do mês (ou de outro período): vendas, despesas, fiado, caixa e estoque numa página. */
reportsRoutes.get('/monthly', async (req, res) => {
  const filters = parsePeriod(req.query);
  const report = await getMonthlyReport(filters);
  // Contas a pagar são só de administrador e gerente: os outros perfis veem o mês sem as despesas.
  if (!can(currentUser(req).role, 'bills:manage')) {
    res.json({ ...report, expenses: null, resultCents: null });
    return;
  }
  res.json(report);
});

reportsRoutes.get('/sales', async (req, res) => {
  const filters = parsePeriod(req.query);
  const report = await getSalesReport(filters);

  if (filters.format === 'csv') {
    const csv = toCsv(report.sales, [
      { header: 'Venda', value: (r) => r.number },
      { header: 'Data', value: (r) => r.createdAt.toISOString() },
      { header: 'Itens', value: (r) => r.items },
      { header: 'Desconto', value: (r) => centsToDecimal(r.discountCents) },
      { header: 'Total', value: (r) => centsToDecimal(r.totalCents) },
      { header: 'Lucro', value: (r) => centsToDecimal(r.profitCents) },
      {
        header: 'Pagamento',
        value: (r) =>
          r.payments
            .split(' + ')
            .map((method) => PAYMENT_LABEL[method])
            .join(' + '),
      },
      { header: 'Vendedor', value: (r) => r.user },
    ]);
    sendCsv(res, 'vendas.csv', csv);
    return;
  }
  res.json(report);
});

reportsRoutes.get('/abc', async (req, res) => {
  const filters = parsePeriod(req.query);
  const report = await getAbcCurve(filters);

  if (filters.format === 'csv') {
    const csv = toCsv(report.items, [
      { header: 'Classe', value: (r) => r.class },
      { header: 'SKU', value: (r) => r.sku },
      { header: 'Produto', value: (r) => r.name },
      { header: 'Qtd. saída', value: (r) => r.exits },
      { header: 'Valor saída', value: (r) => centsToDecimal(r.exitValueCents) },
      { header: '% do total', value: (r) => (r.share * 100).toFixed(2).replace('.', ',') },
      { header: '% acumulado', value: (r) => (r.cumulativeShare * 100).toFixed(2).replace('.', ',') },
    ]);
    sendCsv(res, 'curva-abc.csv', csv);
    return;
  }
  res.json(report);
});

const purchaseSchema = z.object({
  days: z.coerce.number().int().min(7).max(365).default(30),
  coverDays: z.coerce.number().int().min(1).max(180).default(15),
  warehouseId: z.string().optional(),
  format,
});

reportsRoutes.get('/purchase-suggestion', async (req, res) => {
  const filters = purchaseSchema.parse(req.query);
  const report = await getPurchaseSuggestion(filters);

  if (filters.format === 'csv') {
    const csv = toCsv(report.rows, [
      { header: 'Fornecedor', value: (r) => r.supplier?.name ?? 'Sem fornecedor' },
      { header: 'SKU', value: (r) => r.sku },
      { header: 'Produto', value: (r) => r.name },
      { header: 'Unidade', value: (r) => r.unit },
      { header: 'Saldo', value: (r) => r.quantity },
      { header: 'Mínimo', value: (r) => r.minStock },
      { header: 'Já pedido', value: (r) => r.onOrder },
      { header: 'Consumo médio/dia', value: (r) => r.dailyAverage },
      { header: 'Dias restantes', value: (r) => r.daysLeft ?? '' },
      { header: 'Comprar', value: (r) => r.suggested },
      { header: 'Custo estimado', value: (r) => centsToDecimal(r.estimatedCents) },
    ]);
    sendCsv(res, 'sugestao-de-compra.csv', csv);
    return;
  }
  res.json(report);
});

const staleSchema = z.object({
  days: z.coerce.number().int().min(7).max(730).default(60),
  warehouseId: z.string().optional(),
  format,
});

reportsRoutes.get('/stale-products', async (req, res) => {
  const filters = staleSchema.parse(req.query);
  const report = await getStaleProducts(filters);

  if (filters.format === 'csv') {
    const csv = toCsv(report.rows, [
      { header: 'SKU', value: (r) => r.sku },
      { header: 'Produto', value: (r) => r.name },
      { header: 'Categoria', value: (r) => r.category },
      { header: 'Saldo', value: (r) => r.quantity },
      { header: 'Valor parado', value: (r) => centsToDecimal(r.valueCents) },
      { header: 'Última saída', value: (r) => r.lastExitAt?.toISOString().slice(0, 10) ?? 'Nunca' },
    ]);
    sendCsv(res, 'produtos-parados.csv', csv);
    return;
  }
  res.json(report);
});
