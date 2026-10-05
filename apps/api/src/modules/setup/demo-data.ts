/**
 * Popula o banco com uma pequena rede de mercearias fictícia e ~45 dias de operação simulada.
 * As movimentações passam pelo mesmo serviço usado pela API, então saldos, custos médios
 * e alertas (abertos e resolvidos) ficam consistentes com as regras de negócio.
 */
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma.js';
import { gtinCheckDigit } from '../../lib/barcode.js';
import { registerEntry, registerExit, transferStock } from '../stock/stock.service.js';
import { openInventory } from '../inventory/inventory.service.js';

// PRNG determinístico: o seed gera sempre os mesmos dados.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let random = mulberry32(42);
const randomDigits = (length: number) => Array.from({ length }, () => Math.floor(random() * 10)).join('');
const internalEan13 = () => {
  const body = '2' + randomDigits(11);
  return body + gtinCheckDigit(body);
};

const DAY_MS = 24 * 60 * 60 * 1000;
const SIMULATED_DAYS = 45;

interface ProductSeed {
  sku: string;
  name: string;
  category: string;
  unit: string;
  cost: number;
  price: number;
  min: number;
  supplier: number;
  /** Venda média diária por loja. */
  demand: number;
  /** A partir deste dia (contado do fim) o fornecedor atrasa as entregas. */
  supplierDelayFromDay?: number;
}

const PRODUCTS: ProductSeed[] = [
  {
    sku: 'CAF-500',
    name: 'Café torrado e moído 500g',
    category: 'Mercearia',
    unit: 'UN',
    cost: 14.9,
    price: 22.9,
    min: 12,
    supplier: 0,
    demand: 4,
    supplierDelayFromDay: 12,
  },
  {
    sku: 'ARR-5KG',
    name: 'Arroz branco tipo 1 5kg',
    category: 'Mercearia',
    unit: 'PCT',
    cost: 21.5,
    price: 29.9,
    min: 10,
    supplier: 0,
    demand: 3,
  },
  {
    sku: 'FEI-1KG',
    name: 'Feijão carioca 1kg',
    category: 'Mercearia',
    unit: 'PCT',
    cost: 6.8,
    price: 9.49,
    min: 15,
    supplier: 0,
    demand: 4,
  },
  {
    sku: 'ACU-1KG',
    name: 'Açúcar refinado 1kg',
    category: 'Mercearia',
    unit: 'PCT',
    cost: 3.9,
    price: 5.49,
    min: 10,
    supplier: 0,
    demand: 3,
  },
  {
    sku: 'OLE-900',
    name: 'Óleo de soja 900ml',
    category: 'Mercearia',
    unit: 'UN',
    cost: 6.2,
    price: 8.99,
    min: 10,
    supplier: 1,
    demand: 3,
  },
  {
    sku: 'MAC-500',
    name: 'Macarrão espaguete 500g',
    category: 'Mercearia',
    unit: 'PCT',
    cost: 3.1,
    price: 4.99,
    min: 15,
    supplier: 1,
    demand: 4,
  },
  {
    sku: 'LEI-1L',
    name: 'Leite integral UHT 1L',
    category: 'Laticínios',
    unit: 'UN',
    cost: 4.2,
    price: 5.99,
    min: 24,
    supplier: 2,
    demand: 8,
  },
  {
    sku: 'QUE-150',
    name: 'Queijo muçarela fatiado 150g',
    category: 'Laticínios',
    unit: 'UN',
    cost: 7.9,
    price: 11.9,
    min: 8,
    supplier: 2,
    demand: 2,
  },
  {
    sku: 'MAN-200',
    name: 'Manteiga com sal 200g',
    category: 'Laticínios',
    unit: 'UN',
    cost: 9.4,
    price: 13.9,
    min: 6,
    supplier: 2,
    demand: 1.5,
  },
  {
    sku: 'IOG-170',
    name: 'Iogurte natural 170g',
    category: 'Laticínios',
    unit: 'UN',
    cost: 2.3,
    price: 3.79,
    min: 12,
    supplier: 2,
    demand: 3,
    supplierDelayFromDay: 9,
  },
  {
    sku: 'DET-500',
    name: 'Detergente neutro 500ml',
    category: 'Limpeza',
    unit: 'UN',
    cost: 1.85,
    price: 3.49,
    min: 20,
    supplier: 3,
    demand: 3,
  },
  {
    sku: 'SAB-1K6',
    name: 'Sabão em pó 1,6kg',
    category: 'Limpeza',
    unit: 'UN',
    cost: 15.9,
    price: 23.9,
    min: 6,
    supplier: 3,
    demand: 1,
  },
  {
    sku: 'PAP-12',
    name: 'Papel higiênico folha dupla 12 rolos',
    category: 'Higiene',
    unit: 'PCT',
    cost: 13.2,
    price: 19.9,
    min: 8,
    supplier: 3,
    demand: 2,
  },
  {
    sku: 'CRE-090',
    name: 'Creme dental 90g',
    category: 'Higiene',
    unit: 'UN',
    cost: 3.4,
    price: 5.99,
    min: 10,
    supplier: 3,
    demand: 2,
  },
  {
    sku: 'SHA-350',
    name: 'Shampoo 350ml',
    category: 'Higiene',
    unit: 'UN',
    cost: 9.8,
    price: 16.9,
    min: 5,
    supplier: 3,
    demand: 1,
    supplierDelayFromDay: 15,
  },
  {
    sku: 'AGU-1L5',
    name: 'Água mineral sem gás 1,5L',
    category: 'Bebidas',
    unit: 'UN',
    cost: 1.6,
    price: 3.29,
    min: 24,
    supplier: 1,
    demand: 6,
  },
  {
    sku: 'REF-2L',
    name: 'Refrigerante cola 2L',
    category: 'Bebidas',
    unit: 'UN',
    cost: 6.9,
    price: 10.99,
    min: 12,
    supplier: 1,
    demand: 4,
  },
  {
    sku: 'SUC-1L',
    name: 'Suco de uva integral 1L',
    category: 'Bebidas',
    unit: 'UN',
    cost: 9.5,
    price: 15.9,
    min: 6,
    supplier: 1,
    demand: 1,
  },
];

