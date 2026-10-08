import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Banknote,
  CircleCheckBig,
  CreditCard,
  NotebookPen,
  Printer,
  QrCode,
  ScanBarcode,
  ShoppingCart,
  Star,
  Trash2,
  Gift,
  Truck,
} from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useCurrentCash, useDebounced, useSaleWarehouse, useStoreSettings } from '../../lib/hooks';
import { useToast } from '../../lib/toast';
import { centsToInput, formatMoney, formatNumber, parseMoneyInput } from '../../lib/format';
import type {
  LoyaltyProgress,
  Paginated,
  PaymentMethod,
  Product,
  Promotion,
  ResolvedCode,
  SaleDetail,
  SaleProduct,
} from '../../lib/types';
import { priceLine, promotionLabel, useActivePromotions } from '../../lib/pricing';
import { useAuth } from '../../lib/auth';
import { useReceiptPrinter } from '../../components/Receipt';
import { CustomerPicker, type CustomerChoice } from '../../components/CustomerPicker';
import {
  Badge,
  Button,
  Card,
  DecimalInput,
  EmptyState,
  ErrorMessage,
  Input,
  PageHeader,
  Select,
} from '../../components/ui';
import { OpenCashForm } from '../cash/CashPage';
import { useDeliverySlipPrinter } from '../../components/DeliverySlip';
import { deliveryFee, formatDue } from '../../lib/delivery';
import {
  DeliveryOptions,
  deliveryPayload,
  deliveryReady,
  newDeliveryChoice,
  type DeliveryChoice,
} from './DeliveryOptions';

interface CartLine {
  key: number;
  product: SaleProduct;
  /** Texto do campo, para permitir digitação parcial ("0,", "1."). */
  quantity: string;
  /** Brinde do cartão fidelidade (sai a R$ 0,00). */
  giftRuleId?: string;
}

const METHODS: Array<{ value: PaymentMethod; label: string; icon: typeof Banknote }> = [
  { value: 'CASH', label: 'Dinheiro', icon: Banknote },
  { value: 'PIX', label: 'Pix', icon: QrCode },
  { value: 'DEBIT', label: 'Débito', icon: CreditCard },
  { value: 'CREDIT', label: 'Crédito', icon: CreditCard },
  { value: 'ACCOUNT', label: 'Fiado', icon: NotebookPen },
];

const toNumber = (text: string) => Number(text.replace(',', '.'));
/** Preço da linha com a promoção vigente (a conta final é do servidor). Brinde sai a zero. */
const linePrice = (line: CartLine, promotions?: Map<string, Promotion>) =>
  line.giftRuleId
    ? { unitPriceCents: 0, totalCents: 0, savingsCents: 0 }
    : priceLine(line.product.priceCents, toNumber(line.quantity) || 0, promotions?.get(line.product.id));
let nextKey = 1;

