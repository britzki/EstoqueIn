import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  Barcode as BarcodeIcon,
  ChevronLeft,
  PackageOpen,
  Pencil,
  Printer,
  TriangleAlert,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { ALERT_LABEL, formatMoney, formatNumber, formatPercent } from '../../lib/format';
import type { Movement, Paginated, ProductDetail, ProductStock } from '../../lib/types';
import { Barcode } from '../../components/Barcode';
import { MovementsTable } from '../../components/MovementsTable';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DecimalInput,
  EmptyState,
  ErrorMessage,
  LinkButton,
  Pagination,
  Spinner,
  StatCard,
  Table,
  Td,
  Th,
} from '../../components/ui';
import { ProductFormModal } from './ProductFormModal';
import { LabelPrintModal } from './LabelPrintModal';
import { KitEditor } from './KitEditor';

export function ProductDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [creatingBulk, setCreatingBulk] = useState(false);
  const navigate = useNavigate();
  const [page, setPage] = useState(1);

  const product = useQuery({ queryKey: ['product', id], queryFn: () => api.get<ProductDetail>(`/products/${id}`) });
  const movements = useQuery({
    queryKey: ['movements', { productId: id, page }],
    queryFn: () => api.get<Paginated<Movement>>('/stock/movements', { productId: id, page, pageSize: 10 }),
  });

  const generateBarcode = useMutation({
    mutationFn: () => api.post(`/products/${id}/barcode`),
    onSuccess: () => {
      toast.success('Código de barras gerado', 'EAN-13 de uso interno (prefixo 2).');
      queryClient.invalidateQueries({ queryKey: ['product', id] });
    },
    onError: (error) => toast.error('Não foi possível gerar', error.message),
  });

  const unlink = useMutation({
    mutationFn: (mappingId: string) => api.delete(`/products/${id}/supplier-codes/${mappingId}`),
    onSuccess: () => {
      toast.success('Vínculo desfeito');
      queryClient.invalidateQueries({ queryKey: ['product', id] });
    },
    onError: (error) => toast.error('Não foi possível desvincular', error.message),
  });

  if (product.isPending) return <Spinner />;
  if (product.isError) return <ErrorMessage error={product.error} />;

  const p = product.data;
  const margin = p.priceCents > 0 ? (p.priceCents - p.costCents) / p.priceCents : 0;
  const isBulk = Boolean(p.sourceProduct);
  const hasBulk = p.bulkProducts.length > 0;

  return (
    <>
      <Link to="/products" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
        <ChevronLeft className="size-4" /> Produtos
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{p.name}</h1>
            {!p.active && <Badge>Inativo</Badge>}
            {p.isKit && <Badge tone="violet">Kit</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {p.sku} · {p.category ?? 'Sem categoria'} · {p.supplier?.name ?? 'Sem fornecedor'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('products:write') && (
            <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
              Editar
            </Button>
          )}
          {can('products:write') && p.active && !isBulk && !hasBulk && !p.fractional && !p.isKit && (
            <Button variant="secondary" icon={<PackageOpen className="size-4" />} onClick={() => setCreatingBulk(true)}>
              Criar versão a granel
            </Button>
          )}
          {can('stock:move') && p.active && (isBulk || hasBulk) && (
            <LinkButton
              to={`/movements/new?type=fraction&productId=${p.id}`}
              variant="secondary"
              icon={<PackageOpen className="size-4" />}
            >
              Abrir para granel
            </LinkButton>
          )}
          {can('stock:move') && p.active && !p.isKit && (
            <LinkButton to={`/movements/new?productId=${p.id}`} icon={<ArrowLeftRight className="size-4" />}>
              Movimentar
            </LinkButton>
          )}
        </div>
      </div>

      {(isBulk || hasBulk) && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-slate-700">
          <PackageOpen className="mt-0.5 size-4 shrink-0 text-brand-700" />
          {p.sourceProduct ? (
            <span>
              Produto a granel, abastecido ao abrir{' '}
              <Link to={`/products/${p.sourceProduct.id}`} className="font-medium text-brand-700 hover:underline">
                {p.sourceProduct.name}
              </Link>
              . Cada {p.sourceProduct.unit} rende {formatNumber(p.sourceYield ?? 0)} {p.unit}.
            </span>
          ) : (
            <span>
              Também vendido a granel:{' '}
              {p.bulkProducts.map((bulk, index) => (
                <span key={bulk.id}>
                  {index > 0 && ', '}
                  <Link to={`/products/${bulk.id}`} className="font-medium text-brand-700 hover:underline">
                    {bulk.name}
                  </Link>{' '}
                  ({formatNumber(bulk.sourceYield ?? 0)} {bulk.unit} por {p.unit})
                </span>
              ))}
              .
            </span>
          )}
        </div>
      )}

      {p.isKit && p.kit && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Kits disponíveis" value={formatNumber(p.kit.available)} hint="Pelo estoque dos produtos" />
          <StatCard label="Custo do kit" value={formatMoney(p.kit.costCents)} hint="Soma dos custos médios" />
          <StatCard
            label="Preço de venda"
            value={formatMoney(p.priceCents)}
            hint={`Margem ${formatPercent(p.priceCents > 0 ? (p.priceCents - p.kit.costCents) / p.priceCents : 0)}`}
          />
        </div>
      )}

      <div className={p.isKit ? 'hidden' : 'grid grid-cols-2 gap-4 lg:grid-cols-4'}>
        <StatCard
          label="Saldo total"
          value={`${formatNumber(p.totalQuantity)} ${p.unit}`}
          hint={`Mínimo padrão: ${formatNumber(p.minStock)}`}
        />
        <StatCard label="Custo médio" value={formatMoney(p.costCents)} hint="Média ponderada das entradas" />
        <StatCard label="Preço de venda" value={formatMoney(p.priceCents)} hint={`Margem ${formatPercent(margin)}`} />
        <StatCard
          label="Valor em estoque"
          value={formatMoney(Math.round(p.totalQuantity * p.costCents))}
          hint="Saldo × custo médio"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {p.isKit && <KitEditor product={p} editable={can('products:write')} />}
        <Card className={p.isKit ? 'hidden' : 'lg:col-span-2'}>
          <CardHeader
            title="Saldo por estoque"
            description="O mínimo pode ser ajustado por estoque; vazio usa o padrão do produto."
          />
          <Table>
            <thead>
              <tr>
                <Th>Estoque</Th>
                <Th className="text-right">Saldo</Th>
                <Th className="text-right">Mínimo</Th>
                <Th>Situação</Th>
              </tr>
            </thead>
            <tbody>
              {p.stock.map((row) => (
                <StockRow key={row.warehouse.id} productId={p.id} row={row} editable={can('products:write')} />
              ))}
            </tbody>
          </Table>
        </Card>

        <Card>
          <CardHeader
            title="Código de barras"
            actions={
              p.barcode && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Printer className="size-4" />}
                  onClick={() => setPrinting(true)}
                >
                  Etiquetas
                </Button>
              )
            }
          />
          <div className="flex flex-col items-center px-5 py-6">
            {p.barcode ? (
              <Barcode value={p.barcode} className="max-w-full" />
            ) : (
              <EmptyState
                icon={<BarcodeIcon />}
                title="Sem código de barras"
                description="Gere um EAN-13 interno para etiquetar e usar o leitor."
                action={
                  can('products:write') && (
                    <Button size="sm" onClick={() => generateBarcode.mutate()} loading={generateBarcode.isPending}>
                      Gerar código
                    </Button>
                  )
                }
              />
            )}
          </div>
        </Card>
      </div>

      {p.alerts.length > 0 && (
        <div className="mt-6 space-y-2">
          {p.alerts.map((alert) => (
            <div
              key={alert.id}
              className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              role="alert"
            >
              <TriangleAlert className="size-4 shrink-0" />
              <span>
                <strong>{ALERT_LABEL[alert.type]}</strong> em {alert.warehouse.name}: saldo {alert.quantity}, mínimo{' '}
                {alert.threshold}.
              </span>
            </div>
          ))}
        </div>
      )}

      {p.supplierProducts.length > 0 && (
        <Card className="mt-6">
          <CardHeader
            title="Códigos de fornecedores"
            description="Aprendidos na entrada por NF-e: usados para reconhecer este produto nas próximas notas."
          />
          <Table>
            <thead>
              <tr>
                <Th>Fornecedor</Th>
                <Th>Código na nota</Th>
                <Th className="hidden md:table-cell">Descrição na nota</Th>
                <Th className="text-right">Conversão</Th>
                {can('products:write') && <Th />}
              </tr>
            </thead>
            <tbody>
              {p.supplierProducts.map((mapping) => (
                <tr key={mapping.id}>
                  <Td className="font-medium text-slate-900">{mapping.supplier.name}</Td>
                  <Td className="font-mono text-xs">{mapping.supplierCode}</Td>
                  <Td className="hidden text-slate-500 md:table-cell">{mapping.description ?? '—'}</Td>
                  <Td className="text-right tabular-nums">
                    {mapping.conversionFactor === 1 ? '1 : 1' : `1 : ${mapping.conversionFactor} ${p.unit}`}
                  </Td>
                  {can('products:write') && (
                    <Td className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => unlink.mutate(mapping.id)}
                        loading={unlink.isPending && unlink.variables === mapping.id}
                        title="Desfazer vínculo (a próxima nota pedirá para vincular de novo)"
                      >
                        Desvincular
                      </Button>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader title="Histórico de movimentações" />
        {movements.data?.data.length ? (
          <>
            <MovementsTable movements={movements.data.data} showProduct={false} />
            <Pagination
              page={movements.data.page}
              totalPages={movements.data.totalPages}
              total={movements.data.total}
              onChange={setPage}
            />
          </>
        ) : movements.isPending ? (
          <Spinner />
        ) : (
          <EmptyState title="Nenhuma movimentação ainda" />
        )}
      </Card>

      {editing && <ProductFormModal open product={p} onClose={() => setEditing(false)} />}
      {creatingBulk && (
        <ProductFormModal
          open
          bulkOf={p}
          onClose={() => setCreatingBulk(false)}
          onSaved={(created) => navigate(`/products/${created.id}`)}
        />
      )}
      {printing && p.barcode && (
        <LabelPrintModal product={{ ...p, barcode: p.barcode }} onClose={() => setPrinting(false)} />
      )}
    </>
  );
}

function StockRow({ productId, row, editable }: { productId: string; row: ProductStock; editable: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(row.minQuantity === null ? '' : String(row.minQuantity));

  const save = useMutation({
    mutationFn: () =>
      api.put(`/products/${productId}/stock/${row.warehouse.id}/min`, {
        minQuantity: value === '' ? null : Number(value),
      }),
    onSuccess: () => {
      toast.success('Mínimo atualizado', `${row.warehouse.name}: alertas reavaliados.`);
      queryClient.invalidateQueries({ queryKey: ['product', productId] });
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
    onError: (error) => toast.error('Não foi possível salvar', error.message),
  });

  const dirty = value !== (row.minQuantity === null ? '' : String(row.minQuantity));
  const status =
    row.effectiveMin > 0 && row.quantity === 0 ? (
      <Badge tone="red">Sem estoque</Badge>
    ) : row.effectiveMin > 0 && row.quantity <= row.effectiveMin ? (
      <Badge tone="yellow">Baixo</Badge>
    ) : (
      <Badge tone="green">OK</Badge>
    );

  return (
    <tr>
      <Td className="font-medium text-slate-900">{row.warehouse.name}</Td>
      <Td className="text-right font-medium tabular-nums">{formatNumber(row.quantity)}</Td>
      <Td className="text-right">
        {editable ? (
          <form
            className="flex items-center justify-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <DecimalInput
              value={value}
              placeholder={`padrão: ${row.effectiveMin}`}
              onChange={(value) => setValue(value)}
              className="h-8 w-36 text-right"
              aria-label={`Mínimo em ${row.warehouse.name}`}
            />
            {dirty && (
              <Button size="sm" type="submit" loading={save.isPending}>
                Salvar
              </Button>
            )}
          </form>
        ) : (
          <span className="tabular-nums">{formatNumber(row.effectiveMin)}</span>
        )}
      </Td>
      <Td>{status}</Td>
    </tr>
  );
}
