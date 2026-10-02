/**
 * Cliente da Open Food Facts (https://world.openfoodfacts.org), base pública e gratuita de produtos.
 * Usado para sugerir nome, marca e categoria ao cadastrar um produto pelo código de barras.
 */
export interface BarcodeLookupResult {
  found: boolean;
  source: 'openfoodfacts';
  barcode: string;
  name?: string;
  brand?: string;
  category?: string;
  quantity?: string;
  imageUrl?: string;
}

interface OffResponse {
  status: number;
  product?: {
    product_name_pt?: string;
    product_name?: string;
    brands?: string;
    categories?: string;
    quantity?: string;
    image_front_small_url?: string;
  };
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; value: BarcodeLookupResult }>();

export class ExternalServiceError extends Error {}

export async function lookupBarcode(barcode: string): Promise<BarcodeLookupResult> {
  const cached = cache.get(barcode);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const url = new URL(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`);
  url.searchParams.set('fields', 'product_name,product_name_pt,brands,categories,quantity,image_front_small_url');

  let response: Response;
  try {
    response = await fetch(url, {
      // A Open Food Facts pede um User-Agent identificando a aplicação.
      headers: { 'User-Agent': 'EstoqueIn/1.0 (projeto de portfolio)' },
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    throw new ExternalServiceError(`Falha ao consultar Open Food Facts: ${(error as Error).message}`);
  }

  if (response.status === 404) return remember(barcode, { found: false, source: 'openfoodfacts', barcode });
  if (!response.ok) throw new ExternalServiceError(`Open Food Facts respondeu ${response.status}`);

  const body = (await response.json()) as OffResponse;
  const product = body.product;
  if (body.status !== 1 || !product) return remember(barcode, { found: false, source: 'openfoodfacts', barcode });

  return remember(barcode, {
    found: true,
    source: 'openfoodfacts',
    barcode,
    name: product.product_name_pt || product.product_name || undefined,
    brand: product.brands?.split(',')[0]?.trim() || undefined,
    // A última categoria costuma ser a mais específica; ignora tags com prefixo de idioma (ex.: "fr:...").
    category:
      product.categories
        ?.split(',')
        .map((category) => category.trim())
        .filter((category) => category && !category.includes(':'))
        .at(-1) || undefined,
    quantity: product.quantity || undefined,
    imageUrl: product.image_front_small_url || undefined,
  });
}

function remember(barcode: string, value: BarcodeLookupResult) {
  cache.set(barcode, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}

export const clearBarcodeCache = () => cache.clear();