export function NewSalePage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { warehouses, warehouseId: activeWarehouse, setWarehouseId } = useSaleWarehouse();
  const { data: settings } = useStoreSettings();
  const cash = useCurrentCash(activeWarehouse);
  const cashClosed = Boolean(settings?.requireCashSession) && cash.isSuccess && cash.data === null;
  const receipt = useReceiptPrinter(settings);
  const deliverySlip = useDeliverySlipPrinter(settings);
  const scanRef = useRef<HTMLInputElement>(null);
  const quantityRefs = useRef(new Map<number, HTMLInputElement>());

  const [cart, setCart] = useState<CartLine[]>([]);
  const [code, setCode] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);
  const [discount, setDiscount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [received, setReceived] = useState('');
  const [split, setSplit] = useState(false);
  const [secondMethod, setSecondMethod] = useState<PaymentMethod>('PIX');
  const [firstAmount, setFirstAmount] = useState('');
  const [customer, setCustomer] = useState<CustomerChoice>({ customer: null, name: '' });
  const [lastSale, setLastSale] = useState<SaleDetail | null>(null);
  const [focusLine, setFocusLine] = useState<number | null>(null);
  /** null = venda no balcão. */
  const [delivery, setDelivery] = useState<DeliveryChoice | null>(null);

  // Busca por nome enquanto digita (códigos são resolvidos no Enter).
  const search = useDebounced(code.trim(), 250);
  const isCode = /^\d{6,}$/.test(search);
  const { data: matches = [] } = useQuery({
    queryKey: ['products', 'sale-search', search],
    queryFn: () => api.get<Paginated<Product>>('/products', { search, active: true, pageSize: 6 }),
    enabled: search.length >= 2 && !isCode,
    select: (page) => page.data,
  });

  const { can } = useAuth();
  const { data: quickProducts = [] } = useQuery({
    queryKey: ['products', 'quick', activeWarehouse],
    queryFn: () =>
      api.get<Array<SaleProduct & { quickSale: boolean }>>('/sales/quick-products', { warehouseId: activeWarehouse }),
    enabled: Boolean(activeWarehouse) && can('sales:create'),
  });

  useEffect(() => {
    if (focusLine === null) return;
    const input = quantityRefs.current.get(focusLine);
    input?.focus();
    input?.select();
    setFocusLine(null);
  }, [focusLine, cart]);

  const { data: promotions } = useActivePromotions();
  const lineTotal = (line: CartLine) => linePrice(line, promotions).totalCents;

  // Cartão fidelidade do cliente escolhido.
  const { data: loyalty = [] } = useQuery({
    queryKey: ['customers', 'loyalty', customer.customer?.id],
    queryFn: () => api.get<LoyaltyProgress[]>(`/customers/${customer.customer!.id}/loyalty`),
    enabled: Boolean(customer.customer),
  });
  const giftsInCart = (ruleId: string) =>
    cart.filter((line) => line.giftRuleId === ruleId).reduce((sum, line) => sum + (toNumber(line.quantity) || 0), 0);
  const addGift = (card: LoyaltyProgress) => {
    setLastSale(null);
    setCart((current) => [
      ...current,
      {
        key: nextKey++,
        product: { ...card.rule.rewardProduct, priceCents: card.rule.rewardProduct.priceCents },
        quantity: String(card.rule.rewardQuantity),
        giftRuleId: card.rule.id,
      },
    ]);
  };

  const addToCart = (product: SaleProduct, quantity: number | null) => {
    setLastSale(null);
    const key = nextKey++;
    setCart((current) => {
      // Produto por unidade bipado de novo soma na mesma linha; pesados ficam em linhas separadas.
      const existing = !product.fractional
        ? current.find((line) => line.product.id === product.id && !line.giftRuleId)
        : undefined;
      if (existing && quantity !== null) {
        return current.map((line) =>
          line === existing ? { ...line, quantity: String(toNumber(line.quantity) + quantity) } : line,
        );
      }
      return [...current, { key, product, quantity: quantity === null ? '' : String(quantity) }];
    });
    // Produto por peso sem etiqueta: o cursor vai para o campo de quantidade.
    if (quantity === null) setFocusLine(key);
    setCode('');
    setScanError(null);
    if (quantity !== null) scanRef.current?.focus();
  };

  const resolve = async () => {
    const value = code.trim();
    if (!value) return;
    try {
      const result = await api.get<ResolvedCode>('/sales/resolve', { code: value, warehouseId: activeWarehouse });
      addToCart(result.product, result.quantity);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404 && matches.length === 1) {
        const [only] = matches;
        return addToCart(only, only.fractional ? null : 1);
      }
      setScanError((error as Error).message);
    }
  };

  const onScanKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      resolve();
    }
  };

  const subtotal = cart.reduce((sum, line) => sum + lineTotal(line), 0);
  const discountCents = Math.min(parseMoneyInput(discount) ?? 0, subtotal);
  const itemsTotal = subtotal - discountCents;
  const feeCents = delivery ? deliveryFee(itemsTotal, settings, delivery.waiveFee) : 0;
  const total = itemsTotal + feeCents;
  const collectCash = Boolean(delivery?.collectOnDelivery) && method === 'CASH' && !split;
  const receivedCents = parseMoneyInput(received) ?? 0;
  const firstCents = Math.min(parseMoneyInput(firstAmount) ?? 0, total);
  const change = !split && method === 'CASH' && receivedCents > total ? receivedCents - total : 0;
  // A segunda forma nunca repete a primeira.
  const otherMethod = secondMethod === method ? METHODS.find((m) => m.value !== method)!.value : secondMethod;

  const invalidLine = cart.find((line) => {
    const quantity = toNumber(line.quantity);
    return (
      !(quantity > 0) ||
      (!line.product.fractional && !Number.isInteger(quantity)) ||
      (!line.giftRuleId && line.product.priceCents <= 0)
    );
  });
  const cashShort = !split && method === 'CASH' && received !== '' && receivedCents < total;
  const splitInvalid = split && (firstCents <= 0 || firstCents >= total);

  // Fiado: quanto vai para a conta do cliente nesta venda.
  const accountCents = split
    ? (method === 'ACCOUNT' ? firstCents : 0) + (otherMethod === 'ACCOUNT' ? total - firstCents : 0)
    : method === 'ACCOUNT'
      ? total
      : 0;
  const usesAccount = method === 'ACCOUNT' || (split && otherMethod === 'ACCOUNT');
  const { data: customerAccount } = useQuery({
    queryKey: ['customers', 'detail', customer.customer?.id],
    queryFn: () =>
      api.get<{ balanceCents: number; creditLimitCents: number | null }>(`/customers/${customer.customer!.id}`),
    enabled: usesAccount && Boolean(customer.customer),
  });
  const accountNeedsCustomer = usesAccount && !customer.customer;
  const overLimit =
    customerAccount?.creditLimitCents !== null &&
    customerAccount !== undefined &&
    customerAccount.balanceCents + accountCents > (customerAccount.creditLimitCents ?? 0);

  // Venda só com brinde do cartão fidelidade: total zero, sem pagamento.
  const onlyGifts = cart.length > 0 && cart.every((line) => line.giftRuleId);
  const canFinish =
    cart.length > 0 &&
    !invalidLine &&
    (total > 0 || onlyGifts) &&
    !cashShort &&
    !splitInvalid &&
    !cashClosed &&
    !accountNeedsCustomer &&
    !overLimit &&
    (!delivery || (Boolean(customer.customer) && deliveryReady(delivery)));

  const finish = useMutation({
    mutationFn: () =>
      api.post<SaleDetail>('/sales', {
        warehouseId: activeWarehouse,
        items: cart.map((line) => ({
          productId: line.product.id,
          quantity: toNumber(line.quantity),
          loyaltyRuleId: line.giftRuleId,
        })),
        discountCents,
        payments:
          total === 0
            ? []
            : split
              ? [
                  { method, amountCents: firstCents },
                  { method: otherMethod, amountCents: total - firstCents },
                ]
              : [{ method, amountCents: method === 'CASH' && receivedCents > total ? receivedCents : total }],
        customerId: customer.customer?.id,
        customerName: customer.customer ? undefined : customer.name,
        delivery: delivery ? deliveryPayload(delivery) : undefined,
      }),
    onSuccess: (sale) => {
      setLastSale(sale);
      setCart([]);
      setDiscount('');
      setReceived('');
      setFirstAmount('');
      setSplit(false);
      setCustomer({ customer: null, name: '' });
      setDelivery(null);
      if (sale.alertsOpened)
        toast.warning('Estoque baixo', `${sale.alertsOpened} produto(s) desta venda atingiram o mínimo.`);
      // Venda para entrega: a guia vai junto com o pacote (tem os itens, o endereço e o que cobrar).
      if (settings?.autoPrint) {
        if (sale.delivery) void deliverySlip.print(sale.delivery.id);
        else receipt.print(sale);
      }
      for (const key of [
        'deliveries',
        'products',
        'product',
        'alerts',
        'dashboard',
        'movements',
        'sales',
        'warehouses',
        'cash',
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      scanRef.current?.focus();
    },
  });

  // Atalhos do caixa: F2 finaliza, F4 volta para o campo de leitura.
  const finishRef = useRef<() => void>(() => undefined);
  finishRef.current = () => {
    if (canFinish && !finish.isPending) finish.mutate();
  };
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'F2') {
        event.preventDefault();
        finishRef.current();
      } else if (event.key === 'F4') {
        event.preventDefault();
        scanRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const setQuantity = (key: number, quantity: string) =>
    setCart((current) => current.map((line) => (line.key === key ? { ...line, quantity } : line)));

  return (
    <>
      {receipt.portal}
      {deliverySlip.portal}
      <PageHeader
        title="Nova venda"
        description="Bipe o produto ou a etiqueta da balança. F2 finaliza a venda, F4 volta para a leitura."
        actions={
          warehouses.length > 1 && (
            <Select
              value={activeWarehouse}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="w-auto"
              aria-label="Estoque da venda"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  Vendendo de: {w.name}
                </option>
              ))}
            </Select>
          )
        }
      />

      {cashClosed && (
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
          <div>
            <p className="font-semibold text-amber-900">O caixa está fechado</p>
            <p className="text-sm text-amber-800">Abra o caixa com o troco do dia para registrar vendas.</p>
          </div>
          <OpenCashForm warehouseId={activeWarehouse} compact />
        </div>
      )}

      {lastSale && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4">
          <div className="flex items-center gap-3">
            <CircleCheckBig className="size-8 text-emerald-600" />
            <div>
              <p className="font-semibold text-slate-900">
                Venda nº {lastSale.number} registrada · {formatMoney(lastSale.totalCents)}
              </p>
              {lastSale.delivery ? (
                <p className="text-sm text-emerald-900">
                  Entrega nº {lastSale.delivery.number} ·{' '}
                  {lastSale.delivery.scheduled ? 'agendada para' : 'entregar até'} {formatDue(lastSale.delivery.dueAt)}
                  {lastSale.delivery.collectOnDelivery && lastSale.changeCents > 0 && (
                    <> · levar troco de {formatMoney(lastSale.changeCents)}</>
                  )}
                </p>
              ) : (
                lastSale.changeCents > 0 && (
                  <p className="text-lg font-bold text-emerald-800">Troco: {formatMoney(lastSale.changeCents)}</p>
                )
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {lastSale.delivery && (
              <Button
                variant="secondary"
                icon={<Truck className="size-4" />}
                onClick={() => void deliverySlip.print(lastSale.delivery!.id)}
              >
                Imprimir guia de entrega
              </Button>
            )}
            <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => receipt.print(lastSale)}>
              Imprimir notinha
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="relative border-b border-slate-100 p-4">
            <div className="relative">
              <ScanBarcode className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-slate-400" />
              <input
                ref={scanRef}
                autoFocus
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setScanError(null);
                }}
                onKeyDown={onScanKey}
                placeholder="Código de barras, etiqueta da balança ou nome do produto"
                autoComplete="off"
                aria-label="Leitura do produto"
                className="block h-12 w-full rounded-lg border border-slate-300 bg-white pr-3 pl-11 text-base shadow-sm placeholder:text-slate-400 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20 focus:outline-none"
              />
            </div>
            {search.length >= 2 && !isCode && matches.length > 0 && code.trim() !== '' && (
              <ul className="absolute inset-x-4 z-20 mt-1 max-h-72 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                {matches.map((product) => (
                  <li key={product.id}>
                    <button
                      type="button"
                      onClick={() => addToCart(product, product.fractional ? null : 1)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-100"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-900">{product.name}</span>
                        <span className="block text-xs text-slate-500">{product.sku}</span>
                      </span>
                      <span className="text-sm whitespace-nowrap text-slate-700 tabular-nums">
                        {formatMoney(product.priceCents)} / {product.unit}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {scanError && <p className="mt-2 text-sm text-red-600">{scanError}</p>}
            {quickProducts.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2" aria-label="Botões rápidos">
                {quickProducts.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => addToCart(product, product.fractional ? null : 1)}
                    title={product.quickSale ? 'Marcado como botão rápido' : 'Entre os mais vendidos'}
                    className="inline-flex max-w-[14rem] items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-sm hover:border-brand-300 hover:bg-brand-50"
                  >
                    {product.quickSale && <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" />}
                    <span className="truncate font-medium text-slate-800">{product.name}</span>
                    <span className="shrink-0 text-xs text-slate-500 tabular-nums">
                      {formatMoney(product.priceCents)}
                      {product.fractional && `/${product.unit.toLowerCase()}`}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {cart.length === 0 ? (
            <EmptyState
              icon={<ShoppingCart />}
              title="Nenhum item na venda"
              description="Os produtos bipados aparecem aqui."
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {cart.map((line) => {
                const quantity = toNumber(line.quantity);
                const overStock = line.product.stock !== undefined && quantity > line.product.stock;
                const promotion = line.giftRuleId ? undefined : promotions?.get(line.product.id);
                const price = linePrice(line, promotions);
                return (
                  <li key={line.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-900">
                        {line.product.name}
                        {line.giftRuleId && <Badge tone="green">Brinde fidelidade</Badge>}
                        {line.product.isKit && <Badge tone="violet">Kit</Badge>}
                      </p>
                      <p className="text-xs text-slate-500">
                        {line.giftRuleId ? (
                          'Sai a R$ 0,00 pelo cartão fidelidade'
                        ) : (
                          <>
                            {promotion?.type === 'PRICE' && price.savingsCents > 0 ? (
                              <>
                                <s>{formatMoney(line.product.priceCents)}</s> {formatMoney(price.unitPriceCents)}
                              </>
                            ) : (
                              formatMoney(line.product.priceCents)
                            )}{' '}
                            / {line.product.unit}
                          </>
                        )}
                        {promotion && (
                          <span className="ml-2 font-medium text-emerald-700">
                            Promoção: {promotionLabel(promotion)}
                            {price.savingsCents > 0 && ` (economia de ${formatMoney(price.savingsCents)})`}
                          </span>
                        )}
                        {!line.giftRuleId && line.product.priceCents <= 0 && (
                          <span className="ml-2 text-red-600">sem preço de venda</span>
                        )}
                        {overStock && (
                          <span
                            className={cn('ml-2', settings?.allowNegativeStock ? 'text-amber-700' : 'text-red-600')}
                          >
                            só há {formatNumber(line.product.stock!)} {line.product.unit} em estoque
                            {settings?.allowNegativeStock && ' (o saldo fica negativo e gera alerta para conferir)'}
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <DecimalInput
                        ref={(element) => {
                          if (element) quantityRefs.current.set(line.key, element);
                          else quantityRefs.current.delete(line.key);
                        }}
                        value={line.quantity}
                        onChange={(value) => setQuantity(line.key, value)}
                        onKeyDown={(e) => e.key === 'Enter' && scanRef.current?.focus()}
                        className="h-9 w-24 text-right"
                        aria-label={`Quantidade de ${line.product.name}`}
                      />
                      <span className="w-8 text-xs text-slate-500">{line.product.unit}</span>
                    </div>
                    <p className="w-24 text-right font-semibold text-slate-900 tabular-nums">
                      {formatMoney(lineTotal(line))}
                    </p>
                    <button
                      type="button"
                      onClick={() => setCart((current) => current.filter((item) => item.key !== line.key))}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      aria-label={`Remover ${line.product.name}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="h-fit p-5">
          {finish.error && (
            <div className="mb-4">
              <ErrorMessage error={finish.error} />
            </div>
          )}
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between text-slate-600">
              <dt>
                Subtotal ({cart.length} {cart.length === 1 ? 'item' : 'itens'})
              </dt>
              <dd className="tabular-nums">{formatMoney(subtotal)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 text-slate-600">
              <dt>
                <label htmlFor="sale-discount">Desconto (R$)</label>
              </dt>
              <dd>
                <Input
                  id="sale-discount"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  inputMode="decimal"
                  placeholder="0,00"
                  className="h-8 w-28 text-right"
                />
              </dd>
            </div>
            {delivery && (
              <div className="flex justify-between text-slate-600">
                <dt>Taxa de entrega</dt>
                <dd className="tabular-nums">{feeCents > 0 ? formatMoney(feeCents) : 'grátis'}</dd>
              </div>
            )}
          </dl>
          <div className="mt-4 flex items-end justify-between border-t border-slate-200 pt-4">
            <span className="text-sm font-medium text-slate-600">Total</span>
            <span className="text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">
              {formatMoney(total)}
            </span>
          </div>

          <p className="mt-6 mb-2 text-sm font-medium text-slate-700">Forma de pagamento</p>
          <div className="grid grid-cols-2 gap-2">
            {METHODS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setMethod(value)}
                aria-pressed={method === value}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors',
                  value === 'ACCOUNT' && 'col-span-2',
                  method === value
                    ? 'border-brand-700 bg-brand-50 text-brand-800'
                    : 'border-slate-300 text-slate-700 hover:bg-slate-50',
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>

          {!split && method === 'CASH' && (
            <div className="mt-4">
              <label htmlFor="sale-received" className="mb-1.5 block text-sm font-medium text-slate-700">
                {collectCash ? 'Cliente vai pagar com (troco para quanto?)' : 'Valor recebido (R$)'}
              </label>
              <Input
                id="sale-received"
                value={received}
                onChange={(e) => setReceived(e.target.value)}
                inputMode="decimal"
                placeholder={centsToInput(total)}
              />
              {cashShort ? (
                <p className="mt-1 text-sm text-red-600">Faltam {formatMoney(total - receivedCents)}</p>
              ) : (
                <p className="mt-2 flex justify-between text-sm">
                  <span className="text-slate-600">{collectCash ? 'Troco que o entregador leva' : 'Troco'}</span>
                  <strong className="text-lg text-slate-900 tabular-nums">{formatMoney(change)}</strong>
                </p>
              )}
            </div>
          )}

          <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={split}
              onChange={(e) => setSplit(e.target.checked)}
              className="size-4 accent-brand-700"
            />
            Dividir em duas formas de pagamento
          </label>
          {split && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="sale-first" className="mb-1.5 block text-xs font-medium text-slate-600">
                  Valor na 1ª forma (R$)
                </label>
                <Input
                  id="sale-first"
                  value={firstAmount}
                  onChange={(e) => setFirstAmount(e.target.value)}
                  inputMode="decimal"
                />
              </div>
              <div>
                <label htmlFor="sale-second" className="mb-1.5 block text-xs font-medium text-slate-600">
                  Restante ({formatMoney(Math.max(total - firstCents, 0))}) em
                </label>
                <Select
                  id="sale-second"
                  value={otherMethod}
                  onChange={(e) => setSecondMethod(e.target.value as PaymentMethod)}
                >
                  {METHODS.filter((m) => m.value !== method).map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          )}

          <div className="mt-4">
            <label htmlFor="sale-customer" className="mb-1.5 block text-sm font-medium text-slate-700">
              Cliente (opcional)
            </label>
            <CustomerPicker
              value={customer}
              onChange={(next) => {
                setCustomer(next);
                // Outro cliente, outros endereços.
                setDelivery((current) => current && { ...current, addressId: '' });
              }}
            />
            {loyalty.map((card) => {
              const remaining = card.available - giftsInCart(card.rule.id) / card.rule.rewardQuantity;
              return (
                <div
                  key={card.rule.id}
                  className={cn(
                    'mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm',
                    remaining > 0 ? 'bg-emerald-50 text-emerald-900' : 'bg-slate-50 text-slate-600',
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <Gift className="size-4 shrink-0" />
                    {card.rule.name}:{' '}
                    {remaining > 0
                      ? `tem direito a ${formatNumber(card.rule.rewardQuantity)} ${card.rule.rewardProduct.name}`
                      : giftsInCart(card.rule.id) > 0
                        ? 'brinde incluído nesta venda'
                        : `${formatNumber(card.progress)} de ${formatNumber(card.rule.requiredQuantity)} (falta ${formatNumber(card.missing)})`}
                  </span>
                  {remaining > 0 && (
                    <Button size="sm" variant="secondary" onClick={() => addGift(card)}>
                      Dar brinde
                    </Button>
                  )}
                </div>
              );
            })}
            <label className="mt-3 flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={delivery !== null}
                onChange={(e) => setDelivery(e.target.checked ? newDeliveryChoice() : null)}
                className="size-4 accent-brand-700"
              />
              <Truck className="size-4 text-slate-500" />É para entregar
            </label>
            {delivery && (
              <DeliveryOptions
                value={delivery}
                onChange={setDelivery}
                customerId={customer.customer?.id}
                feeCents={feeCents}
                settings={settings}
              />
            )}
            {accountNeedsCustomer && (
              <p className="mt-2 text-sm text-amber-700">Para vender fiado, escolha ou cadastre o cliente.</p>
            )}
            {usesAccount && customerAccount && (
              <p className={cn('mt-2 text-sm', overLimit ? 'text-red-600' : 'text-slate-600')}>
                Fiado em aberto: {formatMoney(customerAccount.balanceCents)}
                {customerAccount.creditLimitCents !== null && (
                  <> · limite {formatMoney(customerAccount.creditLimitCents)}</>
                )}
                {overLimit && ' · esta venda passa do limite'}
                {!overLimit && accountCents > 0 && (
                  <> · depois desta venda: {formatMoney(customerAccount.balanceCents + accountCents)}</>
                )}
              </p>
            )}
          </div>

          <Button
            className="mt-6 h-12 w-full text-base"
            disabled={!canFinish}
            loading={finish.isPending}
            onClick={() => finish.mutate()}
          >
            Finalizar venda (F2)
          </Button>
          <p className="mt-3 text-center text-xs text-slate-500">Controle interno. Não substitui a nota fiscal.</p>
        </Card>
      </div>
    </>
  );
}
