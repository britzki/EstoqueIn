import { useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ScanBarcode } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { formatDateTime, formatNumber, roundQty } from '../../lib/format';
import type { InventoryDetail, InventoryItem } from '../../lib/types';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DecimalInput,
  ErrorMessage,
  Input,
  Modal,
  Select,
  Spinner,
  Table,
  Tabs,
  Td,
  Th,
} from '../../components/ui';
import { INVENTORY_STATUS } from './InventoriesPage';

type Filter = 'all' | 'pending' | 'divergent';

export function InventoryDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [confirming, setConfirming] = useState(false);
  const [scan, setScan] = useState({ barcode: '', quantity: '1', mode: 'add' as 'add' | 'set' });
  const scanRef = useRef<HTMLInputElement>(null);
  const scanQueue = useRef(Promise.resolve());

  const key = ['inventory', id];
  const inventory = useQuery({ queryKey: key, queryFn: () => api.get<InventoryDetail>(`/inventories/${id}`) });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: ['inventories'] });
  };

  const scanMutation = useMutation({
    mutationFn: (barcode: string) =>
      api.post<InventoryItem>(`/inventories/${id}/scan`, {
        barcode,
        quantity: Number(scan.quantity),
        mode: scan.mode,
      }),
    onSuccess: (item) => {
      toast.success(item.product.name, `Contado: ${formatNumber(item.countedQuantity ?? 0)}`);
      refresh();
      scanRef.current?.focus();
    },
    onError: (error) => toast.error('Leitura não registrada', error.message),
  });

  const complete = useMutation({
    mutationFn: () =>
      api.post<{ summary: { adjusted: number; uncounted: number; netDifference: number } }>(
        `/inventories/${id}/complete`,
      ),
    onSuccess: ({ summary }) => {
      toast.success(
        'Inventário concluído',
        `${summary.adjusted} ajuste(s) aplicados; ${summary.uncounted} item(ns) não contados ficaram como estavam.`,
      );
      setConfirming(false);
      refresh();
      for (const k of ['products', 'product', 'alerts', 'dashboard', 'movements'])
        queryClient.invalidateQueries({ queryKey: [k] });
    },
  });

  const cancel = useMutation({
    mutationFn: () => api.post(`/inventories/${id}/cancel`),
    onSuccess: () => {
      toast.info('Inventário cancelado');
      refresh();
    },
  });

  if (inventory.isPending) return <Spinner />;
  if (inventory.isError) return <ErrorMessage error={inventory.error} />;

  const inv = inventory.data;
  const isOpen = inv.status === 'OPEN';
  const counted = inv.items.filter((item) => item.countedQuantity !== null);
  const divergent = counted.filter((item) => item.countedQuantity !== item.expectedQuantity);
  const items = inv.items.filter((item) =>
    filter === 'pending' ? item.countedQuantity === null : filter === 'divergent' ? divergent.includes(item) : true,
  );
  const status = INVENTORY_STATUS[inv.status];

  // O leitor pode bipar o próximo produto antes de a leitura anterior ser salva: o campo é limpo na
  // hora e as leituras vão para o servidor uma de cada vez, na ordem (nenhuma se perde).
  const onScan = (event: FormEvent) => {
    event.preventDefault();
    const barcode = scan.barcode.trim();
    if (!barcode) return;
    setScan((current) => ({ ...current, barcode: '' }));
    scanQueue.current = scanQueue.current.then(() =>
      scanMutation.mutateAsync(barcode).then(
        () => undefined,
        () => undefined,
      ),
    );
  };

  return (
    <>
      <Link
        to="/inventories"
        className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
      >
        <ChevronLeft className="size-4" /> Inventários
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Inventário · {inv.warehouse.name}</h1>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Aberto por {inv.createdBy.name} em {formatDateTime(inv.createdAt)}
            {inv.notes && ` · ${inv.notes}`}
          </p>
        </div>
        {isOpen && can('inventory:manage') && (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => cancel.mutate()} loading={cancel.isPending}>
              Cancelar inventário
            </Button>
            <Button onClick={() => setConfirming(true)} disabled={counted.length === 0}>
              Concluir e ajustar
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {isOpen && can('inventory:count') && (
          <Card className="h-fit">
            <CardHeader
              title="Contagem com leitor"
              description="Bipe cada unidade, ou informe a quantidade e bipe uma vez."
            />
            <form onSubmit={onScan} className="space-y-3 p-5">
              <div className="relative">
                <ScanBarcode className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  ref={scanRef}
                  autoFocus
                  value={scan.barcode}
                  onChange={(e) => setScan({ ...scan, barcode: e.target.value })}
                  placeholder="Código de barras"
                  className="pl-9"
                  aria-label="Código de barras"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <DecimalInput
                  value={scan.quantity}
                  onChange={(value) => setScan({ ...scan, quantity: value })}
                  aria-label="Quantidade"
                />
                <Select
                  value={scan.mode}
                  onChange={(e) => setScan({ ...scan, mode: e.target.value as 'add' | 'set' })}
                  aria-label="Modo"
                >
                  <option value="add">Somar</option>
                  <option value="set">Substituir</option>
                </Select>
              </div>
              <Button type="submit" className="w-full">
                Registrar leitura
              </Button>
            </form>
            <dl className="grid grid-cols-3 border-t border-slate-100 text-center">
              {[
                ['Itens', inv.items.length],
                ['Contados', counted.length],
                ['Divergentes', divergent.length],
              ].map(([label, value]) => (
                <div key={label} className="py-3">
                  <dt className="text-xs text-slate-500">{label}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        )}

        <Card className={clsx(isOpen && can('inventory:count') ? 'lg:col-span-2' : 'lg:col-span-3')}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
            <Tabs
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: `Todos (${inv.items.length})` },
                { value: 'pending', label: `Pendentes (${inv.items.length - counted.length})` },
                { value: 'divergent', label: `Divergentes (${divergent.length})` },
              ]}
            />
          </div>
          <Table>
            <thead>
              <tr>
                <Th>Produto</Th>
                <Th className="text-right">Sistema</Th>
                <Th className="text-right">Contado</Th>
                <Th className="text-right">{isOpen ? 'Diferença' : 'Ajuste aplicado'}</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <ItemRow
                  key={item.id}
                  inventoryId={inv.id}
                  item={item}
                  editable={isOpen && can('inventory:count')}
                  onSaved={refresh}
                  closed={!isOpen}
                />
              ))}
            </tbody>
          </Table>
        </Card>
      </div>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Concluir inventário?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Voltar
            </Button>
            <Button onClick={() => complete.mutate()} loading={complete.isPending}>
              Concluir e ajustar saldos
            </Button>
          </>
        }
      >
        {complete.error && <ErrorMessage error={complete.error} />}
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li>
            <strong>{counted.length}</strong> itens contados terão o saldo ajustado para a quantidade contada.
          </li>
          <li>
            <strong>{inv.items.length - counted.length}</strong> itens não contados ficam como estão.
          </li>
          <li>Cada diferença vira uma movimentação de ajuste no histórico e os alertas são reavaliados.</li>
          <li>Movimentações feitas durante a contagem são respeitadas: o ajuste é calculado sobre o saldo atual.</li>
        </ul>
      </Modal>
    </>
  );
}

