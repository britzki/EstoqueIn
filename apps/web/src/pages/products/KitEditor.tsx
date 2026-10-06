import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { formatMoney, formatNumber } from '../../lib/format';
import type { KitItem, Product, ProductDetail } from '../../lib/types';
import { ProductPicker } from '../../components/ProductPicker';
import { Button, Card, CardHeader, DecimalInput, ErrorMessage } from '../../components/ui';

interface Line {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  fractional: boolean;
  costCents: number;
  quantity: string;
}

const toLine = (item: KitItem): Line => ({
  productId: item.productId,
  name: item.product.name,
  sku: item.product.sku,
  unit: item.product.unit,
  fractional: item.product.fractional,
  costCents: item.product.costCents,
  quantity: String(item.quantity),
});

/** Produtos que formam o kit. Vender o kit baixa o estoque de cada um. */
export function KitEditor({ product, editable }: { product: ProductDetail; editable: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [lines, setLines] = useState<Line[]>(product.kitItems.map(toLine));
  const [picking, setPicking] = useState<Product | null>(null);
  const dirty =
    JSON.stringify(lines.map((l) => [l.productId, Number(l.quantity)])) !==
    JSON.stringify(product.kitItems.map((i) => [i.productId, i.quantity]));

  const save = useMutation({
    mutationFn: () =>
      api.put(`/products/${product.id}/kit`, {
        items: lines.map((line) => ({ productId: line.productId, quantity: Number(line.quantity.replace(',', '.')) })),
      }),
    onSuccess: () => {
      toast.success('Kit salvo');
      queryClient.invalidateQueries({ queryKey: ['product', product.id] });
    },
  });

  const add = (item: Product | null) => {
    setPicking(null);
    if (!item || lines.some((line) => line.productId === item.id)) return;
    if (item.id === product.id) return toast.error('O kit não pode conter ele mesmo');
    setLines((current) => [
      ...current,
      {
        productId: item.id,
        name: item.name,
        sku: item.sku,
        unit: item.unit,
        fractional: item.fractional,
        costCents: item.costCents,
        quantity: '1',
      },
    ]);
  };

  const cost = lines.reduce((sum, line) => sum + (Number(line.quantity.replace(',', '.')) || 0) * line.costCents, 0);
  const valid = lines.length > 0 && lines.every((line) => Number(line.quantity.replace(',', '.')) > 0);

  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title="Produtos do kit"
        description="Ao vender o kit, sai do estoque a quantidade de cada produto abaixo."
        actions={
          editable && (
            <Button size="sm" loading={save.isPending} disabled={!dirty || !valid} onClick={() => save.mutate()}>
              Salvar kit
            </Button>
          )
        }
      />
      <div className="space-y-3 p-5">
        {save.error && <ErrorMessage error={save.error} />}
        {lines.length === 0 && <p className="text-sm text-slate-500">Nenhum produto no kit ainda.</p>}
        <ul className="divide-y divide-slate-100">
          {lines.map((line, index) => (
            <li key={line.productId} className="flex items-center gap-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-slate-900">{line.name}</span>
                <span className="text-xs text-slate-500">
                  {line.sku} · custo {formatMoney(line.costCents)}/{line.unit}
                </span>
              </span>
              <DecimalInput
                value={line.quantity}
                disabled={!editable}
                onChange={(value) =>
                  setLines((current) => current.map((l, i) => (i === index ? { ...l, quantity: value } : l)))
                }
                className="h-9 w-20 text-right"
                aria-label={`Quantidade de ${line.name} no kit`}
              />
              <span className="w-8 text-xs text-slate-500">{line.unit}</span>
              {editable && (
                <button
                  type="button"
                  onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                  className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  aria-label={`Tirar ${line.name} do kit`}
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
        {editable && (
          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-700">Adicionar produto</p>
            <ProductPicker value={picking} onChange={add} />
          </div>
        )}
        <p className="text-sm text-slate-600">
          Custo do kit: <strong className="text-slate-900">{formatMoney(Math.round(cost))}</strong> · Preço de venda:{' '}
          <strong className="text-slate-900">{formatMoney(product.priceCents)}</strong>
          {product.kit && <> · Dá para montar {formatNumber(product.kit.available)} kit(s) com o estoque atual</>}
        </p>
      </div>
    </Card>
  );
}
