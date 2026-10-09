import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { badRequest } from '../../lib/errors.js';
import { parseMoneyToCents } from '../../lib/money.js';
import { FRACTIONAL_UNITS, hasValidPrecision, isWholeNumber, roundQty } from '../../lib/quantity.js';
import { optionalText } from '../../lib/validation.js';
import { adjustTo } from '../stock/stock.service.js';
import { publishAlertChanges, reevaluateProductAlerts, type AlertChange } from '../alerts/alerts.service.js';
import { barcodeSchema, skuSchema } from './products.schemas.js';

const MAX_ROWS = 5000;

type Field =
  | 'sku'
  | 'name'
  | 'barcode'
  | 'category'
  | 'unit'
  | 'description'
  | 'cost'
  | 'price'
  | 'minStock'
  | 'supplierDocument'
  | 'stock'
  | 'fractional'
  | 'scaleCode';

/** Aceita cabeçalhos em português ou inglês, com ou sem acento. */
const HEADER_ALIASES: Record<string, Field> = {
  sku: 'sku',
  nome: 'name',
  produto: 'name',
  name: 'name',
  codigo_barras: 'barcode',
  codigo_de_barras: 'barcode',
  ean: 'barcode',
  gtin: 'barcode',
  barcode: 'barcode',
  categoria: 'category',
  category: 'category',
  unidade: 'unit',
  unit: 'unit',
  descricao: 'description',
  description: 'description',
  preco_custo: 'cost',
  custo: 'cost',
  cost: 'cost',
  preco_venda: 'price',
  preco: 'price',
  price: 'price',
  estoque_minimo: 'minStock',
  minimo: 'minStock',
  min_stock: 'minStock',
  fornecedor_cnpj: 'supplierDocument',
  cnpj_fornecedor: 'supplierDocument',
  // Saldo atual do produto: útil para quem está migrando de outro sistema.
  saldo: 'stock',
  saldo_atual: 'stock',
  saldo_inicial: 'stock',
  estoque: 'stock',
  estoque_atual: 'stock',
  quantidade: 'stock',
  stock: 'stock',
  fracionado: 'fractional',
  vendido_por_peso: 'fractional',
  por_peso: 'fractional',
  codigo_balanca: 'scaleCode',
  codigo_na_balanca: 'scaleCode',
  plu: 'scaleCode',
};

const normalizeHeader = (header: string) =>
  header
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

const onlyDigits = (value: string) => value.replace(/\D/g, '');

const blankToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value);

const money = z.preprocess(
  (value) => {
    const text = blankToUndefined(value);
    return text === undefined ? undefined : (parseMoneyToCents(String(text)) ?? Number.NaN);
  },
  z.number({ error: 'Valor monetário inválido' }).int().min(0, 'Valor não pode ser negativo').optional(),
);

/** Quantidade escrita como na planilha: "12", "2,5" ou "2.5". */
const quantity = (label: string) =>
  z.preprocess(
    (value) => {
      const text = blankToUndefined(value);
      return text === undefined ? undefined : Number(String(text).replace(',', '.'));
    },
    z
      .number({ error: `${label} inválido` })
      .min(0, `${label} não pode ser negativo`)
      .refine(hasValidPrecision, `${label}: use no máximo 3 casas decimais`)
      .optional(),
  );

const yesNo = z.preprocess(
  (value) => {
    const text = blankToUndefined(value);
    if (text === undefined) return undefined;
    const normalized = normalizeHeader(String(text));
    if (['sim', 's', '1', 'true', 'x', 'yes'].includes(normalized)) return true;
    if (['nao', 'n', '0', 'false', 'no'].includes(normalized)) return false;
    return text;
  },
  z.boolean({ error: 'Use "sim" ou "não"' }).optional(),
);

const rowSchema = z.object({
  sku: skuSchema,
  name: z.string({ error: 'Nome obrigatório' }).trim().min(2, 'Nome obrigatório').max(150),
  barcode: barcodeSchema,
  category: optionalText(60),
  unit: z.preprocess(blankToUndefined, z.string().trim().toUpperCase().max(10).optional()),
  description: optionalText(1000),
  cost: money,
  price: money,
  minStock: quantity('Estoque mínimo'),
  supplierDocument: optionalText(20),
  stock: quantity('Saldo'),
  fractional: yesNo,
  scaleCode: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .regex(/^\d{1,6}$/, 'Código da balança deve ter de 1 a 6 dígitos')
      .optional(),
  ),
});

