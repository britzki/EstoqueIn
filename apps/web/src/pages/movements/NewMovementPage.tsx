import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  PackageOpen,
  SlidersHorizontal,
  Workflow,
} from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { invalidateStock, useActiveWarehouses, useSuppliers } from '../../lib/hooks';
import { useToast } from '../../lib/toast';
import { ALERT_LABEL, formatMoney, formatNumber, parseMoneyInput, roundQty } from '../../lib/format';
import type { FractionResult, MovementResult, Product, ProductDetail, TransferResult } from '../../lib/types';
import { ProductPicker } from '../../components/ProductPicker';
import {
  Button,
  Card,
  CardHeader,
  DecimalInput,
  EmptyState,
  ErrorMessage,
  Field,
  Input,
  PageHeader,
  Select,
  Tabs,
  Textarea,
} from '../../components/ui';
import { FlowResult } from './FlowResult';

type Kind = 'entry' | 'exit' | 'transfer' | 'adjustment' | 'fraction';
const KINDS: Kind[] = ['entry', 'exit', 'transfer', 'fraction', 'adjustment'];

const EXIT_REASONS = ['Venda', 'Consumo interno', 'Avaria', 'Vencimento', 'Devolução ao fornecedor'];

interface LastResult {
  kind: Kind;
  productName: string;
  flows: Array<{ label?: string; result: MovementResult; warehouseName: string; min: number; unit: string }>;
}

const initialForm = {
  warehouseId: '',
  toWarehouseId: '',
  quantity: '',
  newQuantity: '',
  unitCost: '',
  supplierId: '',
  documentRef: '',
  reason: '',
  bulkProductId: '',
  yieldPerPack: '',
};

const SUBMIT_LABEL: Record<Kind, string> = {
  entry: 'Registrar entrada',
  exit: 'Registrar saída',
  transfer: 'Registrar transferência',
  adjustment: 'Registrar ajuste',
  fraction: 'Abrir para granel',
};

const useProductDetail = (id: string | undefined) =>
  useQuery({
    queryKey: ['product', id],
    queryFn: () => api.get<ProductDetail>(`/products/${id}`),
    enabled: Boolean(id),
  });

