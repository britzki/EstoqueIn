import { useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheckBig, FileUp, ReceiptText, TriangleAlert } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { invalidateStock, useActiveWarehouses, useCategories } from '../../lib/hooks';
import { useToast } from '../../lib/toast';
import { cn } from '../../lib/cn';
import { formatDate, formatDateTime, formatMoney, formatNumber, parseMoneyInput } from '../../lib/format';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorMessage,
  LinkButton,
  PageHeader,
  Select,
  Table,
  Td,
  Th,
} from '../../components/ui';
import { NfeItemCard, computeEntry, itemProblem } from './NfeItemCard';
import type { ItemDecision, NfeImportRecord, NfeImportResult, NfePreview } from './types';

/** Chave de acesso em blocos de 4 dígitos, como na DANFE. */
const formatKey = (key: string) => key.replace(/(\d{4})(?=\d)/g, '$1 ');

export function NfeImportPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [decisions, setDecisions] = useState<Record<number, ItemDecision>>({});
  const [warehouseId, setWarehouseId] = useState('');
  const { data: warehouses = [] } = useActiveWarehouses();
  const { data: categories = [] } = useCategories();
  const recent = useQuery({ queryKey: ['nfe', 'imports'], queryFn: () => api.get<NfeImportRecord[]>('/nfe') });
  const canCreate = can('products:write');

  const preview = useMutation({
    mutationFn: (selected: File) => api.upload<NfePreview>('/nfe/preview', selected),
    onSuccess: (data) => {
      // Decisão inicial: itens reconhecidos já vêm vinculados; os demais, como cadastro novo.
      setDecisions(
        Object.fromEntries(
          data.items.map((item) => [
            item.index,
            {
              action: item.match ? 'link' : canCreate ? 'create' : 'link',
              product: item.match?.product ?? null,
              conversionFactor: String(item.match?.conversionFactor ?? item.suggestion.conversionFactor),
              create: {
                ...item.suggestion,
                barcode: item.suggestion.barcode ?? '',
                category: '',
                price: '',
                minStock: '0',
              },
            } satisfies ItemDecision,
          ]),
        ),
      );
    },
  });

  const commit = useMutation({
    mutationFn: () => {
      const items = preview.data!.items.map((item) => {
        const decision = decisions[item.index];
        return {
          index: item.index,
          action: decision.action,
          // Item pulado não entra no estoque: o fator dele (mesmo vazio) não importa.
          conversionFactor: decision.action === 'skip' ? 1 : Number(decision.conversionFactor),
          productId: decision.action === 'link' ? decision.product?.id : undefined,
          product:
            decision.action === 'create'
              ? {
                  sku: decision.create.sku,
                  name: decision.create.name,
                  unit: decision.create.unit,
                  barcode: decision.create.barcode,
                  category: decision.create.category,
                  priceCents: parseMoneyInput(decision.create.price) ?? 0,
                  minStock: Number(decision.create.minStock || 0),
                }
              : undefined,
        };
      });
      return api.upload<NfeImportResult>('/nfe/import', file!, undefined, {
        decisions: JSON.stringify({ warehouseId: warehouseId || warehouses[0]?.id, items }),
      });
    },
    onSuccess: (result) => {
      toast.success(
        `NF ${result.number} importada`,
        `${result.summary.items} itens, ${formatNumber(result.summary.units)} unidades em estoque.`,
      );
      invalidateStock(queryClient);
      // A nota também cadastra fornecedores, produtos (e suas categorias) e entra no histórico de notas.
      for (const key of ['suppliers', 'nfe', 'categories']) queryClient.invalidateQueries({ queryKey: [key] });
    },
  });

  const choose = (selected: File | undefined) => {
    if (!selected) return;
    setFile(selected);
    commit.reset();
    preview.mutate(selected);
  };

  const reset = () => {
    setFile(null);
    preview.reset();
    commit.reset();
    if (inputRef.current) inputRef.current.value = '';
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    choose(event.dataTransfer.files[0]);
  };

  /* ---------- Resultado ---------- */
  if (commit.data) {
    const result = commit.data;
    return (
      <>
        <PageHeader title="Entrada por NF-e" />
        <Card className="mx-auto max-w-2xl p-8 text-center">
          <CircleCheckBig className="mx-auto size-12 text-emerald-600" />
          <h2 className="mt-4 text-xl font-semibold">NF {result.number} importada com sucesso</h2>
          <p className="mt-1 text-slate-500">
            {result.supplier.name}
            {result.supplier.created && ' · fornecedor cadastrado agora'}
          </p>
          <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              ['Itens', result.summary.items],
              ['Unidades', formatNumber(result.summary.units)],
              ['Produtos novos', result.summary.createdProducts],
              ['Alertas resolvidos', result.summary.alertsResolved],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-slate-50 p-3">
                <dt className="text-xs text-slate-500">{label}</dt>
                <dd className="text-xl font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          {result.summary.alertsOpened > 0 && (
            <p className="mt-4 text-sm text-amber-700">
              {result.summary.alertsOpened} item(ns) continuam abaixo do mínimo mesmo após a entrada.
            </p>
          )}
          <div className="mt-8 flex flex-wrap justify-center gap-2">
            <Button variant="secondary" icon={<FileUp className="size-4" />} onClick={reset}>
              Importar outra nota
            </Button>
            <LinkButton to="/movements">Ver no histórico</LinkButton>
          </div>
        </Card>
      </>
    );
  }

  /* ---------- Conferência ---------- */
  if (preview.data) {
    const nfe = preview.data;
    const problems = nfe.items.map((item) => itemProblem(item, decisions[item.index])).filter(Boolean);
    const selected = nfe.items.filter((item) => decisions[item.index]?.action !== 'skip');
    const units = selected.reduce((sum, item) => sum + computeEntry(item, decisions[item.index]).quantity, 0);
    const blocked = Boolean(nfe.alreadyImported) || problems.length > 0 || selected.length === 0;

    return (
      <>
        <PageHeader
          title={`NF-e ${nfe.number}${nfe.series ? ` · série ${nfe.series}` : ''}`}
          description="Confira os itens antes de dar entrada. Nada foi gravado ainda."
          actions={
            <Button variant="ghost" onClick={reset}>
              Escolher outro arquivo
            </Button>
          }
        />

        {nfe.alreadyImported && (
          <div
            className="mb-6 flex gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            role="alert"
          >
            <TriangleAlert className="size-4 shrink-0" />
            Esta nota já foi importada em {formatDateTime(nfe.alreadyImported.createdAt)} por{' '}
            {nfe.alreadyImported.user.name}. Importar de novo duplicaria o estoque.
          </div>
        )}
        {!nfe.authorized && (
          <div className="mb-6 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <TriangleAlert className="size-4 shrink-0" />O XML não traz o protocolo de autorização da SEFAZ. Confira se
            a nota foi realmente autorizada.
          </div>
        )}

        <Card className="mb-6">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 p-5 lg:grid-cols-4">
            <div className="col-span-2">
              <p className="text-xs text-slate-500">Fornecedor</p>
              <p className="font-medium text-slate-900">{nfe.supplier.name}</p>
              <p className="text-sm text-slate-500">
                CNPJ {nfe.supplier.documentFormatted}
                {nfe.supplier.city && ` · ${nfe.supplier.city}`}
              </p>
              <div className="mt-1">
                {nfe.supplier.existing ? (
                  <Badge tone="green">Fornecedor cadastrado</Badge>
                ) : (
                  <Badge tone="blue">Novo: será cadastrado</Badge>
                )}
              </div>
            </div>
            <div>
              <p className="text-xs text-slate-500">Emissão</p>
              <p className="font-medium text-slate-900">{formatDate(nfe.issuedAt)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Valor da nota</p>
              <p className="font-medium text-slate-900">{formatMoney(nfe.totalCents)}</p>
            </div>
            <div className="col-span-2 lg:col-span-4">
              <p className="text-xs text-slate-500">Chave de acesso</p>
              <p className="font-mono text-xs break-all text-slate-700">{formatKey(nfe.accessKey)}</p>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          {nfe.items.map((item) => (
            <NfeItemCard
              key={item.index}
              item={item}
              decision={decisions[item.index]}
              onChange={(decision) => setDecisions((current) => ({ ...current, [item.index]: decision }))}
              canCreate={canCreate}
              categories={categories}
            />
          ))}
        </div>

        <div className="sticky bottom-0 z-10 -mx-4 mt-6 border-t border-slate-200 bg-white/95 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          {commit.error && (
            <div className="mb-3">
              <ErrorMessage error={commit.error} />
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="text-sm text-slate-600">
              <strong className="text-slate-900">{selected.length}</strong> de {nfe.items.length} itens ·{' '}
              <strong className="text-slate-900">{formatNumber(units)}</strong> unidades
              {problems.length > 0 && (
                <span className="ml-2 text-amber-700">· {problems.length} item(ns) pendente(s)</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Select
                value={warehouseId || warehouses[0]?.id || ''}
                onChange={(e) => setWarehouseId(e.target.value)}
                className="w-auto"
                aria-label="Estoque de entrada"
              >
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    Entrada em: {warehouse.name}
                  </option>
                ))}
              </Select>
              <Button onClick={() => commit.mutate()} loading={commit.isPending} disabled={blocked}>
                Confirmar entrada
              </Button>
            </div>
          </div>
        </div>
      </>
    );
  }

  /* ---------- Envio do arquivo ---------- */
  return (
    <>
      <PageHeader
        title="Entrada por NF-e"
        description="Importe o XML da nota do fornecedor: o sistema cadastra o que for novo e dá entrada no estoque de uma vez."
      />

      <Card>
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'm-4 flex flex-col items-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors',
            dragging ? 'border-brand-600 bg-brand-50' : 'border-slate-300',
          )}
        >
          <ReceiptText className="mb-3 size-10 text-slate-400" />
          <p className="font-medium text-slate-900">Arraste aqui o arquivo XML da NF-e</p>
          <p className="mt-1 max-w-md text-sm text-slate-500">
            É o arquivo .xml que o fornecedor envia junto com a nota (normalmente por e-mail, ao lado do PDF da DANFE).
          </p>
          <Button
            className="mt-5"
            icon={<FileUp className="size-4" />}
            onClick={() => inputRef.current?.click()}
            loading={preview.isPending}
          >
            Escolher XML
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".xml,text/xml,application/xml"
            className="hidden"
            onChange={(e) => choose(e.target.files?.[0])}
          />
        </div>
        {preview.error && (
          <div className="px-4 pb-4">
            <ErrorMessage error={preview.error} />
          </div>
        )}
      </Card>

      <Card className="mt-6">
        <CardHeader title="Notas importadas" description="As 20 mais recentes" />
        {recent.data?.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Nota</Th>
                <Th>Fornecedor</Th>
                <Th className="hidden md:table-cell">Estoque</Th>
                <Th className="text-right">Itens</Th>
                <Th className="text-right">Valor</Th>
                <Th className="hidden lg:table-cell">Importada por</Th>
              </tr>
            </thead>
            <tbody>
              {recent.data.map((record) => (
                <tr key={record.id}>
                  <Td>
                    <p className="font-medium text-slate-900">
                      NF {record.number}
                      {record.series && `/${record.series}`}
                    </p>
                    <p className="text-xs text-slate-500">emitida em {formatDate(record.issuedAt)}</p>
                  </Td>
                  <Td>{record.supplier.name}</Td>
                  <Td className="hidden md:table-cell">{record.warehouse.name}</Td>
                  <Td className="text-right tabular-nums">{record.itemCount}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(record.totalCents)}</Td>
                  <Td className="hidden text-slate-500 lg:table-cell">
                    {record.user.name} · {formatDateTime(record.createdAt)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState
            title="Nenhuma nota importada ainda"
            description="As notas aparecem aqui depois da primeira importação."
          />
        )}
      </Card>

      <p className="mt-4 text-sm text-slate-500">
        Prefere lançar manualmente? Use{' '}
        <Link to="/movements/new" className="font-medium text-brand-700 hover:underline">
          Nova movimentação
        </Link>
        .
      </p>
    </>
  );
}