function ItemRow({
  inventoryId,
  item,
  editable,
  closed,
  onSaved,
}: {
  inventoryId: string;
  item: InventoryItem;
  editable: boolean;
  closed: boolean;
  onSaved: () => void;
}) {
  const toast = useToast();
  const initial = item.countedQuantity === null ? '' : String(item.countedQuantity);
  const [value, setValue] = useState(initial);
  const [lastSynced, setLastSynced] = useState(initial);

  // Mantém o campo em sincronia quando a contagem chega por leitura de código de barras.
  if (initial !== lastSynced) {
    setLastSynced(initial);
    setValue(initial);
  }

  const save = useMutation({
    mutationFn: (countedQuantity: number | null) =>
      api.patch(`/inventories/${inventoryId}/items/${item.id}`, { countedQuantity }),
    onSuccess: onSaved,
    onError: (error) => toast.error('Não foi possível salvar', error.message),
  });

  // Só "," ou outro resto inválido não pode virar "limpar a contagem": volta ao valor salvo.
  const saveCount = () => {
    if (value === initial) return;
    const counted = value === '' ? null : Number(value);
    if (counted !== null && !Number.isFinite(counted)) return setValue(initial);
    save.mutate(counted);
  };

  const difference = closed
    ? item.difference
    : item.countedQuantity === null
      ? null
      : roundQty(item.countedQuantity - item.expectedQuantity);

  return (
    <tr>
      <Td>
        <p className="font-medium text-slate-900">{item.product.name}</p>
        <p className="text-xs text-slate-500">
          {item.product.sku}
          {item.product.barcode && ` · ${item.product.barcode}`}
        </p>
      </Td>
      <Td className="text-right tabular-nums">{formatNumber(item.expectedQuantity)}</Td>
      <Td className="text-right">
        {editable ? (
          <DecimalInput
            value={value}
            onChange={(value) => setValue(value)}
            onBlur={saveCount}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="ml-auto h-8 w-24 text-right"
            placeholder="—"
            aria-label={`Quantidade contada de ${item.product.name}`}
          />
        ) : (
          <span className="tabular-nums">
            {item.countedQuantity === null ? '—' : formatNumber(item.countedQuantity)}
          </span>
        )}
      </Td>
      <Td
        className={clsx(
          'text-right font-medium tabular-nums',
          difference === null || difference === 0
            ? 'text-slate-400'
            : difference > 0
              ? 'text-emerald-700'
              : 'text-red-700',
        )}
      >
        {difference === null ? '—' : `${difference > 0 ? '+' : ''}${formatNumber(difference)}`}
      </Td>
    </tr>
  );
}
