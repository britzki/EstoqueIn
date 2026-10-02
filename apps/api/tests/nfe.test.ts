import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { isValidAccessKey, parseNfeXml } from '../src/modules/nfe/nfe.parser.js';
import { findByName, guessConversionFactor } from '../src/modules/nfe/nfe.service.js';
import { api, createScenario, resetDatabase, stockOf } from './helpers.js';
import { buildAccessKey, buildNfeXml, type FixtureNfe } from './nfe-fixture.js';

let s: Awaited<ReturnType<typeof createScenario>>;

beforeEach(async () => {
  await resetDatabase();
  s = await createScenario();
});

// Fornecedor novo; item 1 tem o mesmo EAN do café do cenário, item 2 é produto novo
// e item 3 vem em caixa (CX) com 12 unidades.
const nfe: FixtureNfe = {
  number: 4521,
  cnpj: '55666777000188',
  supplierName: 'DISTRIBUIDORA NOVA ERA LTDA',
  items: [
    {
      code: 'CF500',
      description: 'CAFE TORRADO 500G',
      ean: '7891234567895',
      quantity: 20,
      unitPrice: 14,
      freight: 10,
      ipi: 4,
    },
    { code: 'AZ500', description: 'AZEITE EXTRA VIRGEM 500ML', quantity: 6, unitPrice: 30, discount: 6 },
    { code: 'DET-CX', description: 'DETERGENTE 500ML CX C/12', unit: 'CX', quantity: 2, unitPrice: 24, icmsSt: 3 },
  ],
};
const xml = buildNfeXml(nfe);

const preview = (content = xml, auth = s.admin.auth) =>
  api().post('/api/nfe/preview').set(auth).attach('file', Buffer.from(content), 'nota.xml');

const importNfe = (decisions: object, content = xml, auth = s.admin.auth) =>
  api()
    .post('/api/nfe/import')
    .set(auth)
    .attach('file', Buffer.from(content), 'nota.xml')
    .field('decisions', JSON.stringify(decisions));

async function createDetergent() {
  return prisma.product.create({ data: { sku: 'DET-500', name: 'Detergente 500ml', minStock: 0 } });
}

describe('Leitura do XML da NF-e', () => {
  it('extrai cabeçalho, fornecedor e itens com custos extras', () => {
    const doc = parseNfeXml(xml);
    expect(doc).toMatchObject({ number: '4521', series: '1', authorized: true, model: '55' });
    expect(doc.supplier).toMatchObject({
      document: '55666777000188',
      name: 'DISTRIBUIDORA NOVA ERA LTDA',
      city: 'Sao Paulo/SP',
    });
    expect(doc.items).toHaveLength(3);
    expect(doc.items[0]).toMatchObject({
      code: 'CF500',
      barcode: '7891234567895',
      quantity: 20,
      productCents: 28000,
      extraCostsCents: 1400,
    });
    expect(doc.items[1]).toMatchObject({ barcode: null, extraCostsCents: -600 });
    expect(doc.items[2]).toMatchObject({ unit: 'CX', quantity: 2, extraCostsCents: 300 });
  });

  it('valida a chave de acesso pelo dígito verificador', () => {
    const key = buildAccessKey(nfe);
    expect(isValidAccessKey(key)).toBe(true);
    expect(isValidAccessKey(key.slice(0, 43) + ((Number(key[43]) + 1) % 10))).toBe(false);
  });

  it('recusa arquivos que não são NF-e', async () => {
    expect((await preview('<html><body>oi</body></html>')).status).toBe(400);
    expect((await preview('não é xml')).status).toBe(400);
    const nfce = xml.replace('<mod>55</mod>', '<mod>65</mod>');
    expect((await preview(nfce)).body.error.message).toMatch(/NFC-e/);
  });
});

describe('Pré-visualização', () => {
  it('reconhece o produto pelo código de barras e sugere cadastro para os demais', async () => {
    const res = await preview();

    expect(res.status).toBe(200);
    expect(res.body.supplier).toMatchObject({ documentFormatted: '55.666.777/0001-88', existing: null });
    expect(res.body.alreadyImported).toBeNull();
    expect(res.body.items[0].match).toMatchObject({ by: 'barcode', product: { id: s.product.id } });
    expect(res.body.items[1].match).toBeNull();
    expect(res.body.items[1].suggestion).toMatchObject({ sku: 'AZ500', name: 'AZEITE EXTRA VIRGEM 500ML', unit: 'UN' });
  });
});

