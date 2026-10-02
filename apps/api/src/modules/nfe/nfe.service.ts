import { z } from 'zod';
import type { Role } from '@prisma/client';
import { prisma, type Tx } from '../../lib/prisma.js';
import { AppError, badRequest, conflict, notFound, unprocessable } from '../../lib/errors.js';
import { id, nonNegativeInt, optionalText } from '../../lib/validation.js';
import { FRACTIONAL_UNITS, isWholeNumber, nonNegativeQty, positiveQty, roundQty } from '../../lib/quantity.js';
import { can } from '../../auth/permissions.js';
import { applyEntry } from '../stock/stock.service.js';
import { publishAlertChanges, type AlertChange } from '../alerts/alerts.service.js';
import { barcodeSchema, skuSchema } from '../products/products.schemas.js';
import { formatDocument, parseNfeXml, type NfeDocument, type NfeItem } from './nfe.parser.js';

const onlyDigits = (value: string) => value.replace(/\D/g, '');

// Recebe o cliente da transação quando chamada dentro dela: no desktop há uma única conexão
// com o banco, e uma consulta fora da transação aberta ficaria esperando para sempre.
async function findSupplierByDocument(document: string, client: Tx = prisma) {
  const suppliers = await client.supplier.findMany({
    where: { document: { not: null } },
    select: { id: true, name: true, document: true },
  });
  return suppliers.find((supplier) => onlyDigits(supplier.document!) === document) ?? null;
}

async function findImport(accessKey: string) {
  return prisma.nfeImport.findUnique({
    where: { accessKey },
    select: { id: true, createdAt: true, user: { select: { name: true } } },
  });
}

/**
 * Sugere o fator de conversão pela descrição da embalagem, comum nas notas:
 * "FD C/6", "CX C/ 12", "CAIXA COM 24 UN"; dúzia (DZ) vale 12.
 */
export function guessConversionFactor(item: Pick<NfeItem, 'unit' | 'description'>) {
  if (['UN', 'KG', 'G', 'L', 'ML', 'M'].includes(item.unit)) return 1;
  if (item.unit === 'DZ') return 12;
  const match =
    item.description.match(/\bC\/\s*(\d{1,4})\b/i) ??
    item.description.match(/\bCOM\s+(\d{1,4})\s*(?:UN|UND|UNID|UNIDADES)\b/i);
  const factor = match ? Number(match[1]) : 1;
  return factor >= 1 ? factor : 1;
}

const tokens = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !['de', 'da', 'do', 'e', 'com', 'c'].includes(token));

/**
 * Procura um produto cujo nome esteja contido na descrição da nota
 * (ex.: "Arroz branco tipo 1 5kg" em "ARROZ BRANCO TIPO 1 5KG FD C/6").
 * Exige todas as palavras do nome e um único candidato, para não sugerir errado.
 */
