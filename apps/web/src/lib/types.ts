export type Role = 'ADMIN' | 'MANAGER' | 'OPERATOR' | 'VIEWER';

export type Permission =
  | 'products:write'
  | 'products:import'
  | 'suppliers:write'
  | 'warehouses:write'
  | 'stock:move'
  | 'stock:adjust'
  | 'inventory:count'
  | 'inventory:manage'
  | 'alerts:ack'
  | 'reports:read'
  | 'sales:create'
  | 'sales:cancel'
  | 'settings:manage'
  | 'audit:read'
  | 'users:manage';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Session {
  user: SessionUser;
  permissions: Permission[];
  /** Entrou com senha temporária: precisa trocá-la antes de usar o sistema. */
  mustChangePassword?: boolean;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface Ref {
  id: string;
  name: string;
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  address: string | null;
  active: boolean;
  totalUnits?: number;
  productsInStock?: number;
  openAlerts?: number;
}

export interface Supplier {
  id: string;
  name: string;
  document: string | null;
  email: string | null;
  phone: string | null;
  contactName: string | null;
  notes: string | null;
  active: boolean;
  _count?: { products: number };
}

export interface Product {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  category: string | null;
  unit: string;
  costCents: number;
  priceCents: number;
  minStock: number;
  active: boolean;
  /** Aceita quantidade com casas decimais (venda por peso/medida). */
  fractional: boolean;
  /** Produto a granel: id do produto fechado de origem e quanto cada unidade dele rende. */
  sourceProductId: string | null;
  sourceYield: number | null;
  /** Código do produto na balança etiquetadora. */
  scaleCode: string | null;
  supplierId: string | null;
  supplier?: Ref | null;
  totalQuantity?: number;
  openAlerts?: number;
}

/** Produto fechado que abastece um granel (ex.: saco de 15 kg). */
export type ProductSource = Pick<Product, 'id' | 'sku' | 'name' | 'unit' | 'costCents'>;

export interface ProductStock {
  warehouse: { id: string; code: string; name: string };
  quantity: number;
  minQuantity: number | null;
  effectiveMin: number;
}

export interface ProductDetail extends Product {
  stock: ProductStock[];
  totalQuantity: number;
  alerts: Array<StockAlert & { warehouse: Ref }>;
  sourceProduct: ProductSource | null;
  bulkProducts: Array<Pick<Product, 'id' | 'sku' | 'name' | 'unit' | 'sourceYield' | 'active'>>;
  /** Códigos usados pelos fornecedores para este produto (aprendidos na importação de NF-e). */
  supplierProducts: Array<{
    id: string;
    supplierCode: string;
    conversionFactor: number;
    description: string | null;
    supplier: Ref;
  }>;
}

export type MovementType =
  | 'ENTRY'
  | 'EXIT'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'ADJUSTMENT'
  | 'FRACTION_OUT'
  | 'FRACTION_IN'
  | 'SALE_CANCEL'
  | 'SALE_RETURN';

export interface Movement {
  id: string;
  type: MovementType;
  quantity: number;
  balanceAfter: number;
  unitCostCents: number | null;
  documentRef: string | null;
  reason: string | null;
  transferId: string | null;
  createdAt: string;
  product: { id: string; sku?: string; name: string; unit: string };
  warehouse: { id: string; code?: string; name: string };
  supplier?: Ref | null;
  user: Ref;
}

export type AlertType = 'LOW_STOCK' | 'OUT_OF_STOCK' | 'NEGATIVE_STOCK';

export interface StockAlert {
  id: string;
  type: AlertType;
  status: 'OPEN' | 'RESOLVED';
  productId: string;
  warehouseId: string;
  quantity: number;
  threshold: number;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  product?: { id: string; sku: string; name: string; unit: string };
  warehouse?: { id: string; code: string; name: string };
  acknowledgedBy?: Ref | null;
}

export type AlertChange =
  { kind: 'none' } | { kind: 'opened' | 'escalated' | 'updated' | 'resolved'; alert: StockAlert };

/** Movimentação como retornada ao registrar (sem relações carregadas). */
export type RawMovement = Omit<Movement, 'product' | 'warehouse' | 'supplier' | 'user'>;

export interface MovementResult {
  movement: RawMovement;
  balance: number;
  alert: AlertChange;
}

export interface FractionResult {
  groupId: string;
  pack: { id: string; name: string; unit: string };
  bulk: { id: string; name: string; unit: string };
  bulkQuantity: number;
  from: MovementResult;
  to: MovementResult;
}

export interface TransferResult {
  transferId: string;
  from: MovementResult;
  to: MovementResult;
}

export interface InventorySummary {
  id: string;
  status: 'OPEN' | 'COMPLETED' | 'CANCELLED';
  notes: string | null;
  createdAt: string;
  completedAt: string | null;
  warehouse: Ref;
  createdBy: Ref;
  totalItems: number;
  countedItems: number;
}

export interface InventoryItem {
  id: string;
  productId: string;
  expectedQuantity: number;
  countedQuantity: number | null;
  countedAt: string | null;
  difference: number | null;
  product: { id: string; sku: string; name: string; barcode: string | null; unit: string; category: string | null };
}

export interface InventoryDetail extends Omit<InventorySummary, 'totalItems' | 'countedItems'> {
  items: InventoryItem[];
}

export interface User extends SessionUser {
  active: boolean;
  createdAt: string;
}

export type PaymentMethod = 'CASH' | 'PIX' | 'DEBIT' | 'CREDIT' | 'OTHER';

export interface SaleItem {
  id: string;
  productId: string;
  description: string;
  unit: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  /** Quanto ainda pode ser devolvido (só no detalhe da venda). */
  returnable?: number;
}

export interface SalePayment {
  id?: string;
  method: PaymentMethod;
  amountCents: number;
}

export interface Sale {
  id: string;
  number: number;
  status: 'COMPLETED' | 'CANCELLED';
  customerName: string | null;
  customerId: string | null;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  paidCents: number;
  changeCents: number;
  createdAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  payments: SalePayment[];
  user: Ref;
}

export interface SaleDetail extends Sale {
  items: SaleItem[];
  warehouse: Ref;
  cancelledBy: Ref | null;
  customer: (Ref & { phone: string | null }) | null;
  returns: SaleReturn[];
  alertsOpened?: number;
}

export interface SaleReturn {
  id: string;
  reason: string;
  refundCents: number;
  refundMethod: PaymentMethod;
  createdAt: string;
  user: Ref;
  items: Array<{ id: string; saleItemId: string; quantity: number; refundCents: number }>;
}

export interface SaleListItem extends Sale {
  _count: { items: number; returns: number };
}

export interface StoreSettings {
  storeName: string;
  document: string | null;
  address: string | null;
  phone: string | null;
  receiptFooter: string | null;
  receiptWidth: 58 | 80;
  autoPrint: boolean;
  scalePrefix: string;
  scaleCodeDigits: number;
  scaleValueType: 'WEIGHT' | 'PRICE';
  allowNegativeStock: boolean;
  requireCashSession: boolean;
  cashFloatCents: number;
}

export interface CashSummary {
  salesCount: number;
  cancelledCount: number;
  returnsCount: number;
  revenueCents: number;
  byMethod: Record<PaymentMethod, number>;
  withdrawalsCents: number;
  depositsCents: number;
  expectedCashCents: number;
  differenceCents: number | null;
  closingWithdrawalCents: number | null;
  previousKeptCents: number | null;
  openingDifferenceCents: number | null;
}

export interface CashSession {
  id: string;
  number: number;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt: string | null;
  openingCents: number;
  expectedCents: number | null;
  countedCents: number | null;
  keptCents: number | null;
  notes: string | null;
  warehouse: Ref;
  openedBy: Ref;
  closedBy: Ref | null;
}

export interface CashDetail extends CashSession {
  movements: Array<{
    id: string;
    type: 'WITHDRAWAL' | 'DEPOSIT';
    amountCents: number;
    reason: string;
    createdAt: string;
    user: { name: string };
  }>;
  summary: CashSummary;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  _count?: { sales: number };
}

export interface RepurchaseReminder {
  customer: { id: string; name: string; phone: string | null };
  product: { id: string; name: string; unit: string };
  purchases: number;
  averageIntervalDays: number;
  lastPurchaseAt: string;
  expectedAt: string;
  daysUntil: number;
}

/** Produto como o caixa precisa: preço, unidade e saldo no estoque da venda. */
export interface SaleProduct {
  id: string;
  sku: string;
  name: string;
  unit: string;
  fractional: boolean;
  priceCents: number;
  stock?: number;
}

export interface ResolvedCode {
  product: SaleProduct;
  /** null = perguntar a quantidade (produto por peso sem etiqueta). */
  quantity: number | null;
  source: 'barcode' | 'scale' | 'sku';
}
