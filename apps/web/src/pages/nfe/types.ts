import type { Product, Ref } from '../../lib/types';

export type MatchedProduct = Pick<Product, 'id' | 'sku' | 'name' | 'unit' | 'barcode' | 'active' | 'fractional'>;

export interface NfePreviewItem {
  index: number;
  code: string;
  description: string;
  barcode: string | null;
  ncm: string | null;
  unit: string;
  quantity: number;
  unitPriceCents: number;
  productCents: number;
  extraCostsCents: number;
  totalCostCents: number;
  match: { by: 'supplierCode' | 'barcode' | 'name'; product: MatchedProduct; conversionFactor: number } | null;
  suggestion: { sku: string; name: string; unit: string; barcode: string | null; conversionFactor: number };
}

export interface NfePreview {
  accessKey: string;
  number: string;
  series: string;
  issuedAt: string;
  authorized: boolean;
  totalCents: number;
  supplier: {
    document: string;
    documentFormatted: string;
    name: string;
    tradeName: string | null;
    city: string | null;
    existing: { id: string; name: string } | null;
  };
  alreadyImported: { id: string; createdAt: string; user: { name: string } } | null;
  items: NfePreviewItem[];
}

export interface NfeImportResult {
  importId: string;
  number: string;
  series: string;
  supplier: { id: string; name: string; created: boolean };
  items: Array<{
    index: number;
    productId: string;
    created: boolean;
    quantity: number;
    balance: number;
    alert: string;
  }>;
  summary: {
    items: number;
    skipped: number;
    createdProducts: number;
    units: number;
    alertsResolved: number;
    alertsOpened: number;
  };
}

export interface NfeImportRecord {
  id: string;
  number: string;
  series: string;
  issuedAt: string;
  createdAt: string;
  totalCents: number;
  itemCount: number;
  supplier: Ref;
  warehouse: Ref;
  user: Ref;
}

export type Action = 'link' | 'create' | 'skip';

export interface ItemDecision {
  action: Action;
  product: MatchedProduct | null;
  conversionFactor: string;
  create: {
    sku: string;
    name: string;
    unit: string;
    category: string;
    price: string;
    minStock: string;
    barcode: string;
  };
}
