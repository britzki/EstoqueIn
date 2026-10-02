import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { clearBarcodeCache } from '../src/modules/integrations/open-food-facts.js';
import { api, createScenario, resetDatabase } from './helpers.js';

let s: Awaited<ReturnType<typeof createScenario>>;

beforeEach(async () => {
  await resetDatabase();
  s = await createScenario();
});

const csv = (lines: string[]) => Buffer.from(lines.join('\n'), 'utf-8');

describe('Importação de produtos via CSV', () => {
  const file = csv([
    'SKU;Nome;Código de barras;Categoria;Preço custo;Preço venda;Estoque mínimo',
    'ARR-5KG;Arroz 5kg;;Mercearia;21,50;29,90;10',
    'CAF-500;Café 500g (atualizado);;Mercearia;15,00;23,90;12',
    ';Sem SKU;;;;;',
    'FEI-1KG;Feijão;7891234567890;Mercearia;6,80;9,49;15',
    'ARR-5KG;Arroz duplicado;;;;;',
  ]);

  it('simula (dry run) sem gravar e aponta os erros por linha', async () => {
    const res = await api()
      .post('/api/products/import?dryRun=true')
      .set(s.admin.auth)
      .attach('file', file, 'produtos.csv');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dryRun: true, totalRows: 5, created: 1, updated: 1 });
    expect(res.body.errors.map((e: { line: number }) => e.line)).toEqual([4, 5, 6]);
    expect(res.body.errors[1].message).toMatch(/verificador/);
    expect(await prisma.product.count()).toBe(1);
  });

  it('importa as linhas válidas, cria e atualiza por SKU', async () => {
    const res = await api().post('/api/products/import').set(s.admin.auth).attach('file', file, 'produtos.csv');

    expect(res.status).toBe(201);
    const rice = await prisma.product.findUniqueOrThrow({ where: { sku: 'ARR-5KG' } });
    expect(rice).toMatchObject({ name: 'Arroz 5kg', costCents: 2150, priceCents: 2990, minStock: 10 });

    const coffee = await prisma.product.findUniqueOrThrow({ where: { sku: 'CAF-500' } });
    expect(coffee).toMatchObject({ name: 'Café 500g (atualizado)', barcode: '7891234567895' });
  });

  it('aceita CSV separado por vírgula com cabeçalho em inglês', async () => {
    const res = await api()
      .post('/api/products/import')
      .set(s.admin.auth)
      .attach('file', csv(['sku,name,price', 'AGU-1L5,Água 1.5L,3.29']), 'products.csv');

    expect(res.body.created).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { sku: 'AGU-1L5' } })).priceCents).toBe(329);
  });

  it('exige a permissão de importação', async () => {
    const res = await api().post('/api/products/import').set(s.operator.auth).attach('file', file, 'produtos.csv');
    expect(res.status).toBe(403);
  });
});

describe('Produtos e código de barras', () => {
  it('rejeita EAN com dígito verificador inválido', async () => {
    const res = await api()
      .post('/api/products')
      .set(s.admin.auth)
      .send({ sku: 'X-1', name: 'Produto X', barcode: '7891234567891' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.barcode).toBeDefined();
  });

  it('gera um EAN-13 interno (prefixo 2) para produto sem código', async () => {
    const { body: product } = await api()
      .post('/api/products')
      .set(s.admin.auth)
      .send({ sku: 'X-2', name: 'Produto Y' });
    const res = await api().post(`/api/products/${product.id}/barcode`).set(s.admin.auth);

    expect(res.status).toBe(200);
    expect(res.body.barcode).toMatch(/^2\d{12}$/);
  });

  it('busca o produto pelo código de barras', async () => {
    const res = await api().get('/api/products/by-barcode/7891234567895').set(s.operator.auth);
    expect(res.status).toBe(200);
    expect(res.body.sku).toBe('CAF-500');
  });

  it('alterar o mínimo do produto reavalia os alertas existentes', async () => {
    await api()
      .post('/api/stock/entries')
      .set(s.operator.auth)
      .send({ productId: s.product.id, warehouseId: s.depot.id, quantity: 20 });
    expect(await prisma.stockAlert.count()).toBe(0);

    await api().patch(`/api/products/${s.product.id}`).set(s.admin.auth).send({ minStock: 25 }).expect(200);
    expect(await prisma.stockAlert.count({ where: { status: 'OPEN' } })).toBe(1);
  });

  it('consulta dados do produto na Open Food Facts (API externa mockada)', async () => {
    clearBarcodeCache();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 1,
          product: { product_name: 'Nutella', brands: 'Ferrero', categories: 'Spreads, Cocoa spreads' },
        }),
        { status: 200 },
      ),
    );

    const res = await api().get('/api/integrations/barcode/3017620422003').set(s.admin.auth);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ found: true, name: 'Nutella', brand: 'Ferrero', category: 'Cocoa spreads' });
    expect(String(fetchMock.mock.calls[0][0])).toContain('3017620422003');
    fetchMock.mockRestore();
  });
});
