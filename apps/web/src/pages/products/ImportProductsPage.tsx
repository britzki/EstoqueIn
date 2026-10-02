import { useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, CircleCheck, Download, FileSpreadsheet, Upload } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useActiveWarehouses } from '../../lib/hooks';
import { formatNumber } from '../../lib/format';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ErrorMessage,
  LinkButton,
  PageHeader,
  Select,
  Table,
  Td,
  Th,
} from '../../components/ui';

interface ImportReport {
  dryRun: boolean;
  totalRows: number;
  created: number;
  updated: number;
  errors: Array<{ line: number; sku?: string; message: string }>;
  stockRows: number;
  preview: Array<{ line: number; action: 'create' | 'update'; sku: string; name: string; stock?: number }>;
}

const COLUMNS = [
  ['sku', 'Obrigatório. Chave do produto: se já existir, o produto é atualizado.'],
  ['nome', 'Obrigatório.'],
  ['codigo_barras', 'EAN/GTIN com dígito verificador válido.'],
  ['categoria, unidade, descricao', 'Opcionais.'],
  ['preco_custo, preco_venda', 'Aceita 12,50 ou 12.50.'],
  ['estoque_minimo', 'Quantidade mínima antes do alerta.'],
  ['saldo', 'Quantidade atual em estoque. O saldo do produto passa a ser este valor, no estoque escolhido ao lado.'],
  ['fracionado', '"sim" para produto vendido por peso (KG já é assumido).'],
  ['codigo_balanca', 'Código do produto na balança etiquetadora.'],
  ['fornecedor_cnpj', 'Vincula a um fornecedor já cadastrado.'],
];

