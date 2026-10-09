import { useEffect, useState } from 'react';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { CashDetail, Paginated, StoreSettings, Supplier, Warehouse } from './types';

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

export const useSuppliers = () =>
  useQuery({
    queryKey: ['suppliers', 'all-active'],
    queryFn: () => api.get<Paginated<Supplier>>('/suppliers', { active: true, pageSize: 100 }),
    select: (page) => page.data,
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
  const [chosen, setChosen] = useState(() => {
    try {
      return localStorage.getItem(SALE_WAREHOUSE_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const warehouseId = warehouses.find((w) => w.id === chosen)?.id ?? warehouses[0]?.id ?? '';
  const setWarehouseId = (id: string) => {
    setChosen(id);
    try {
      localStorage.setItem(SALE_WAREHOUSE_KEY, id);
    } catch {
      /* preferência não salva: sem problema */
    }
  };
  return { warehouses, warehouseId, setWarehouseId };
}

/** Caixa aberto no estoque (null se fechado). */
export const useCurrentCash = (warehouseId: string) =>
  useQuery({
    queryKey: ['cash', 'current', warehouseId],
    queryFn: () => api.get<CashDetail | null>('/cash/current', { warehouseId }),
    enabled: Boolean(warehouseId),
  });
