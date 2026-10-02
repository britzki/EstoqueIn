import { Ban, Link2, PackagePlus } from 'lucide-react';
import { cn } from '../../lib/cn';
import { FRACTIONAL_UNITS, formatMoney, formatNumber, roundQty, UNITS } from '../../lib/format';
import { ProductPicker } from '../../components/ProductPicker';
import { Badge, Field, Input, Select, Tabs } from '../../components/ui';
import type { Action, ItemDecision, NfePreviewItem } from './types';

/** Quantidade que entra no estoque (nota × fator) e o custo por unidade do estoque. */
export function computeEntry(item: NfePreviewItem, decision: ItemDecision) {
  const factor = Number(String(decision.conversionFactor).replace(',', '.'));
  const validFactor = Number.isFinite(factor) && factor > 0;
  const quantity = roundQty(item.quantity * (validFactor ? factor : 1));
  // Só produtos vendidos por peso/medida aceitam quantidade com casas decimais.
  const fractional =
    decision.action === 'create'
      ? FRACTIONAL_UNITS.includes(decision.create.unit)
      : Boolean(decision.product?.fractional);
  return {
    validFactor,
    integer: fractional || Number.isInteger(quantity),
    quantity,
    unitCostCents: quantity > 0 ? Math.round(item.totalCostCents / quantity) : 0,
  };
}

/** Motivo para o item ainda não poder ser importado (ou null se está tudo certo). */
export function itemProblem(item: NfePreviewItem, decision: ItemDecision) {
  if (decision.action === 'skip') return null;
  if (decision.action === 'link' && !decision.product) return 'Escolha o produto';
  if (decision.action === 'create' && (!decision.create.sku.trim() || decision.create.name.trim().length < 2)) {
    return 'Informe SKU e nome';
  }
  const entry = computeEntry(item, decision);
  if (!entry.validFactor) return 'Fator de conversão inválido';
  if (!entry.integer) return 'Este produto é controlado em unidades inteiras: ajuste o fator de conversão';
  return null;
}

const MATCH_LABEL = {
  supplierCode: 'Reconhecido pelo código do fornecedor',
  barcode: 'Reconhecido pelo código de barras',
  name: 'Possível correspondência pelo nome: confira',
};

