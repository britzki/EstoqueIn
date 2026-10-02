/** Gera XMLs de NF-e (layout 4.00) para testes e para o arquivo de exemplo do repositório. */

export interface FixtureItem {
  code: string;
  description: string;
  ean?: string;
  unit?: string;
  quantity: number;
  unitPrice: number;
  freight?: number;
  discount?: number;
  ipi?: number;
  icmsSt?: number;
}

export interface FixtureNfe {
  number: number;
  series?: number;
  cnpj: string;
  supplierName: string;
  issuedAt?: string;
  authorized?: boolean;
  items: FixtureItem[];
}

const money = (value: number) => value.toFixed(2);

/** Monta a chave de acesso de 44 dígitos com o dígito verificador (módulo 11). */
export function buildAccessKey({ cnpj, number, series = 1, issuedAt = '2026-09-28' }: FixtureNfe) {
  const body =
    '35' +
    issuedAt.slice(2, 4) +
    issuedAt.slice(5, 7) +
    cnpj.padStart(14, '0') +
    '55' +
    String(series).padStart(3, '0') +
    String(number).padStart(9, '0') +
    '1' +
    String(number * 7919)
      .slice(-8)
      .padStart(8, '0');
  let weight = 2;
  let sum = 0;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return body + (remainder < 2 ? 0 : 11 - remainder);
}

export function buildNfeXml(nfe: FixtureNfe) {
  const key = buildAccessKey(nfe);
  const issuedAt = `${nfe.issuedAt ?? '2026-09-28'}T09:30:00-03:00`;

  const details = nfe.items
    .map((item, index) => {
      const total = item.quantity * item.unitPrice;
      return `
      <det nItem="${index + 1}">
        <prod>
          <cProd>${item.code}</cProd>
          <cEAN>${item.ean ?? 'SEM GTIN'}</cEAN>
          <xProd>${item.description}</xProd>
          <NCM>09012100</NCM>
          <CFOP>5102</CFOP>
          <uCom>${item.unit ?? 'UN'}</uCom>
          <qCom>${item.quantity.toFixed(4)}</qCom>
          <vUnCom>${item.unitPrice.toFixed(10)}</vUnCom>
          <vProd>${money(total)}</vProd>
          <cEANTrib>${item.ean ?? 'SEM GTIN'}</cEANTrib>
          <uTrib>${item.unit ?? 'UN'}</uTrib>
          <qTrib>${item.quantity.toFixed(4)}</qTrib>
          <vUnTrib>${item.unitPrice.toFixed(10)}</vUnTrib>${item.freight ? `\n          <vFrete>${money(item.freight)}</vFrete>` : ''}${item.discount ? `\n          <vDesc>${money(item.discount)}</vDesc>` : ''}
          <indTot>1</indTot>
        </prod>
        <imposto>
          <ICMS>
            <ICMS10>
              <orig>0</orig>
              <CST>10</CST>
              <vICMSST>${money(item.icmsSt ?? 0)}</vICMSST>
            </ICMS10>
          </ICMS>
          <IPI>
            <cEnq>999</cEnq>
            <IPITrib><CST>50</CST><vIPI>${money(item.ipi ?? 0)}</vIPI></IPITrib>
          </IPI>
        </imposto>
      </det>`;
    })
    .join('');

  const total = nfe.items.reduce(
    (sum, item) =>
      sum +
      item.quantity * item.unitPrice +
      (item.freight ?? 0) -
      (item.discount ?? 0) +
      (item.ipi ?? 0) +
      (item.icmsSt ?? 0),
    0,
  );

  const nfeXml = `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe Id="NFe${key}" versao="4.00">
      <ide>
        <cUF>35</cUF>
        <natOp>VENDA DE MERCADORIA</natOp>
        <mod>55</mod>
        <serie>${nfe.series ?? 1}</serie>
        <nNF>${nfe.number}</nNF>
        <dhEmi>${issuedAt}</dhEmi>
        <tpNF>1</tpNF>
      </ide>
      <emit>
        <CNPJ>${nfe.cnpj}</CNPJ>
        <xNome>${nfe.supplierName}</xNome>
        <enderEmit><xMun>Sao Paulo</xMun><UF>SP</UF><fone>1140001001</fone></enderEmit>
      </emit>
      <dest><CNPJ>99888777000166</CNPJ><xNome>MERCADINHO EXEMPLO LTDA</xNome></dest>${details}
      <total><ICMSTot><vNF>${money(total)}</vNF></ICMSTot></total>
    </infNFe>
  </NFe>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  ${nfeXml}${
    nfe.authorized === false
      ? ''
      : `
  <protNFe versao="4.00"><infProt><chNFe>${key}</chNFe><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>`
  }
</nfeProc>
`;
}