export function ImportProductsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const { data: warehouses = [] } = useActiveWarehouses();
  const [warehouseId, setWarehouseId] = useState('');
  // Estoque que recebe os saldos da planilha (coluna "saldo").
  const activeWarehouse = warehouseId || warehouses[0]?.id || '';

  const preview = useMutation({
    mutationFn: (input: { file: File; warehouseId: string }) =>
      api.upload<ImportReport>('/products/import', input.file, { dryRun: true, warehouseId: input.warehouseId }),
  });

  const commit = useMutation({
    mutationFn: () => api.upload<ImportReport>('/products/import', file!, { warehouseId: activeWarehouse }),
    onSuccess: (report) => {
      toast.success('Importação concluída', `${report.created} criados, ${report.updated} atualizados.`);
      for (const key of ['product', 'alerts', 'dashboard', 'movements', 'warehouses']) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });

  const choose = (selected: File | undefined) => {
    if (!selected) return;
    setFile(selected);
    commit.reset();
    preview.mutate({ file: selected, warehouseId: activeWarehouse });
  };

  const changeWarehouse = (id: string) => {
    setWarehouseId(id);
    // Refaz a conferência: os saldos dependem do estoque escolhido.
    if (file && !commit.data) preview.mutate({ file, warehouseId: id });
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    choose(event.dataTransfer.files[0]);
  };

  const report = commit.data ?? preview.data;
  const valid = report ? report.created + report.updated : 0;

  return (
    <>
      <Link to="/products" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
        <ChevronLeft className="size-4" /> Produtos
      </Link>
      <PageHeader
        title="Importar produtos"
        description="Cadastre ou atualize vários produtos de uma vez a partir de uma planilha CSV."
        actions={
          <>
            <Select
              value={activeWarehouse}
              onChange={(e) => changeWarehouse(e.target.value)}
              className="w-auto"
              aria-label="Estoque que recebe os saldos"
            >
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  Saldos em: {warehouse.name}
                </option>
              ))}
            </Select>
            <Button
              variant="secondary"
              icon={<Download className="size-4" />}
              onClick={() => api.download('/products/import/template', 'modelo-importacao-produtos.csv')}
            >
              Baixar modelo
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={clsx(
                'm-4 flex flex-col items-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
                dragging ? 'border-brand-600 bg-brand-50' : 'border-slate-300',
              )}
            >
              <FileSpreadsheet className="mb-3 size-10 text-slate-400" />
              <p className="font-medium text-slate-900">{file ? file.name : 'Arraste o arquivo CSV aqui'}</p>
              <p className="mt-1 text-sm text-slate-500">
                Separador ; ou , · UTF-8 ou padrão do Excel · até 5.000 linhas
              </p>
              <Button
                variant="secondary"
                className="mt-4"
                icon={<Upload className="size-4" />}
                onClick={() => inputRef.current?.click()}
                loading={preview.isPending}
              >
                Escolher arquivo
              </Button>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => choose(e.target.files?.[0])}
              />
            </div>
          </Card>

          {(preview.error || commit.error) && <ErrorMessage error={preview.error ?? commit.error} />}

          {report && (
            <Card>
              <CardHeader
                title={report.dryRun ? 'Pré-visualização' : 'Resultado da importação'}
                description={
                  report.dryRun ? 'Nada foi gravado ainda. Confira e confirme.' : 'Os produtos válidos foram gravados.'
                }
                actions={
                  report.dryRun && valid > 0 ? (
                    <Button onClick={() => commit.mutate()} loading={commit.isPending}>
                      Importar {valid} produto{valid > 1 ? 's' : ''}
                    </Button>
                  ) : !report.dryRun ? (
                    <LinkButton to="/products" variant="secondary" icon={<CircleCheck className="size-4" />}>
                      Ver produtos
                    </LinkButton>
                  ) : null
                }
              />
              <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-5">
                {[
                  ['Linhas', report.totalRows],
                  ['Novos', report.created],
                  ['Atualizados', report.updated],
                  ['Saldos', report.stockRows],
                  ['Com erro', report.errors.length],
                ].map(([label, value]) => (
                  <div key={label} className="bg-white px-5 py-3">
                    <p className="text-xs text-slate-500">{label}</p>
                    <p className="text-xl font-semibold tabular-nums">{value}</p>
                  </div>
                ))}
              </div>

              {report.errors.length > 0 && (
                <>
                  <p className="border-t border-slate-100 px-5 pt-4 text-sm font-medium text-red-700">
                    Linhas ignoradas — corrija no arquivo e envie novamente
                  </p>
                  <Table className="mt-2">
                    <thead>
                      <tr>
                        <Th>Linha</Th>
                        <Th>SKU</Th>
                        <Th>Problema</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.errors.map((error) => (
                        <tr key={error.line}>
                          <Td className="tabular-nums">{error.line}</Td>
                          <Td>{error.sku || '—'}</Td>
                          <Td className="text-red-700">{error.message}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </>
              )}

              {report.preview.length > 0 && (
                <Table className="border-t border-slate-100">
                  <thead>
                    <tr>
                      <Th>Linha</Th>
                      <Th>Ação</Th>
                      <Th>SKU</Th>
                      <Th>Nome</Th>
                      <Th className="text-right">Saldo</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.preview.map((row) => (
                      <tr key={row.line}>
                        <Td className="tabular-nums">{row.line}</Td>
                        <Td>
                          {row.action === 'create' ? (
                            <Badge tone="green">Novo</Badge>
                          ) : (
                            <Badge tone="blue">Atualizar</Badge>
                          )}
                        </Td>
                        <Td>{row.sku}</Td>
                        <Td className="text-slate-900">{row.name}</Td>
                        <Td className="text-right tabular-nums">
                          {row.stock === undefined ? '—' : formatNumber(row.stock)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          )}
        </div>

        <Card className="h-fit">
          <CardHeader title="Colunas aceitas" description="Cabeçalhos em português ou inglês, com ou sem acento." />
          <dl className="divide-y divide-slate-100 text-sm">
            {COLUMNS.map(([column, description]) => (
              <div key={column} className="px-5 py-3">
                <dt className="font-mono text-xs font-medium text-slate-900">{column}</dt>
                <dd className="mt-0.5 text-slate-500">{description}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  );
}
