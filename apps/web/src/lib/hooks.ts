import { useEffect, useState } from 'react';
import { readLocal, writeLocal } from './storage';
import { useToast } from './toast';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api, type Query } from './api';
import type { CashDetail, DeliveryDetail, Paginated, StoreSettings, Supplier, Warehouse } from './types';

/**
 * Tudo o que uma venda, um cancelamento ou uma devolução mexe: estoque, caixa, entregas e a ficha
 * do cliente (fiado, cartão fidelidade). Uma lista só, para nenhuma tela ficar desatualizada.
 */
export function invalidateSaleData(queryClient: QueryClient) {
  for (const key of [
    'sales',
    'sale',
    'deliveries',
    'products',
    'product',
    'alerts',
    'dashboard',
    'movements',
    'warehouses',
    'cash',
    'customers',
  ]) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
}

/** Baixa um arquivo da API (planilhas), avisando se der errado. */
export function useDownload() {
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);
  const download = async (path: string, filename: string, query?: Query) => {
    setDownloading(true);
    try {
      await api.download(path, filename, query);
    } catch (error) {
      toast.error('Falha ao exportar', (error as Error).message);
    } finally {
      setDownloading(false);
    }
  };
  return { download, downloading };
}

/** Tudo o que uma movimentação de estoque mexe (saldos, alertas, painel, histórico). */
export function invalidateStock(queryClient: QueryClient) {
  for (const key of ['products', 'product', 'alerts', 'dashboard', 'movements', 'warehouses']) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
}

/** Fecha com Esc (janelas e painéis). */
export function useEscapeKey(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onEscape();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onEscape]);
}

export function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export const useWarehouses = () =>
  useQuery({ queryKey: ['warehouses'], queryFn: () => api.get<Warehouse[]>('/warehouses') });

export const useActiveWarehouses = () => {
  const query = useWarehouses();
  return { ...query, data: query.data?.filter((warehouse) => warehouse.active) };
};

/** Todos os fornecedores ativos (a API entrega de 100 em 100; a nota fiscal cadastra fornecedores sozinha). */
export const useSuppliers = () =>
  useQuery({
    queryKey: ['suppliers', 'all-active'],
    queryFn: async () => {
      const all: Supplier[] = [];
      for (let page = 1; ; page++) {
        const result = await api.get<Paginated<Supplier>>('/suppliers', { active: true, pageSize: 100, page });
        all.push(...result.data);
        if (page >= result.totalPages) return all;
      }
    },
  });

export const useCategories = () =>
  useQuery({ queryKey: ['categories'], queryFn: () => api.get<string[]>('/products/categories') });

export interface SetupStatus {
  needsSetup: boolean;
  demoAccounts: Array<{ role: string; email: string; password: string }>;
}

export const useSetupStatus = () =>
  useQuery({ queryKey: ['setup', 'status'], queryFn: () => api.get<SetupStatus>('/setup/status'), staleTime: 60_000 });

export const useStoreSettings = () =>
  useQuery({ queryKey: ['settings'], queryFn: () => api.get<StoreSettings>('/settings'), staleTime: 5 * 60_000 });

const SALE_WAREHOUSE_KEY = 'estoquein.saleWarehouse';

/** Estoque de onde a loja vende (o caixa e o PDV usam o mesmo, lembrado neste computador). */
export function useSaleWarehouse() {
  const { data: warehouses = [] } = useActiveWarehouses();
  const [chosen, setChosen] = useState(() => readLocal(SALE_WAREHOUSE_KEY) ?? '');
  const warehouseId = warehouses.find((w) => w.id === chosen)?.id ?? warehouses[0]?.id ?? '';
  const setWarehouseId = (id: string) => {
    setChosen(id);
    writeLocal(SALE_WAREHOUSE_KEY, id);
  };
  return { warehouses, warehouseId, setWarehouseId };
}

/** Painel de entregas (abertas e concluídas hoje). O menu usa a mesma consulta para o contador. */
export const useDeliveryBoard = <T = DeliveryDetail[]>(select?: (list: DeliveryDetail[]) => T) =>
  useQuery({
    queryKey: ['deliveries', 'board'],
    queryFn: () => api.get<DeliveryDetail[]>('/deliveries'),
    refetchInterval: 30_000,
    select,
  });

/** Caixa aberto no estoque (null se fechado). */
export const useCurrentCash = (warehouseId: string) =>
  useQuery({
    queryKey: ['cash', 'current', warehouseId],
    queryFn: () => api.get<CashDetail | null>('/cash/current', { warehouseId }),
    enabled: Boolean(warehouseId),
  });