export function NewMovementPage() {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const { data: warehouses = [] } = useActiveWarehouses();
  const { data: suppliers = [] } = useSuppliers();

  // Aba pedida no link (?type=...), se existir e o perfil puder usar; senão, Entrada.
  const [kind, setKind] = useState<Kind>(() => {
    const requested = KINDS.find((value) => value === params.get('type'));
    return requested && (requested !== 'adjustment' || can('stock:adjust')) ? requested : 'entry';
  });
  const [product, setProduct] = useState<Product | null>(null);
  const [form, setForm] = useState({ ...initialForm, warehouseId: params.get('warehouseId') ?? '' });
  const [last, setLast] = useState<LastResult | null>(null);
  const [pickerKey, setPickerKey] = useState(0);
  const set = (field: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [field]: value }));

  // Pré-seleciona o produto vindo de links como "Movimentar", "Repor" ou "Abrir pacote".
  const { data: initialProduct } = useProductDetail(params.get('productId') ?? undefined);
  const [appliedInitial, setAppliedInitial] = useState(false);
  if (initialProduct && !appliedInitial) {
    setAppliedInitial(true);
    setProduct(initialProduct);
  }

  // Sem escolha, o primeiro estoque ativo.
  const warehouseId = form.warehouseId || warehouses[0]?.id || '';

  const detail = useProductDetail(product?.id);
  const stockIn = (warehouseId: string) => detail.data?.stock.find((s) => s.warehouse.id === warehouseId);
  const warehouseName = (id: string) => warehouses.find((w) => w.id === id)?.name ?? '';

  // Fracionamento: o usuário pode escolher tanto o pacote quanto o granel; daqui saem os dois lados.
  const selectedIsBulk = Boolean(detail.data?.sourceProduct);
  const bulkOptions = detail.data?.bulkProducts.filter((bulk) => bulk.active) ?? [];
  // O granel escolhido só vale se for deste produto (o usuário pode ter trocado de produto depois).
  const chosenBulk = bulkOptions.find((option) => option.id === form.bulkProductId) ?? bulkOptions[0];
  const bulkId = selectedIsBulk ? detail.data?.id : chosenBulk?.id;
  const packId = selectedIsBulk ? detail.data?.sourceProduct?.id : bulkId ? detail.data?.id : undefined;
  const packDetail = useProductDetail(kind === 'fraction' ? packId : undefined);
  const bulkDetail = useProductDetail(kind === 'fraction' ? bulkId : undefined);
  const pack = packDetail.data;
  const bulk = bulkDetail.data;
  const packStock = pack?.stock.find((s) => s.warehouse.id === warehouseId);
  const bulkStock = bulk?.stock.find((s) => s.warehouse.id === warehouseId);
  const yieldPerPack = Number(form.yieldPerPack.replace(',', '.')) || bulk?.sourceYield || 0;
  const packs = Number(form.quantity);
  const bulkQuantity = roundQty(packs * yieldPerPack);

  // Cada aba envia para o seu endereço; o resultado volta no mesmo formato para a tela de confirmação.
  const submitFraction = async (): Promise<LastResult> => {
    const result = await api.post<FractionResult>('/stock/fractions', {
      bulkProductId: bulk!.id,
      warehouseId,
      packs: Number(form.quantity),
      yieldPerPack,
    });
    const name = warehouseName(warehouseId);
    return {
      kind,
      productName: `${result.pack.name} → ${formatNumber(result.bulkQuantity)} ${result.bulk.unit} a granel`,
      flows: [
        {
          label: 'Pacote',
          result: result.from,
          warehouseName: name,
          min: packStock?.effectiveMin ?? 0,
          unit: result.pack.unit,
        },
        {
          label: 'Granel',
          result: result.to,
          warehouseName: name,
          min: bulkStock?.effectiveMin ?? 0,
          unit: result.bulk.unit,
        },
      ],
    };
  };

  /** Saldo e mínimo de um estoque, para a confirmação e os avisos de estoque baixo. */
  const flow = (result: MovementResult, inWarehouse: string) => ({
    result,
    warehouseName: warehouseName(inWarehouse),
    min: stockIn(inWarehouse)?.effectiveMin ?? 0,
    unit: product!.unit,
  });

  const submitTransfer = async (): Promise<LastResult> => {
    const result = await api.post<TransferResult>('/stock/transfers', {
      productId: product!.id,
      fromWarehouseId: warehouseId,
      toWarehouseId: form.toWarehouseId,
      quantity: Number(form.quantity),
      reason: form.reason,
    });
    return {
      kind,
      productName: product!.name,
      flows: [
        { label: 'Origem', ...flow(result.from, warehouseId) },
        { label: 'Destino', ...flow(result.to, form.toWarehouseId) },
      ],
    };
  };

  /** Entrada, saída e ajuste: uma movimentação num estoque só. */
  const submitSingle = async (): Promise<LastResult> => {
    const productId = product!.id;
    const quantity = Number(form.quantity);
    let result: MovementResult;
    switch (kind) {
      case 'entry':
        result = await api.post<MovementResult>('/stock/entries', {
          productId,
          warehouseId,
          quantity,
          unitCostCents: parseMoneyInput(form.unitCost),
          supplierId: form.supplierId,
          documentRef: form.documentRef,
          reason: form.reason,
        });
        break;
      case 'exit':
        result = await api.post<MovementResult>('/stock/exits', {
          productId,
          warehouseId,
          quantity,
          documentRef: form.documentRef,
          reason: form.reason || 'Venda',
        });
        break;
      default:
        result = await api.post<MovementResult>('/stock/adjustments', {
          productId,
          warehouseId,
          newQuantity: Number(form.newQuantity),
          reason: form.reason,
        });
    }
    return { kind, productName: product!.name, flows: [flow(result, warehouseId)] };
  };

  const mutation = useMutation({
    mutationFn: () =>
      kind === 'fraction' ? submitFraction() : kind === 'transfer' ? submitTransfer() : submitSingle(),
    onSuccess: (result) => {
      setLast(result);
      toast.success('Movimentação registrada', result.productName);
      for (const { result: r, warehouseName: name, label } of result.flows) {
        if (r.alert.kind === 'opened' || r.alert.kind === 'escalated') {
          toast.warning(
            `Alerta: ${ALERT_LABEL[r.alert.alert.type]}`,
            `${label ? `${label} em` : result.productName + ' em'} ${name} — saldo ${formatNumber(r.balance)}`,
          );
        }
      }
      invalidateStock(queryClient);
      // Pronto para o próximo bipe.
      setProduct(null);
      setForm((current) => ({
        ...current,
        quantity: '',
        newQuantity: '',
        unitCost: '',
        documentRef: '',
        bulkProductId: '',
        yieldPerPack: '',
      }));
      setPickerKey((k) => k + 1);
    },
  });

  const errors = mutation.error instanceof ApiError ? mutation.error.fieldErrors : {};

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!product) return toast.error('Selecione um produto');
    mutation.mutate();
  };

  const tabs = [
    { value: 'entry' as const, label: 'Entrada', icon: <ArrowDownToLine /> },
    { value: 'exit' as const, label: 'Saída', icon: <ArrowUpFromLine /> },
    { value: 'transfer' as const, label: 'Transferência', icon: <ArrowLeftRight /> },
    { value: 'fraction' as const, label: 'Abrir para granel', icon: <PackageOpen /> },
    ...(can('stock:adjust') ? [{ value: 'adjustment' as const, label: 'Ajuste', icon: <SlidersHorizontal /> }] : []),
  ];

  const origin = stockIn(warehouseId);
  const fractionReady = kind !== 'fraction' || Boolean(pack && bulk);
  const noBulkLink = kind === 'fraction' && product && detail.data && !selectedIsBulk && bulkOptions.length === 0;

  return (
    <>
      <PageHeader
        title="Nova movimentação"
        description="Registre entradas, saídas, transferências e ajustes. Funciona com leitor de código de barras."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <div className="border-b border-slate-100 p-4">
            <Tabs
              value={kind}
              onChange={(value) => {
                setKind(value);
                // O motivo de uma aba (ex.: o do ajuste) não vale para a outra.
                setForm((current) => ({ ...current, reason: '' }));
                mutation.reset();
              }}
              options={tabs}
            />
          </div>

          <form onSubmit={onSubmit} className="space-y-4 p-5">
            {mutation.error && <ErrorMessage error={mutation.error} />}

            {kind === 'entry' && (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                Chegou com nota fiscal?{' '}
                <Link to="/movements/nfe" className="font-medium text-brand-700 hover:underline">
                  Importe o XML da NF-e
                </Link>{' '}
                e dê entrada em todos os itens de uma vez.
              </p>
            )}

            {kind === 'fraction' && (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                Abra pacotes fechados (ex.: saco de 15 kg) para vender por peso. O pacote sai do estoque e os quilos
                entram no produto a granel, com o custo proporcional.
              </p>
            )}

            <Field label={kind === 'fraction' ? 'Produto (o pacote ou o granel)' : 'Produto'} required>
              {(id) => <ProductPicker key={pickerKey} id={id} value={product} onChange={setProduct} autoFocus />}
            </Field>

            {product && detail.data && kind !== 'fraction' && (
              <div className="flex flex-wrap gap-2">
                {detail.data.stock.map((s) => (
                  <span key={s.warehouse.id} className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600">
                    {s.warehouse.name}:{' '}
                    <strong className="text-slate-900 tabular-nums">{formatNumber(s.quantity)}</strong> {product.unit}
                  </span>
                ))}
              </div>
            )}

            {noBulkLink && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {product.name} ainda não tem versão a granel.{' '}
                <Link to={`/products/${product.id}`} className="font-medium underline">
                  Abra o cadastro do produto
                </Link>{' '}
                e use “Criar versão a granel”.
              </div>
            )}

            {kind === 'fraction' && pack && bulk && (
              <div className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 p-3 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-xs text-slate-500">Pacote</p>
                  <p className="font-medium text-slate-900">{pack.name}</p>
                  <p className="text-slate-600">
                    Em estoque: <strong className="tabular-nums">{formatNumber(packStock?.quantity ?? 0)}</strong>{' '}
                    {pack.unit}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Granel</p>
                  <p className="font-medium text-slate-900">{bulk.name}</p>
                  <p className="text-slate-600">
                    Em estoque: <strong className="tabular-nums">{formatNumber(bulkStock?.quantity ?? 0)}</strong>{' '}
                    {bulk.unit}
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={kind === 'transfer' ? 'Estoque de origem' : 'Estoque'} required>
                {(id) => (
                  <Select id={id} value={warehouseId} onChange={(e) => set('warehouseId')(e.target.value)} required>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              {kind === 'fraction' && !selectedIsBulk && bulkOptions.length > 1 && (
                <Field label="Qual granel abastecer">
                  {(id) => (
                    <Select id={id} value={bulkId ?? ''} onChange={(e) => set('bulkProductId')(e.target.value)}>
                      {bulkOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}

              {kind === 'transfer' && (
                <Field label="Estoque de destino" required>
                  {(id) => (
                    <Select
                      id={id}
                      value={form.toWarehouseId}
                      onChange={(e) => set('toWarehouseId')(e.target.value)}
                      required
                    >
                      <option value="">Selecione</option>
                      {warehouses
                        .filter((w) => w.id !== warehouseId)
                        .map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                    </Select>
                  )}
                </Field>
              )}

              {kind === 'fraction' ? (
                <>
                  <Field
                    label={`Quantos ${pack?.unit ?? 'pacotes'} abrir`}
                    required
                    error={errors.packs?.[0]}
                    hint={packStock ? `Disponível: ${formatNumber(packStock.quantity)}` : undefined}
                  >
                    {(id) => (
                      <DecimalInput
                        id={id}
                        value={form.quantity}
                        onChange={(value) => set('quantity')(value)}
                        required
                      />
                    )}
                  </Field>
                  <Field
                    label={`Rendimento de cada ${pack?.unit ?? 'pacote'} (${bulk?.unit ?? 'KG'})`}
                    error={errors.yieldPerPack?.[0]}
                    hint="Altere só se este lote veio com peso diferente do padrão."
                  >
                    {(id) => (
                      <DecimalInput
                        id={id}
                        placeholder={bulk?.sourceYield ? String(bulk.sourceYield) : ''}
                        value={form.yieldPerPack}
                        onChange={(value) => set('yieldPerPack')(value)}
                      />
                    )}
                  </Field>
                </>
              ) : kind === 'adjustment' ? (
                <Field
                  label="Saldo correto"
                  required
                  error={errors.newQuantity?.[0]}
                  hint={origin ? `Saldo atual no sistema: ${formatNumber(origin.quantity)}` : undefined}
                >
                  {(id) => (
                    <DecimalInput
                      id={id}
                      value={form.newQuantity}
                      onChange={(value) => set('newQuantity')(value)}
                      required
                    />
                  )}
                </Field>
              ) : (
                <Field
                  label={product ? `Quantidade (${product.unit})` : 'Quantidade'}
                  required
                  error={errors.quantity?.[0]}
                  hint={kind !== 'entry' && origin ? `Disponível: ${formatNumber(origin.quantity)}` : undefined}
                >
                  {(id) => (
                    <DecimalInput id={id} value={form.quantity} onChange={(value) => set('quantity')(value)} required />
                  )}
                </Field>
              )}

              {kind === 'entry' && (
                <>
                  <Field
                    label={product ? `Custo por ${product.unit} (R$)` : 'Custo unitário (R$)'}
                    hint="Atualiza o custo médio ponderado"
                  >
                    {(id) => (
                      <Input
                        id={id}
                        inputMode="decimal"
                        placeholder="0,00"
                        value={form.unitCost}
                        onChange={(e) => set('unitCost')(e.target.value)}
                      />
                    )}
                  </Field>
                  <Field label="Fornecedor">
                    {(id) => (
                      <Select id={id} value={form.supplierId} onChange={(e) => set('supplierId')(e.target.value)}>
                        <option value="">—</option>
                        {suppliers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </>
              )}

              {(kind === 'entry' || kind === 'exit') && (
                <Field label={kind === 'entry' ? 'Nota fiscal / documento' : 'Documento (cupom, pedido)'}>
                  {(id) => (
                    <Input
                      id={id}
                      value={form.documentRef}
                      onChange={(e) => set('documentRef')(e.target.value)}
                      placeholder={kind === 'entry' ? 'NF 12345' : ''}
                    />
                  )}
                </Field>
              )}

              {kind === 'exit' && (
                <Field label="Motivo">
                  {(id) => (
                    <Select id={id} value={form.reason || 'Venda'} onChange={(e) => set('reason')(e.target.value)}>
                      {EXIT_REASONS.map((reason) => (
                        <option key={reason}>{reason}</option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
            </div>

            {kind === 'fraction' && pack && bulk && packs > 0 && yieldPerPack > 0 && (
              <p className="text-sm text-slate-600">
                Saem{' '}
                <strong className="text-slate-900">
                  {formatNumber(packs)} {pack.unit}
                </strong>{' '}
                e entram{' '}
                <strong className="text-slate-900">
                  {formatNumber(bulkQuantity)} {bulk.unit}
                </strong>{' '}
                a granel
                {/* Custo só aparece para quem pode ver os números do negócio (para os outros vem vazio). */}
                {pack.costCents !== null && (
                  <>
                    , a{' '}
                    <strong className="text-slate-900">{formatMoney(Math.round(pack.costCents / yieldPerPack))}</strong>{' '}
                    por {bulk.unit}
                  </>
                )}
                .
              </p>
            )}

            {(kind === 'adjustment' || kind === 'transfer' || kind === 'entry') && (
              <Field
                label={kind === 'adjustment' ? 'Motivo do ajuste' : 'Observação'}
                required={kind === 'adjustment'}
                error={errors.reason?.[0]}
              >
                {(id) => (
                  <Textarea
                    id={id}
                    rows={2}
                    value={form.reason}
                    onChange={(e) => set('reason')(e.target.value)}
                    required={kind === 'adjustment'}
                  />
                )}
              </Field>
            )}

            <div className="flex justify-end pt-2">
              <Button type="submit" loading={mutation.isPending} disabled={!product || !fractionReady}>
                {SUBMIT_LABEL[kind]}
              </Button>
            </div>
          </form>
        </Card>

        <Card className="h-fit lg:col-span-2">
          <CardHeader
            title="O que aconteceu"
            description={last ? last.productName : 'O resultado da última operação aparece aqui.'}
          />
          {last ? (
            <div className="space-y-6 p-5">
              {last.flows.map(({ label, ...flow }, index) => (
                <div key={index}>
                  {label && <p className="mb-3 text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>}
                  <FlowResult {...flow} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Workflow />}
              title="Nenhuma operação ainda"
              description="Produto chegou → entrada registrada → saldo atualizado → mínimo verificado → alerta."
            />
          )}
        </Card>
      </div>
    </>
  );
}
