import { useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScanBarcode, X } from 'lucide-react';
import clsx from 'clsx';
import { api, ApiError } from '../lib/api';
import { useDebounced } from '../lib/hooks';
import { formatNumber } from '../lib/format';
import type { Paginated, Product } from '../lib/types';
import { Input } from './ui';

/**
 * Seleção de produto pensada para leitor de código de barras: o leitor "digita" o código
 * e envia Enter, então o Enter busca pelo código exato; digitando, busca por nome/SKU.
 */
export function ProductPicker({
  value,
  onChange,
  id,
  autoFocus,
}: {
  value: Pick<Product, 'id' | 'name' | 'sku' | 'barcode'> | null;
  onChange: (product: Product | null) => void;
  id?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const search = useDebounced(text.trim(), 250);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['products', 'picker', search],
    queryFn: () => api.get<Paginated<Product>>('/products', { search, active: true, pageSize: 8 }),
    enabled: search.length >= 2,
    select: (page) => page.data,
  });

  const select = (product: Product) => {
    onChange(product);
    setText('');
    setOpen(false);
    setNotFound(null);
    setLookupError(null);
  };

  const onKeyDown = async (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (event.key === 'Escape') {
      setOpen(false);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const code = text.trim();
      if (!code) return;
      if (open && results[highlight] && search === code) return select(results[highlight]);
      try {
        select(await api.get<Product>(`/products/by-barcode/${encodeURIComponent(code)}`));
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          // Código não cadastrado, mas a busca por nome deste mesmo texto achou um produto só: usa ele.
          if (search === code && results.length === 1) return select(results[0]);
          setNotFound(code);
        } else {
          // Sem conexão ou outro erro: avisa em vez de o bipe "não fazer nada".
          setLookupError((error as Error).message);
        }
        setOpen(true);
      }
    }
  };

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900">{value.name}</p>
          <p className="text-xs text-slate-500">
            {value.sku}
            {value.barcode && ` · ${value.barcode}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="rounded-md p-1 text-slate-500 hover:bg-white hover:text-slate-700"
          aria-label="Trocar produto"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <ScanBarcode
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
        aria-hidden
      />
      <Input
        id={id}
        autoFocus={autoFocus}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
          setHighlight(0);
          setNotFound(null);
          setLookupError(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        placeholder="Bipe o código de barras ou busque por nome/SKU"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        className="pl-9"
      />
      {open && (search.length >= 2 || notFound || lookupError) && (
        <ul
          className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
          role="listbox"
        >
          {lookupError && <li className="px-3 py-2 text-sm text-red-600">{lookupError}</li>}
          {notFound && results.length === 0 && (
            <li className="px-3 py-2 text-sm text-slate-500">Nenhum produto com o código “{notFound}”.</li>
          )}
          {!notFound && !lookupError && results.length === 0 && (
            <li className="px-3 py-2 text-sm text-slate-500">
              {isFetching ? 'Buscando...' : 'Nenhum produto encontrado.'}
            </li>
          )}
          {results.map((product, index) => (
            <li key={product.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === highlight}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(product)}
                onMouseEnter={() => setHighlight(index)}
                className={clsx(
                  'flex w-full items-center justify-between gap-3 px-3 py-2 text-left',
                  index === highlight && 'bg-slate-100',
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-900">{product.name}</span>
                  <span className="block text-xs text-slate-500">{product.sku}</span>
                </span>
                <span className="text-xs whitespace-nowrap text-slate-500 tabular-nums">
                  {formatNumber(product.totalQuantity ?? 0)} {product.unit}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