export function findByName<T extends { name: string }>(description: string, products: T[]): T | undefined {
  const words = new Set(tokens(description));
  const candidates = products.filter((product) => {
    const name = tokens(product.name);
    return name.length >= 2 && name.every((token) => words.has(token));
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** Sugestão de SKU a partir do código do fornecedor, sem repetir SKUs já existentes. */
function suggestSku(item: NfeItem, number: string, taken: Set<string>) {
  const base =
    item.code
      .toUpperCase()
      .replace(/[^A-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || `NF${number}-${item.index}`;
  let sku = base;
  for (let n = 2; taken.has(sku); n++) sku = `${base}-${n}`;
  taken.add(sku);
  return sku;
}

/**
 * Lê a nota e tenta reconhecer cada item, sem gravar nada:
 * 1º pelo código do fornecedor (aprendido em notas anteriores, com o fator de conversão);
 * 2º pelo código de barras;
 * 3º por semelhança de nome (só uma sugestão, que o usuário confirma).
 */
export async function previewNfe(xml: string) {
  const nfe = parseNfeXml(xml);
  const supplier = await findSupplierByDocument(nfe.supplier.document);
  const codes = nfe.items.map((item) => item.code);
  const barcodes = nfe.items.flatMap((item) => (item.barcode ? [item.barcode] : []));

  const productFields = {
    id: true,
    sku: true,
    name: true,
    unit: true,
    barcode: true,
    active: true,
    fractional: true,
  } as const;
  const [alreadyImported, mappings, byBarcode, catalog] = await Promise.all([
    findImport(nfe.accessKey),
    supplier
      ? prisma.supplierProduct.findMany({
          where: { supplierId: supplier.id, supplierCode: { in: codes } },
          include: { product: { select: productFields } },
        })
      : [],
    prisma.product.findMany({ where: { barcode: { in: barcodes } }, select: productFields }),
    prisma.product.findMany({ select: productFields }),
  ]);

  const takenSkus = new Set(catalog.map((product) => product.sku));
  const activeCatalog = catalog.filter((product) => product.active);

  const items = nfe.items.map((item) => {
    const mapping = mappings.find((m) => m.supplierCode === item.code);
    const barcodeMatch = item.barcode ? byBarcode.find((product) => product.barcode === item.barcode) : undefined;
    const conversionFactor = guessConversionFactor(item);
    const nameMatch = !mapping && !barcodeMatch ? findByName(item.description, activeCatalog) : undefined;
    const match = mapping
      ? { by: 'supplierCode' as const, product: mapping.product, conversionFactor: mapping.conversionFactor }
      : barcodeMatch
        ? { by: 'barcode' as const, product: barcodeMatch, conversionFactor: 1 }
        : nameMatch
          ? { by: 'name' as const, product: nameMatch, conversionFactor }
          : null;

    return {
      ...item,
      match,
      suggestion: {
        sku: suggestSku(item, nfe.number, takenSkus),
        name: item.description.slice(0, 150),
        // Com conversão (caixa, fardo...), o estoque conta a unidade de dentro da embalagem.
        unit: conversionFactor > 1 ? 'UN' : item.unit,
        conversionFactor,
        // Só sugere o código de barras se nenhum outro produto já o usa.
        barcode: item.barcode && !barcodeMatch ? item.barcode : null,
      },
    };
  });

  return {
    ...header(nfe),
    supplier: { ...nfe.supplier, documentFormatted: formatDocument(nfe.supplier.document), existing: supplier },
    alreadyImported,
    items,
  };
}

const header = (nfe: NfeDocument) => ({
  accessKey: nfe.accessKey,
  number: nfe.number,
  series: nfe.series,
  issuedAt: nfe.issuedAt,
  authorized: nfe.authorized,
  totalCents: nfe.totalCents,
});

export const importDecisionsSchema = z.object({
  warehouseId: id,
  items: z
    .array(
      z.object({
        index: z.number().int(),
        action: z.enum(['link', 'create', 'skip']),
        productId: z.string().optional(),
        conversionFactor: positiveQty.default(1),
        product: z
          .object({
            sku: skuSchema,
            name: z.string().trim().min(2, 'Informe o nome').max(150),
            barcode: barcodeSchema,
            category: optionalText(60),
            unit: z.string().trim().toUpperCase().min(1).max(10),
            priceCents: nonNegativeInt.optional(),
            minStock: nonNegativeQty.optional(),
            fractional: z.boolean().optional(),
          })
          .optional(),
      }),
    )
    .min(1),
});

export type ImportDecisions = z.infer<typeof importDecisionsSchema>;

/**
 * Importa a nota: cadastra o fornecedor (se novo) e os produtos novos, guarda o vínculo
 * código do fornecedor → produto e dá entrada de cada item no estoque, tudo numa única
 * transação. O XML é relido aqui: quantidades e custos vêm sempre da nota, nunca do navegador.
 */
export async function importNfe(xml: string, decisions: ImportDecisions, user: { id: string; role: Role }) {
  const nfe = parseNfeXml(xml);
  const decisionByIndex = new Map(decisions.items.map((decision) => [decision.index, decision]));

  // Só produtos fracionados (kg, L...) aceitam quantidade com casas decimais.
  const linkedIds = decisions.items.flatMap((d) => (d.action === 'link' && d.productId ? [d.productId] : []));
  const linked = await prisma.product.findMany({
    where: { id: { in: linkedIds } },
    select: { id: true, fractional: true },
  });
  const acceptsFraction = (decision: ImportDecisions['items'][number]) =>
    decision.action === 'create'
      ? (decision.product?.fractional ?? FRACTIONAL_UNITS.includes(decision.product?.unit ?? 'UN'))
      : (linked.find((product) => product.id === decision.productId)?.fractional ?? false);

  const lines = nfe.items.map((item) => {
    const decision = decisionByIndex.get(item.index);
    if (!decision) throw badRequest(`Falta definir o que fazer com o item ${item.index} (${item.description})`);
    if (decision.action === 'link' && !decision.productId) throw badRequest(`Escolha o produto do item ${item.index}`);
    if (decision.action === 'create' && !decision.product)
      throw badRequest(`Informe os dados do novo produto do item ${item.index}`);

    const quantity = roundQty(item.quantity * decision.conversionFactor);
    if (decision.action !== 'skip' && !acceptsFraction(decision) && !isWholeNumber(quantity)) {
      throw unprocessable(
        `Item ${item.index} (${item.description}): ${item.quantity} ${item.unit} × ${decision.conversionFactor} = ${quantity}. ` +
          'Este produto é controlado em unidades inteiras; ajuste o fator de conversão ou marque o produto como fracionado.',
        'FRACTIONAL_QUANTITY',
      );
    }
    return { item, decision, quantity };
  });

  const active = lines.filter((line) => line.decision.action !== 'skip');
  if (active.length === 0) throw badRequest('Nenhum item selecionado para entrada');

  const creates = active.filter((line) => line.decision.action === 'create');
  if (creates.length && !can(user.role, 'products:write')) {
    throw new AppError(
      403,
      'Seu perfil não pode cadastrar produtos. Vincule os itens a produtos existentes.',
      'FORBIDDEN',
    );
  }
  const newSkus = creates.map((line) => line.decision.product!.sku);
  const duplicated = await prisma.product.findMany({ where: { sku: { in: newSkus } }, select: { sku: true } });
  if (duplicated.length || new Set(newSkus).size !== newSkus.length) {
    throw conflict(`SKU já existente: ${duplicated.map((p) => p.sku).join(', ') || 'repetido na nota'}`);
  }

  const result = await prisma.$transaction(
    async (tx) => {
      const previous = await tx.nfeImport.findUnique({ where: { accessKey: nfe.accessKey } });
      if (previous) throw conflict('Esta NF-e já foi importada');

      let supplierCreated = false;
      let supplier = await findSupplierByDocument(nfe.supplier.document, tx);
      if (!supplier) {
        supplierCreated = true;
        supplier = await tx.supplier.create({
          data: {
            name: nfe.supplier.name,
            document: formatDocument(nfe.supplier.document),
            phone: nfe.supplier.phone,
            notes: `Cadastrado automaticamente pela NF-e ${nfe.number}${nfe.supplier.city ? ` · ${nfe.supplier.city}` : ''}`,
          },
          select: { id: true, name: true, document: true },
        });
      }

      const nfeImport = await tx.nfeImport.create({
        data: {
          accessKey: nfe.accessKey,
          number: nfe.number,
          series: nfe.series,
          issuedAt: nfe.issuedAt,
          supplierId: supplier.id,
          warehouseId: decisions.warehouseId,
          userId: user.id,
          totalCents: nfe.totalCents,
          itemCount: active.length,
        },
      });

      const alerts: AlertChange[] = [];
      const items = [];
      for (const { item, decision, quantity } of active) {
        let productId = decision.productId;
        if (decision.action === 'create') {
          const data = decision.product!;
          const created = await tx.product.create({
            data: {
              sku: data.sku,
              name: data.name,
              barcode: data.barcode ?? null,
              category: data.category ?? null,
              unit: data.unit,
              fractional: data.fractional ?? FRACTIONAL_UNITS.includes(data.unit),
              priceCents: data.priceCents ?? 0,
              minStock: data.minStock ?? 0,
              supplierId: supplier.id,
            },
          });
          productId = created.id;
        } else if (!(await tx.product.findUnique({ where: { id: productId! } }))) {
          throw notFound(`Produto do item ${item.index}`);
        }

        await tx.supplierProduct.upsert({
          where: { supplierId_supplierCode: { supplierId: supplier.id, supplierCode: item.code } },
          create: {
            supplierId: supplier.id,
            supplierCode: item.code,
            productId: productId!,
            conversionFactor: decision.conversionFactor,
            description: item.description,
          },
          update: { productId: productId!, conversionFactor: decision.conversionFactor, description: item.description },
        });

        const entry = await applyEntry(
          tx,
          {
            productId: productId!,
            warehouseId: decisions.warehouseId,
            quantity,
            unitCostCents: Math.round(item.totalCostCents / quantity),
            supplierId: supplier.id,
            documentRef: `NF ${nfe.number}${nfe.series ? `/${nfe.series}` : ''}`,
            reason: 'Entrada por NF-e',
          },
          user.id,
          { nfeImportId: nfeImport.id },
        );
        alerts.push(entry.alert);
        items.push({
          index: item.index,
          productId: productId!,
          created: decision.action === 'create',
          quantity,
          balance: entry.balance,
          unitCostCents: entry.movement.unitCostCents,
          alert: entry.alert.kind,
        });
      }

      return { importId: nfeImport.id, supplier: { ...supplier, created: supplierCreated }, items, alerts };
    },
    { timeout: 60_000 },
  );

  publishAlertChanges(result.alerts);
  return {
    ...header(nfe),
    importId: result.importId,
    supplier: result.supplier,
    items: result.items,
    summary: {
      items: result.items.length,
      skipped: lines.length - active.length,
      createdProducts: result.items.filter((item) => item.created).length,
      units: roundQty(result.items.reduce((sum, item) => sum + item.quantity, 0)),
      alertsResolved: result.alerts.filter((alert) => alert.kind === 'resolved').length,
      alertsOpened: result.alerts.filter((alert) => alert.kind === 'opened' || alert.kind === 'escalated').length,
    },
  };
}