export interface ImportError {
  line: number;
  sku?: string;
  message: string;
}

export interface ImportReport {
  dryRun: boolean;
  totalRows: number;
  created: number;
  updated: number;
  /** Produtos cujo saldo será (ou foi) ajustado para o valor da planilha. */
  stockRows: number;
  errors: ImportError[];
  preview: Array<{ line: number; action: 'create' | 'update'; sku: string; name: string; stock?: number }>;
}

interface ImportOptions {
  dryRun: boolean;
  /** Estoque que recebe os saldos da planilha (obrigatório se houver coluna de saldo). */
  warehouseId?: string;
  userId: string;
}

/** Excel em pt-BR costuma salvar CSV em Windows-1252; tenta UTF-8 primeiro. */
export function decodeCsv(buffer: Buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

function parseCsv(content: string) {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';

  try {
    return parse(content, {
      delimiter,
      bom: true,
      trim: true,
      skip_empty_lines: true,
      relax_column_count: true,
    }) as string[][];
  } catch (error) {
    throw badRequest(`Não foi possível ler o CSV: ${(error as Error).message}`);
  }
}

export async function importProducts(content: string, options: ImportOptions): Promise<ImportReport> {
  const { dryRun, warehouseId, userId } = options;
  const [header, ...rows] = parseCsv(content);
  if (!header || rows.length === 0) throw badRequest('O arquivo não possui linhas de produtos');
  if (rows.length > MAX_ROWS) throw badRequest(`Limite de ${MAX_ROWS} linhas por importação`);

  const fields = header.map((column) => HEADER_ALIASES[normalizeHeader(column)]);
  if (!fields.includes('sku') || !fields.includes('name')) {
    throw badRequest('O cabeçalho precisa conter as colunas "sku" e "nome"');
  }

  const [existing, suppliers, warehouse] = await Promise.all([
    prisma.product.findMany({
      select: {
        sku: true,
        barcode: true,
        scaleCode: true,
        fractional: true,
        isKit: true,
        stockLevels: { select: { quantity: true } },
      },
    }),
    prisma.supplier.findMany({ where: { document: { not: null } }, select: { id: true, document: true } }),
    warehouseId ? prisma.warehouse.findUnique({ where: { id: warehouseId } }) : null,
  ]);
  if (warehouseId && !warehouse?.active) throw badRequest('Estoque dos saldos não encontrado');

  const existingBySku = new Map(existing.map((product) => [product.sku, product]));
  const barcodeOwner = new Map(existing.filter((p) => p.barcode).map((p) => [p.barcode!, p.sku]));
  const scaleOwner = new Map(existing.filter((p) => p.scaleCode).map((p) => [p.scaleCode!, p.sku]));
  const supplierByDocument = new Map(suppliers.map((s) => [onlyDigits(s.document!), s.id]));

  const report: ImportReport = {
    dryRun,
    totalRows: rows.length,
    created: 0,
    updated: 0,
    stockRows: 0,
    errors: [],
    preview: [],
  };
  const seenSkus = new Set<string>();
  const operations: Array<{ sku: string; stock?: number; data: Record<string, unknown>; createFractional: boolean }> =
    [];

  for (const [index, cells] of rows.entries()) {
    const line = index + 2; // +1 do cabeçalho, +1 porque linhas começam em 1
    const raw: Partial<Record<Field, string>> = {};
    fields.forEach((field, column) => {
      if (field) raw[field] = cells[column];
    });

    const fail = (message: string, sku = raw.sku) => report.errors.push({ line, sku, message });

    const parsed = rowSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      fail(`${String(issue.path[0] ?? '')}: ${issue.message}`);
      continue;
    }
    const row = parsed.data;
    const current = existingBySku.get(row.sku);

    if (seenSkus.has(row.sku)) {
      fail('SKU repetido no arquivo', row.sku);
      continue;
    }
    if (row.barcode && barcodeOwner.has(row.barcode) && barcodeOwner.get(row.barcode) !== row.sku) {
      fail(`Código de barras já usado pelo SKU ${barcodeOwner.get(row.barcode)}`, row.sku);
      continue;
    }
    if (row.scaleCode && scaleOwner.has(row.scaleCode) && scaleOwner.get(row.scaleCode) !== row.sku) {
      fail(`Código da balança já usado pelo SKU ${scaleOwner.get(row.scaleCode)}`, row.sku);
      continue;
    }

    let supplierId: string | undefined;
    if (row.supplierDocument) {
      supplierId = supplierByDocument.get(onlyDigits(row.supplierDocument));
      if (!supplierId) {
        fail(`Fornecedor ${row.supplierDocument} não cadastrado`, row.sku);
        continue;
      }
    }

    // Vale a marcação da planilha; sem ela, a unidade (KG, L...) ou o cadastro atual decidem.
    const fractional =
      row.fractional ?? (row.unit ? FRACTIONAL_UNITS.includes(row.unit) : (current?.fractional ?? false));
    // Mesmas regras do cadastro de produtos (o que vale na tela vale na planilha).
    if (current?.isKit && (row.stock !== undefined || fractional)) {
      fail('Kit não tem saldo próprio e é vendido por unidade (o estoque é dos componentes)', row.sku);
      continue;
    }
    if (current?.fractional && !fractional && current.stockLevels.some((level) => !isWholeNumber(level.quantity))) {
      fail('Produto com saldo fracionado não pode passar a ser controlado por unidade', row.sku);
      continue;
    }
    if (row.stock !== undefined && !fractional && !isWholeNumber(row.stock)) {
      fail('Saldo com casas decimais em produto controlado por unidade (marque "fracionado" ou use KG)', row.sku);
      continue;
    }
    if (row.stock !== undefined && !warehouseId) {
      throw badRequest('A planilha tem coluna de saldo: escolha em qual estoque os saldos devem entrar');
    }

    seenSkus.add(row.sku);
    if (row.barcode) barcodeOwner.set(row.barcode, row.sku);
    if (row.scaleCode) scaleOwner.set(row.scaleCode, row.sku);

    const action = current ? 'update' : 'create';
    if (action === 'create') report.created++;
    else report.updated++;
    if (row.stock !== undefined) report.stockRows++;
    if (report.preview.length < 50) {
      report.preview.push({ line, action, sku: row.sku, name: row.name, stock: row.stock });
    }

    operations.push({
      sku: row.sku,
      stock: row.stock === undefined ? undefined : roundQty(row.stock),
      createFractional: fractional,
      // Campos vazios na planilha não apagam o que já está cadastrado.
      data: {
        name: row.name,
        barcode: row.barcode ?? undefined,
        category: row.category ?? undefined,
        unit: row.unit,
        description: row.description ?? undefined,
        costCents: row.cost,
        priceCents: row.price,
        minStock: row.minStock,
        scaleCode: row.scaleCode,
        fractional: row.fractional ?? (row.unit ? FRACTIONAL_UNITS.includes(row.unit) : undefined),
        supplierId,
      },
    });
  }

  if (dryRun || operations.length === 0) return report;

  // Produtos e saldos entram juntos: se algo falhar, nada é gravado.
  const alerts = await prisma.$transaction(
    async (tx) => {
      const changes: AlertChange[] = [];
      for (const { sku, stock, data, createFractional } of operations) {
        const product = await tx.product.upsert({
          where: { sku },
          create: { sku, ...data, name: data.name as string, fractional: createFractional },
          update: data,
        });
        if (stock === undefined || !warehouseId) continue;

        const adjustment = await adjustTo(tx, {
          productId: product.id,
          warehouseId,
          target: stock,
          unitCostCents: product.costCents,
          reason: 'Saldo informado na importação de planilha',
          userId,
        });
        if (adjustment) changes.push(adjustment.alert);
      }
      return changes;
    },
    { timeout: 300_000 },
  );

  publishAlertChanges(alerts);
  // Estoque mínimo alterado pela planilha: abre ou resolve os alertas dos produtos atualizados.
  for (const { sku, data } of operations) {
    const current = existingBySku.get(sku);
    if (data.minStock === undefined || !current) continue;
    const product = await prisma.product.findUnique({ where: { sku }, select: { id: true } });
    if (product) await reevaluateProductAlerts(product.id);
  }
  return report;
}

export const IMPORT_TEMPLATE =
  '\uFEFF' +
  [
    'sku;nome;codigo_barras;categoria;unidade;preco_custo;preco_venda;estoque_minimo;saldo;fracionado;codigo_balanca;descricao',
    'COL-M;Coleira ajustável M;;Acessórios;UN;15,00;34,90;2;12;;;',
    'RAC-15KG;Ração Premium Cães 15kg;;Rações;SC;150,00;219,90;2;4;;;Saco fechado',
    'RAC-GR;Ração Premium Cães a granel;;Rações;KG;10,00;17,90;5;12,5;sim;123;Vendida por peso',
  ].join('\r\n');
