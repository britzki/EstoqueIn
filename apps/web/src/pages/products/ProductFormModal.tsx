import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useCategories, useSuppliers } from '../../lib/hooks';
import { FRACTIONAL_UNITS, UNITS, centsToInput, formatMoney, parseMoneyInput } from '../../lib/format';
import { useToast } from '../../lib/toast';
import type { Product, ProductSource } from '../../lib/types';
import { Button, DecimalInput, ErrorMessage, Field, Input, Modal, Select, Textarea } from '../../components/ui';

interface BarcodeLookup {
  found: boolean;
  name?: string;
  brand?: string;
  category?: string;
  quantity?: string;
}

const emptyForm = {
  sku: '',
  name: '',
  barcode: '',
  category: '',
  unit: 'UN',
  fractional: false,
  cost: '',
  price: '',
  minStock: '0',
  sourceYield: '',
  scaleCode: '',
  supplierId: '',
  description: '',
  quickSale: false,
  isKit: false,
  active: true,
};

export function ProductFormModal({
  open,
  onClose,
  product,
  bulkOf,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  product?: (Product & { sourceProduct?: ProductSource | null }) | null;
  /** Cria a versão a granel deste produto fechado (ex.: saco de ração → ração por kg). */
  bulkOf?: Product | null;
  onSaved?: (product: Product) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: suppliers = [] } = useSuppliers();
  const { data: categories = [] } = useCategories();
  const source: ProductSource | null = bulkOf ?? product?.sourceProduct ?? null;

  const [form, setForm] = useState(() => {
    if (product) {
      return {
        sku: product.sku,
        name: product.name,
        barcode: product.barcode ?? '',
        category: product.category ?? '',
        unit: product.unit,
        fractional: product.fractional,
        cost: centsToInput(product.costCents),
        price: centsToInput(product.priceCents),
        minStock: String(product.minStock),
        sourceYield: product.sourceYield ? String(product.sourceYield) : '',
        scaleCode: product.scaleCode ?? '',
        supplierId: product.supplierId ?? '',
        description: product.description ?? '',
        quickSale: product.quickSale ?? false,
        isKit: product.isKit ?? false,
        active: product.active,
      };
    }
    if (bulkOf) {
      return {
        ...emptyForm,
        sku: `${bulkOf.sku}-GR`.slice(0, 40),
        name: `${bulkOf.name} (granel)`,
        category: bulkOf.category ?? '',
        unit: 'KG',
        fractional: true,
        supplierId: bulkOf.supplierId ?? '',
      };
    }
    return emptyForm;
  });
  const [lookingUp, setLookingUp] = useState(false);
  const set = (field: keyof typeof form) => (value: string | boolean) =>
    setForm((current) => ({ ...current, [field]: value }));

  const yieldValue = Number(form.sourceYield.replace(',', '.'));
  const bulkCostCents = source && yieldValue > 0 ? Math.round(source.costCents / yieldValue) : null;

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        sku: form.sku,
        name: form.name,
        barcode: form.barcode,
        category: form.category,
        unit: form.unit,
        fractional: form.fractional,
        // O custo do granel vem do pacote a cada abertura; não é digitado.
        ...(!source && { costCents: parseMoneyInput(form.cost) ?? 0 }),
        priceCents: parseMoneyInput(form.price) ?? 0,
        minStock: Number(form.minStock.replace(',', '.') || 0),
        ...(source && { sourceProductId: source.id, sourceYield: yieldValue }),
        scaleCode: form.fractional ? form.scaleCode : '',
        supplierId: form.supplierId,
        description: form.description,
        quickSale: form.quickSale,
        isKit: form.isKit,
        ...(product && { active: form.active }),
      };
      return product ? api.patch<Product>(`/products/${product.id}`, body) : api.post<Product>('/products', body);
    },
    onSuccess: (saved) => {
      toast.success(product ? 'Produto atualizado' : 'Produto cadastrado', saved.name);
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product'] });
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      onSaved?.(saved);
      onClose();
    },
  });

  const errors = mutation.error instanceof ApiError ? mutation.error.fieldErrors : {};

  // Integração externa: sugere dados do produto pela base pública Open Food Facts.
  const lookupBarcode = async () => {
    setLookingUp(true);
    try {
      const result = await api.get<BarcodeLookup>(`/integrations/barcode/${form.barcode.trim()}`);
      if (!result.found) {
        toast.info('Produto não encontrado na Open Food Facts', 'Preencha os dados manualmente.');
        return;
      }
      const name = [result.name, result.brand, result.quantity].filter(Boolean).join(' ');
      setForm((current) => ({
        ...current,
        name: current.name || name,
        category: current.category || result.category || '',
      }));
      toast.success('Dados encontrados na Open Food Facts', name);
    } catch (error) {
      toast.error('Não foi possível consultar', (error as Error).message);
    } finally {
      setLookingUp(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={product ? 'Editar produto' : bulkOf ? 'Nova versão a granel' : 'Novo produto'}
      description={bulkOf ? `Produto vendido por peso, abastecido ao abrir unidades de "${bulkOf.name}".` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="product-form" loading={mutation.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="product-form" onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {mutation.error && !Object.keys(errors).length ? (
          <div className="sm:col-span-2">
            <ErrorMessage error={mutation.error} />
          </div>
        ) : null}

        <Field label="SKU" required error={errors.sku?.[0]} hint="Código interno. Ex.: CAF-500">
          {(id) => (
            <Input id={id} value={form.sku} onChange={(e) => set('sku')(e.target.value.toUpperCase())} required />
          )}
        </Field>

        <Field
          label="Código de barras"
          error={errors.barcode?.[0]}
          hint="EAN/GTIN. Sem código? Gere um interno depois de salvar."
        >
          {(id) => (
            <div className="flex gap-2">
              <Input
                id={id}
                value={form.barcode}
                onChange={(e) => set('barcode')(e.target.value.trim())}
                inputMode="numeric"
              />
              <Button
                variant="secondary"
                onClick={lookupBarcode}
                loading={lookingUp}
                disabled={!/^\d{8,14}$/.test(form.barcode)}
                icon={<Sparkles className="size-4" />}
                title="Buscar dados na Open Food Facts"
              >
                Buscar
              </Button>
            </div>
          )}
        </Field>

        <Field label="Nome" required error={errors.name?.[0]} className="sm:col-span-2">
          {(id) => <Input id={id} value={form.name} onChange={(e) => set('name')(e.target.value)} required />}
        </Field>

        <Field label="Categoria" error={errors.category?.[0]}>
          {(id) => (
            <>
              <Input
                id={id}
                list="categories"
                value={form.category}
                onChange={(e) => set('category')(e.target.value)}
              />
              <datalist id="categories">
                {categories.map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
            </>
          )}
        </Field>

        <Field label="Unidade">
          {(id) => (
            <Select
              id={id}
              value={form.unit}
              onChange={(e) => {
                const unit = e.target.value;
                // Unidades de peso, volume e comprimento já vêm marcadas como fracionadas.
                setForm((current) => ({ ...current, unit, fractional: FRACTIONAL_UNITS.includes(unit) }));
              }}
            >
              {[...new Set([form.unit, ...UNITS])].map((unit) => (
                <option key={unit}>{unit}</option>
              ))}
            </Select>
          )}
        </Field>

        <label className="flex items-start gap-2 text-sm text-slate-700 sm:col-span-2">
          <input
            type="checkbox"
            checked={form.fractional}
            onChange={(e) => set('fractional')(e.target.checked)}
            className="mt-0.5 size-4 accent-brand-700"
          />
          <span>
            Vendido por peso ou medida: aceita quantidade com casas decimais (ex.: 0,350 {form.unit})
            <span className="block text-xs text-slate-500">Desmarcado, o produto só aceita unidades inteiras.</span>
          </span>
        </label>

        {form.fractional && (
          <Field
            label="Código na balança"
            error={errors.scaleCode?.[0]}
            hint="O número deste produto cadastrado na balança etiquetadora (PLU). Assim a etiqueta é reconhecida no caixa."
            className="sm:col-span-2"
          >
            {(id) => (
              <Input
                id={id}
                value={form.scaleCode}
                onChange={(e) => set('scaleCode')(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                placeholder="Ex.: 123"
                className="sm:max-w-xs"
              />
            )}
          </Field>
        )}

        {source && (
          <div className="rounded-lg border border-brand-200 bg-brand-50 p-4 sm:col-span-2">
            <p className="text-sm font-medium text-slate-900">Granel de: {source.name}</p>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label={`Cada ${source.unit} rende quantos ${form.unit}?`}
                required
                error={errors.sourceYield?.[0]}
                hint="Usado ao abrir o pacote. Pode ser ajustado em cada abertura."
              >
                {(id) => (
                  <DecimalInput
                    id={id}
                    value={form.sourceYield}
                    onChange={(value) => set('sourceYield')(value)}
                    required
                  />
                )}
              </Field>
              <div className="text-sm text-slate-600">
                <p className="mb-1.5 font-medium text-slate-700">Custo por {form.unit}</p>
                <p>
                  {bulkCostCents !== null
                    ? `${formatMoney(bulkCostCents)} (custo do pacote ÷ rendimento)`
                    : 'Informe o rendimento para calcular.'}
                </p>
                <p className="mt-1 text-xs text-slate-500">Atualizado sozinho a cada pacote aberto.</p>
              </div>
            </div>
          </div>
        )}

        {!source && (
          <Field
            label="Custo (R$)"
            error={errors.costCents?.[0]}
            hint={product ? 'Recalculado (média ponderada) a cada entrada com custo.' : undefined}
          >
            {(id) => (
              <Input
                id={id}
                value={form.cost}
                onChange={(e) => set('cost')(e.target.value)}
                inputMode="decimal"
                placeholder="0,00"
              />
            )}
          </Field>
        )}

        <Field label={`Preço de venda por ${form.unit} (R$)`} error={errors.priceCents?.[0]}>
          {(id) => (
            <Input
              id={id}
              value={form.price}
              onChange={(e) => set('price')(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
            />
          )}
        </Field>

        <Field
          label={`Estoque mínimo (${form.unit})`}
          error={errors.minStock?.[0]}
          hint="Por estoque. 0 = não monitorar."
        >
          {(id) => <DecimalInput id={id} value={form.minStock} onChange={(value) => set('minStock')(value)} />}
        </Field>

        <Field label="Fornecedor principal">
          {(id) => (
            <Select id={id} value={form.supplierId} onChange={(e) => set('supplierId')(e.target.value)}>
              <option value="">—</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Descrição" className="sm:col-span-2">
          {(id) => <Textarea id={id} value={form.description} onChange={(e) => set('description')(e.target.value)} />}
        </Field>

        {!source && (
          <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
            <input
              type="checkbox"
              checked={form.isKit}
              onChange={(e) =>
                setForm((current) => ({
                  ...current,
                  isKit: e.target.checked,
                  ...(e.target.checked && { fractional: false }),
                }))
              }
              className="size-4 accent-brand-700"
            />
            É um kit (vários produtos vendidos juntos com preço próprio; os itens são escolhidos na página do produto)
          </label>
        )}

        <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
          <input
            type="checkbox"
            checked={form.quickSale}
            onChange={(e) => set('quickSale')(e.target.checked)}
            className="size-4 accent-brand-700"
          />
          Botão rápido na tela de venda (para os produtos que mais saem, como a ração a granel)
        </label>

        {product && (
          <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => set('active')(e.target.checked)}
              className="size-4 accent-brand-700"
            />
            Produto ativo (inativos não podem ser movimentados)
          </label>
        )}
      </form>
    </Modal>
  );
}