/** Apaga todos os dados (usado antes de recarregar a demonstração). */
export async function clearDatabase() {
  await prisma.auditLog.deleteMany();
  await prisma.purchaseOrderItem.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.customerPayment.deleteMany();
  await prisma.saleReturnItem.deleteMany();
  await prisma.saleReturn.deleteMany();
  await prisma.cashMovement.deleteMany();
  await prisma.salePayment.deleteMany();
  await prisma.saleItem.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.cashSession.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.storeSettings.deleteMany();
  await prisma.nfeImport.deleteMany();
  await prisma.supplierProduct.deleteMany();
  await prisma.stockAlert.deleteMany();
  await prisma.inventoryItem.deleteMany();
  await prisma.inventory.deleteMany();
  await prisma.stockLevel.deleteMany();
  await prisma.product.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.warehouse.deleteMany();
  await prisma.user.deleteMany();
}

export const DEMO_ACCOUNTS = [
  { role: 'Administrador', email: 'admin@estoquein.dev', password: 'Admin@123' },
  { role: 'Gerente', email: 'gerente@estoquein.dev', password: 'Gerente@123' },
  { role: 'Operador', email: 'operador@estoquein.dev', password: 'Operador@123' },
  { role: 'Somente leitura', email: 'leitura@estoquein.dev', password: 'Leitura@123' },
];

