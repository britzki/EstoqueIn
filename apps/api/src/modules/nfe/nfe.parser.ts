import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { badRequest } from '../../lib/errors.js';
import { isValidGtin } from '../../lib/barcode.js';

/**
 * Leitura do XML da NF-e (modelo 55, layout 4.00), o arquivo que o fornecedor envia
 * junto com a nota. Só os campos relevantes para o estoque são extraídos.
 */

export interface NfeItem {
  /** Número do item na nota (nItem). */
  index: number;
  /** Código do produto no sistema do fornecedor (cProd). */
  code: string;
  description: string;
  barcode: string | null;
  ncm: string | null;
  cfop: string | null;
  /** Unidade comercial da nota (ex.: CX, UN, KG). */
  unit: string;
  quantity: number;
  unitPriceCents: number;
  productCents: number;
  /** Frete, seguro, outras despesas, IPI e ICMS-ST do item, menos o desconto. */
  extraCostsCents: number;
  /** Custo total do item para o estoque (produto + extras). */
  totalCostCents: number;
}

export interface NfeDocument {
  accessKey: string;
  model: string;
  number: string;
  series: string;
  issuedAt: Date;
  /** Tem protocolo de autorização da SEFAZ (nfeProc com cStat 100/150). */
  authorized: boolean;
  supplier: { document: string; name: string; tradeName: string | null; phone: string | null; city: string | null };
  totalCents: number;
  items: NfeItem[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  // Mantém tudo como texto: códigos como cEAN e CNPJ têm zeros à esquerda.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => name === 'det',
});

type Node = Record<string, unknown>;

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

const cents = (value: unknown) => {
  const raw = text(value);
  if (!raw) return 0;
  const number = Number(raw);
  if (!Number.isFinite(number)) throw badRequest(`Valor inválido no XML: ${raw}`);
  return Math.round(number * 100);
};

/** Procura uma tag em qualquer nível (ex.: vICMSST fica dentro de ICMS10, ICMS70, ICMSSN202...). */
function findDeep(node: unknown, key: string): unknown {
  if (!node || typeof node !== 'object') return undefined;
  if (key in (node as Node)) return (node as Node)[key];
  for (const child of Object.values(node as Node)) {
    const found = findDeep(child, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Dígito verificador da chave de acesso (módulo 11, pesos 2 a 9). */
export function isValidAccessKey(key: string) {
  if (!/^\d{44}$/.test(key)) return false;
  let weight = 2;
  let sum = 0;
  for (let i = 42; i >= 0; i--) {
    sum += Number(key[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  const digit = remainder < 2 ? 0 : 11 - remainder;
  return digit === Number(key[43]);
}

const normalizeUnit = (unit: string) => {
  const clean = unit.trim().toUpperCase().slice(0, 10);
  return ['UNID', 'UND', 'UNIDADE', 'UNI', 'UNIT'].includes(clean) ? 'UN' : clean || 'UN';
};

export function parseNfeXml(xml: string): NfeDocument {
  if (!xml.includes('<')) throw badRequest('O arquivo não é um XML');
  const validation = XMLValidator.validate(xml);
  if (validation !== true) throw badRequest(`XML inválido: ${validation.err.msg} (linha ${validation.err.line})`);

  const root = parser.parse(xml) as Node;
  const proc = root.nfeProc as Node | undefined;
  const nfe = (proc?.NFe ?? root.NFe) as Node | undefined;
  const inf = nfe?.infNFe as Node | undefined;
  if (!inf) throw badRequest('O arquivo não é o XML de uma NF-e (tag infNFe não encontrada)');

  const accessKey = String(inf['@_Id'] ?? '').replace(/^NFe/, '');
  if (!isValidAccessKey(accessKey)) throw badRequest('Chave de acesso da NF-e inválida');

  const ide = (inf.ide ?? {}) as Node;
  const model = text(ide.mod) ?? '';
  if (model !== '55') {
    throw badRequest(
      model === '65' ? 'NFC-e (cupom de venda) não serve para entrada de mercadoria' : 'Somente NF-e modelo 55',
    );
  }

  const emit = (inf.emit ?? {}) as Node;
  const address = (emit.enderEmit ?? {}) as Node;
  const document = text(emit.CNPJ) ?? text(emit.CPF);
  if (!document) throw badRequest('CNPJ/CPF do emitente não encontrado na nota');

  const issued = text(ide.dhEmi) ?? text(ide.dEmi);
  const issuedAt = issued ? new Date(issued) : new Date(NaN);
  if (Number.isNaN(issuedAt.getTime())) throw badRequest('Data de emissão inválida na nota');

  const status = text(findDeep(proc?.protNFe, 'cStat'));

  const details = (inf.det ?? []) as Node[];
  if (details.length === 0) throw badRequest('A nota não possui itens');

  const items = details.map((det): NfeItem => {
    const prod = (det.prod ?? {}) as Node;
    const tax = (det.imposto ?? {}) as Node;
    const quantity = Number(text(prod.qCom) ?? NaN);
    if (!Number.isFinite(quantity) || quantity <= 0) throw badRequest(`Quantidade inválida no item ${det['@_nItem']}`);

    const ean = [text(prod.cEAN), text(prod.cEANTrib)].find((code) => code && isValidGtin(code)) ?? null;
    const productCents = cents(prod.vProd);
    const extraCostsCents =
      cents(prod.vFrete) +
      cents(prod.vSeg) +
      cents(prod.vOutro) -
      cents(prod.vDesc) +
      cents(findDeep(tax.IPI, 'vIPI')) +
      cents(findDeep(tax.ICMS, 'vICMSST'));

    return {
      index: Number(det['@_nItem']),
      code: text(prod.cProd) ?? String(det['@_nItem']),
      description: text(prod.xProd) ?? 'Sem descrição',
      barcode: ean,
      ncm: text(prod.NCM),
      cfop: text(prod.CFOP),
      unit: normalizeUnit(text(prod.uCom) ?? 'UN'),
      quantity,
      unitPriceCents: cents(prod.vUnCom),
      productCents,
      extraCostsCents,
      totalCostCents: productCents + extraCostsCents,
    };
  });

  return {
    accessKey,
    model,
    number: text(ide.nNF) ?? '',
    series: text(ide.serie) ?? '',
    issuedAt,
    authorized: status === '100' || status === '150',
    supplier: {
      document: document.replace(/\D/g, ''),
      name: text(emit.xNome) ?? 'Fornecedor sem nome',
      tradeName: text(emit.xFant),
      phone: text(address.fone),
      city: [text(address.xMun), text(address.UF)].filter(Boolean).join('/') || null,
    },
    totalCents: cents(findDeep(inf.total, 'vNF')),
    items,
  };
}

/** 11222333000101 → 11.222.333/0001-01 (CPF: 123.456.789-01). */
export function formatDocument(digits: string) {
  if (digits.length === 14) return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (digits.length === 11) return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return digits;
}