describe('Importação', () => {
  it('cadastra fornecedor e produto, dá entrada com custo real e aprende os códigos', async () => {
    const detergent = await createDetergent();
    const res = await importNfe({
      warehouseId: s.depot.id,
      items: [
        { index: 1, action: 'link', productId: s.product.id },
        {
          index: 2,
          action: 'create',
          product: { sku: 'AZE-500', name: 'Azeite extra virgem 500ml', unit: 'UN', priceCents: 4990, minStock: 3 },
        },
        { index: 3, action: 'link', productId: detergent.id, conversionFactor: 12 },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.supplier).toMatchObject({ name: 'DISTRIBUIDORA NOVA ERA LTDA', created: true });
    expect(res.body.summary).toMatchObject({ items: 3, createdProducts: 1, units: 20 + 6 + 24 });

    // Café: (280 + 10 frete + 4 IPI) / 20 = 14,70
    expect(await stockOf(s.product.id, s.depot.id)).toBe(20);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: s.product.id } })).costCents).toBe(1470);

    // Detergente: 2 CX × 12 = 24 UN; (48 + 3 ST) / 24 = 2,125 → 2,13
    expect(await stockOf(detergent.id, s.depot.id)).toBe(24);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: detergent.id } })).costCents).toBe(213);

    const olive = await prisma.product.findUniqueOrThrow({ where: { sku: 'AZE-500' } });
    expect(olive).toMatchObject({ priceCents: 4990, costCents: 2900, minStock: 3 }); // (180 - 6 desconto) / 6

    const movements = await prisma.stockMovement.findMany({ where: { nfeImportId: res.body.importId } });
    expect(movements).toHaveLength(3);
    expect(movements.every((m) => m.documentRef === 'NF 4521/1' && m.supplierId)).toBe(true);
    expect(await prisma.supplierProduct.count()).toBe(3);
  });

  it('na próxima nota do mesmo fornecedor reconhece os itens pelo código, com o fator', async () => {
    const detergent = await createDetergent();
    await importNfe({
      warehouseId: s.depot.id,
      items: [
        { index: 1, action: 'link', productId: s.product.id },
        { index: 2, action: 'skip' },
        { index: 3, action: 'link', productId: detergent.id, conversionFactor: 12 },
      ],
    }).expect(201);

    const next = buildNfeXml({
      ...nfe,
      number: 4522,
      items: [{ ...nfe.items[2] }, { ...nfe.items[0], ean: undefined }],
    });
    const res = await preview(next);
    expect(res.body.supplier.existing).not.toBeNull();
    expect(res.body.items[0].match).toMatchObject({
      by: 'supplierCode',
      product: { id: detergent.id },
      conversionFactor: 12,
    });
    expect(res.body.items[1].match).toMatchObject({ by: 'supplierCode', product: { id: s.product.id } });
  });

  it('não importa a mesma nota duas vezes', async () => {
    const decisions = {
      warehouseId: s.depot.id,
      items: [1, 2, 3].map((index) => ({ index, action: index === 1 ? 'link' : 'skip', productId: s.product.id })),
    };
    await importNfe(decisions).expect(201);

    const again = await importNfe(decisions);
    expect(again.status).toBe(409);
    expect((await preview()).body.alreadyImported).not.toBeNull();
    expect(await stockOf(s.product.id, s.depot.id)).toBe(20);
  });

  it('recusa fator que gera quantidade fracionada sem gravar nada', async () => {
    const fractional = buildNfeXml({
      ...nfe,
      number: 9,
      items: [{ code: 'QJ', description: 'QUEIJO KG', unit: 'KG', quantity: 2.5, unitPrice: 40 }],
    });
    const res = await importNfe(
      { warehouseId: s.depot.id, items: [{ index: 1, action: 'link', productId: s.product.id }] },
      fractional,
    );

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('FRACTIONAL_QUANTITY');
    expect(await prisma.nfeImport.count()).toBe(0);
    expect(await prisma.supplier.count()).toBe(1);
  });

  it('desfaz tudo se algum item falhar no meio da importação', async () => {
    const res = await importNfe({
      warehouseId: s.depot.id,
      items: [
        { index: 1, action: 'link', productId: s.product.id },
        { index: 2, action: 'link', productId: 'produto-inexistente' },
        { index: 3, action: 'skip' },
      ],
    });

    expect(res.status).toBe(404);
    expect(await stockOf(s.product.id, s.depot.id)).toBe(0);
    expect(await prisma.nfeImport.count()).toBe(0);
  });

  it('operador vincula itens, mas não cadastra produtos novos pela nota', async () => {
    const res = await importNfe(
      {
        warehouseId: s.depot.id,
        items: [
          { index: 1, action: 'link', productId: s.product.id },
          { index: 2, action: 'create', product: { sku: 'NOVO', name: 'Produto novo', unit: 'UN' } },
          { index: 3, action: 'skip' },
        ],
      },
      xml,
      s.operator.auth,
    );
    expect(res.status).toBe(403);
  });

  it('a entrada pela nota resolve o alerta de estoque mínimo', async () => {
    await api()
      .post('/api/stock/entries')
      .set(s.admin.auth)
      .send({ productId: s.product.id, warehouseId: s.depot.id, quantity: 5 })
      .expect(201);
    expect(await prisma.stockAlert.count({ where: { status: 'OPEN' } })).toBe(1);

    const res = await importNfe({
      warehouseId: s.depot.id,
      items: [
        { index: 1, action: 'link', productId: s.product.id },
        { index: 2, action: 'skip' },
        { index: 3, action: 'skip' },
      ],
    });
    expect(res.body.summary.alertsResolved).toBe(1);
    expect(await prisma.stockAlert.count({ where: { status: 'OPEN' } })).toBe(0);
  });
});