/** Carrega a demonstração completa num banco vazio. */
export async function loadDemoData({ log = (_message: string) => {} } = {}) {
  random = mulberry32(42);

  log('👤 Usuários, estoques e fornecedores...');
  const hash = (password: string) => bcrypt.hash(password, 10);
  const [, manager, operator] = await Promise.all([
    prisma.user.create({
      data: {
        name: 'Ana Administradora',
        email: 'admin@estoquein.dev',
        role: 'ADMIN',
        passwordHash: await hash('Admin@123'),
      },
    }),
    prisma.user.create({
      data: {
        name: 'Gustavo Gerente',
        email: 'gerente@estoquein.dev',
        role: 'MANAGER',
        passwordHash: await hash('Gerente@123'),
      },
    }),
    prisma.user.create({
      data: {
        name: 'Otávio Operador',
        email: 'operador@estoquein.dev',
        role: 'OPERATOR',
        passwordHash: await hash('Operador@123'),
      },
    }),
    prisma.user.create({
      data: {
        name: 'Lia Leitura',
        email: 'leitura@estoquein.dev',
        role: 'VIEWER',
        passwordHash: await hash('Leitura@123'),
      },
    }),
  ]);

  const depot = await prisma.warehouse.create({
    data: { code: 'CD', name: 'Depósito Central', address: 'Rua das Indústrias, 1200' },
  });
  const stores = await Promise.all([
    prisma.warehouse.create({ data: { code: 'LJ-CTR', name: 'Loja Centro', address: 'Av. Principal, 450' } }),
    prisma.warehouse.create({ data: { code: 'LJ-BNV', name: 'Loja Bairro Novo', address: 'Rua das Flores, 87' } }),
  ]);

  const suppliers = await Promise.all(
    [
      {
        name: 'Distribuidora Alvorada Ltda',
        document: '11.222.333/0001-01',
        email: 'vendas@alvorada.example',
        phone: '(11) 4000-1001',
        contactName: 'Marcos',
      },
      {
        name: 'Atacado Bom Preço',
        document: '22.333.444/0001-02',
        email: 'pedidos@bompreco.example',
        phone: '(11) 4000-2002',
        contactName: 'Juliana',
      },
      {
        name: 'Laticínios Serra Azul',
        document: '33.444.555/0001-03',
        email: 'comercial@serraazul.example',
        phone: '(35) 3000-3003',
        contactName: 'Roberto',
      },
      {
        name: 'Higiene & Cia Distribuidora',
        document: '44.555.666/0001-04',
        email: 'contato@higieneecia.example',
        phone: '(11) 4000-4004',
        contactName: 'Fernanda',
      },
    ].map((data) => prisma.supplier.create({ data })),
  );

  log('📦 Produtos...');
  const products = await Promise.all(
    PRODUCTS.map((p) =>
      prisma.product.create({
        data: {
          sku: p.sku,
          name: p.name,
          category: p.category,
          unit: p.unit,
          barcode: internalEan13(),
          priceCents: Math.round(p.price * 100),
          minStock: p.min,
          supplierId: suppliers[p.supplier].id,
        },
      }),
    ),
  );

  log('🚚 Simulando 45 dias de operação (pode levar alguns segundos)...');
  const stock = new Map<string, number>();
  const key = (productId: string, warehouseId: string) => `${productId}:${warehouseId}`;
  const get = (productId: string, warehouseId: string) => stock.get(key(productId, warehouseId)) ?? 0;
  const add = (productId: string, warehouseId: string, delta: number) =>
    stock.set(key(productId, warehouseId), get(productId, warehouseId) + delta);

  const now = new Date();
  let receiptNumber = 1000;
  let invoiceNumber = 45_000;

  for (let daysAgo = SIMULATED_DAYS; daysAgo >= 0; daysAgo--) {
    const day = new Date(now.getTime() - daysAgo * DAY_MS);
    day.setHours(8, 0, 0, 0);
    // Hoje: as movimentações terminam alguns minutos antes de agora.
    let clock = daysAgo === 0 ? Math.min(day.getTime(), now.getTime() - 4 * 60 * 60 * 1000) : day.getTime();
    const tick = () => new Date((clock += Math.floor(1 + random() * 4) * 60 * 1000));
    const isFirstDay = daysAgo === SIMULATED_DAYS;
    const weekendBoost = [0, 6].includes(day.getDay()) ? 1.3 : 1;

    for (const [index, seed] of PRODUCTS.entries()) {
      const product = products[index];

      // Compras do fornecedor para o depósito: carga inicial e reposição semanal.
      const delayed = seed.supplierDelayFromDay !== undefined && daysAgo <= seed.supplierDelayFromDay;
      const needsPurchase = get(product.id, depot.id) < seed.demand * 2 * 10;
      if (isFirstDay || (daysAgo % 7 === 0 && needsPurchase && !delayed)) {
        const quantity = Math.ceil((seed.demand * 2 * 14) / 6) * 6;
        const variation = 0.95 + random() * 0.1;
        await registerEntry(
          {
            productId: product.id,
            warehouseId: depot.id,
            quantity,
            unitCostCents: Math.round(seed.cost * variation * 100),
            supplierId: suppliers[seed.supplier].id,
            documentRef: `NF ${invoiceNumber++}`,
            reason: isFirstDay ? 'Carga inicial' : 'Reposição semanal',
          },
          manager.id,
          { occurredAt: tick() },
        );
        add(product.id, depot.id, quantity);

        if (isFirstDay) {
          await prisma.stockLevel.update({
            where: { productId_warehouseId: { productId: product.id, warehouseId: depot.id } },
            data: { minQuantity: seed.min * 2 },
          });
        }
      }

      for (const store of stores) {
        // Abastecimento das lojas a partir do depósito.
        const storeQty = get(product.id, store.id);
        if (storeQty <= seed.min) {
          const quantity = Math.min(Math.ceil(seed.demand * 7), get(product.id, depot.id));
          if (quantity > 0) {
            await transferStock(
              { productId: product.id, fromWarehouseId: depot.id, toWarehouseId: store.id, quantity },
              operator.id,
              { occurredAt: tick() },
            );
            add(product.id, depot.id, -quantity);
            add(product.id, store.id, quantity);
          }
        }

        if (isFirstDay) continue;

        // Vendas do dia (e, de vez em quando, uma perda por avaria).
        const factor = daysAgo === 0 ? 0.5 : 1;
        const wanted = Math.round(seed.demand * (0.4 + random() * 1.2) * weekendBoost * factor);
        const sold = Math.min(wanted, get(product.id, store.id));
        if (sold > 0) {
          await registerExit(
            {
              productId: product.id,
              warehouseId: store.id,
              quantity: sold,
              reason: 'Venda',
              documentRef: `Cupom ${receiptNumber++}`,
            },
            operator.id,
            { occurredAt: tick() },
          );
          add(product.id, store.id, -sold);
        }

        if (random() < 0.015 && get(product.id, store.id) > 0) {
          await registerExit(
            {
              productId: product.id,
              warehouseId: store.id,
              quantity: 1,
              reason: random() < 0.5 ? 'Avaria' : 'Vencimento',
            },
            operator.id,
            { occurredAt: tick() },
          );
          add(product.id, store.id, -1);
        }
      }
    }
  }

  // Um alerta já reconhecido pelo gerente, para mostrar o fluxo de ciência.
  const firstAlert = await prisma.stockAlert.findFirst({ where: { status: 'OPEN' }, orderBy: { createdAt: 'asc' } });
  if (firstAlert) {
    await prisma.stockAlert.update({
      where: { id: firstAlert.id },
      data: { acknowledgedAt: new Date(), acknowledgedById: manager.id },
    });
  }

  log('📋 Inventário em andamento na Loja Bairro Novo...');
  const inventory = await openInventory({ warehouseId: stores[1].id, category: 'Bebidas' }, manager.id);
  const items = await prisma.inventoryItem.findMany({ where: { inventoryId: inventory.id } });
  for (const [index, item] of items.slice(0, 2).entries()) {
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: { countedQuantity: Math.max(0, item.expectedQuantity - index), countedAt: new Date() },
    });
  }

  const [movementCount, openAlerts, resolvedAlerts] = await Promise.all([
    prisma.stockMovement.count(),
    prisma.stockAlert.count({ where: { status: 'OPEN' } }),
    prisma.stockAlert.count({ where: { status: 'RESOLVED' } }),
  ]);

  return { products: products.length, movements: movementCount, openAlerts, resolvedAlerts };
}