export function NfeItemCard({
  item,
  decision,
  onChange,
  canCreate,
  categories,
}: {
  item: NfePreviewItem;
  decision: ItemDecision;
  onChange: (decision: ItemDecision) => void;
  canCreate: boolean;
  categories: string[];
}) {
  const set = (changes: Partial<ItemDecision>) => onChange({ ...decision, ...changes });
  const setCreate = (changes: Partial<ItemDecision['create']>) => set({ create: { ...decision.create, ...changes } });
  const entry = computeEntry(item, decision);
  const problem = itemProblem(item, decision);
  const stockUnit = decision.action === 'create' ? decision.create.unit : (decision.product?.unit ?? 'UN');

  const actions = [
    { value: 'link' as const, label: 'Vincular', icon: <Link2 /> },
    ...(canCreate ? [{ value: 'create' as const, label: 'Cadastrar novo', icon: <PackagePlus /> }] : []),
    { value: 'skip' as const, label: 'Ignorar', icon: <Ban /> },
  ];

  return (
    <div
      className={cn(
        'rounded-xl border bg-white p-4 sm:p-5',
        problem ? 'border-amber-300' : 'border-slate-200',
        decision.action === 'skip' && 'opacity-60',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">
            Item {item.index} · cód. {item.code}
            {item.barcode && ` · EAN ${item.barcode}`}
          </p>
          <p className="mt-0.5 font-medium text-slate-900">{item.description}</p>
          <p className="mt-1 text-sm text-slate-600">
            {formatNumber(item.quantity)} {item.unit} × {formatMoney(item.unitPriceCents)} ={' '}
            <span className="font-medium text-slate-900">{formatMoney(item.productCents)}</span>
            {item.extraCostsCents !== 0 && (
              <span className="text-slate-500">
                {' '}
                {item.extraCostsCents > 0 ? '+' : '−'} {formatMoney(Math.abs(item.extraCostsCents))}{' '}
                frete/impostos/desc.
              </span>
            )}
          </p>
        </div>
        {item.match ? (
          <Badge tone={item.match.by === 'name' ? 'blue' : 'green'}>{MATCH_LABEL[item.match.by]}</Badge>
        ) : (
          <Badge tone="yellow">Não reconhecido</Badge>
        )}
      </div>

      <div className="mt-4">
        <Tabs<Action> value={decision.action} onChange={(action) => set({ action })} options={actions} />
      </div>

      {decision.action === 'link' && (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Produto do seu estoque" className="md:col-span-2">
            {(id) => <ProductPicker id={id} value={decision.product} onChange={(product) => set({ product })} />}
          </Field>
          <FactorField
            item={item}
            decision={decision}
            stockUnit={stockUnit}
            onChange={(conversionFactor) => set({ conversionFactor })}
          />
        </div>
      )}

      {decision.action === 'create' && (
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-6">
          <Field label="SKU" required className="col-span-2 md:col-span-2">
            {(id) => (
              <Input
                id={id}
                value={decision.create.sku}
                onChange={(e) => setCreate({ sku: e.target.value.toUpperCase() })}
              />
            )}
          </Field>
          <Field label="Nome do produto" required className="col-span-2 md:col-span-4">
            {(id) => (
              <Input id={id} value={decision.create.name} onChange={(e) => setCreate({ name: e.target.value })} />
            )}
          </Field>
          <Field label="Unidade no estoque">
            {(id) => (
              <Select id={id} value={decision.create.unit} onChange={(e) => setCreate({ unit: e.target.value })}>
                {[...new Set([decision.create.unit, ...UNITS])].map((unit) => (
                  <option key={unit}>{unit}</option>
                ))}
              </Select>
            )}
          </Field>
          <FactorField
            item={item}
            decision={decision}
            stockUnit={stockUnit}
            onChange={(conversionFactor) => set({ conversionFactor })}
          />
          <Field label="Categoria" className="col-span-2 md:col-span-1">
            {(id) => (
              <Input
                id={id}
                list={`categories-${item.index}`}
                value={decision.create.category}
                onChange={(e) => setCreate({ category: e.target.value })}
              />
            )}
          </Field>
          <datalist id={`categories-${item.index}`}>
            {categories.map((category) => (
              <option key={category} value={category} />
            ))}
          </datalist>
          <Field label="Preço de venda (R$)">
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                placeholder="0,00"
                value={decision.create.price}
                onChange={(e) => setCreate({ price: e.target.value })}
              />
            )}
          </Field>
          <Field label="Estoque mínimo">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0}
                value={decision.create.minStock}
                onChange={(e) => setCreate({ minStock: e.target.value })}
              />
            )}
          </Field>
        </div>
      )}

      {decision.action !== 'skip' && (
        <p className={cn('mt-4 text-sm', problem ? 'text-amber-700' : 'text-slate-600')}>
          {problem ?? (
            <>
              Entrada de{' '}
              <strong className="text-slate-900">
                {formatNumber(entry.quantity)} {stockUnit}
              </strong>{' '}
              a <strong className="text-slate-900">{formatMoney(entry.unitCostCents)}</strong> por {stockUnit} (custo
              com frete e impostos)
            </>
          )}
        </p>
      )}
    </div>
  );
}

function FactorField({
  item,
  decision,
  stockUnit,
  onChange,
}: {
  item: NfePreviewItem;
  decision: ItemDecision;
  stockUnit: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label="Conversão" hint={`1 ${item.unit} da nota = ${decision.conversionFactor || '?'} ${stockUnit}`}>
      {(id) => (
        <Input
          id={id}
          type="number"
          min={0.001}
          step="any"
          value={decision.conversionFactor}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}