describe('Sugestão do fator de conversão', () => {
  it.each([
    ['FD', 'ARROZ BRANCO TIPO 1 5KG FD C/6', 6],
    ['CX', 'DETERGENTE 500ML CX C/ 12', 12],
    ['CX', 'SABONETE 90G CAIXA COM 24 UNIDADES', 24],
    ['DZ', 'OVOS BRANCOS', 12],
    ['UN', 'CAFE 500G C/10', 1],
    ['CX', 'CAIXA SEM INDICAÇÃO', 1],
  ])('%s "%s" → %i', (unit, description, expected) => {
    expect(guessConversionFactor({ unit, description })).toBe(expected);
  });
});

describe('Sugestão por nome', () => {
  const catalog = [
    { name: 'Arroz branco tipo 1 5kg' },
    { name: 'Feijão carioca 1kg' },
    { name: 'Feijão preto 1kg' },
    { name: 'Café 500g' },
  ];

  it('encontra o produto cujo nome está contido na descrição, ignorando acentos', () => {
    expect(findByName('ARROZ BRANCO TIPO 1 5KG FD C/6', catalog)?.name).toBe('Arroz branco tipo 1 5kg');
    expect(findByName('FEIJAO CARIOCA TIPO 1 1KG', catalog)?.name).toBe('Feijão carioca 1kg');
  });

  it('não sugere quando não há correspondência completa ou quando é ambíguo', () => {
    expect(findByName('FEIJAO 1KG', catalog)).toBeUndefined();
    expect(findByName('ARROZ INTEGRAL 1KG', catalog)).toBeUndefined();
    expect(findByName('FEIJAO CARIOCA PRETO 1KG', catalog)).toBeUndefined();
  });

  it('na pré-visualização, sugere o vínculo pelo nome e unidade UN quando há conversão', async () => {
    await prisma.product.create({ data: { sku: 'ARR-5KG', name: 'Arroz branco tipo 1 5kg' } });
    const doc = buildNfeXml({
      ...nfe,
      number: 77,
      items: [
        { code: 'A1', description: 'ARROZ BRANCO TIPO 1 5KG FD C/6', unit: 'FD', quantity: 5, unitPrice: 126 },
        { code: 'S1', description: 'SABONETE 90G CX C/12', unit: 'CX', quantity: 1, unitPrice: 18 },
      ],
    });
    const res = await preview(doc);
    expect(res.body.items[0].match).toMatchObject({ by: 'name', conversionFactor: 6, product: { sku: 'ARR-5KG' } });
    expect(res.body.items[1].match).toBeNull();
    expect(res.body.items[1].suggestion).toMatchObject({ unit: 'UN', conversionFactor: 12 });
  });
});
