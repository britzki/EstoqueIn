import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, MessageCircle, Printer, Trash2, WalletCards, XCircle } from 'lucide-react';
import { BillFormModal } from '../BillsPage';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useStoreSettings } from '../../lib/hooks';
import { useToast } from '../../lib/toast';
import { formatDate, formatMoney, formatNumber, quantityStep, whatsappLink } from '../../lib/format';
import type { PurchaseOrder, StoreSettings } from '../../lib/types';
import {
  Badge,
  Button,
  ErrorMessage,
  Input,
  Modal,
  Spinner,
  Table,
  Td,
  Textarea,
  Th,
  type Tone,
} from '../../components/ui';

export const ORDER_STATUS: Record<PurchaseOrder['status'], { label: string; tone: Tone }> = {
  OPEN: { label: 'Aguardando entrega', tone: 'blue' },
  RECEIVED: { label: 'Recebido', tone: 'green' },
  CANCELLED: { label: 'Cancelado', tone: 'gray' },
};

export interface DraftLine {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  fractional: boolean;
  quantity: number;
  costCents: number;
}

/** Texto do pedido para o WhatsApp do fornecedor. */
function orderMessage(order: PurchaseOrder, storeName?: string) {
  const greeting = order.supplier?.contactName ? `Olá, ${order.supplier.contactName}!` : 'Olá!';
  const lines = order.items.map((item) => `• ${formatNumber(item.quantity)} ${item.unit} – ${item.description}`);
  return [
    `${greeting} Segue o pedido nº ${order.number} da ${storeName ?? 'loja'}:`,
    '',
    ...lines,
    ...(order.notes ? ['', `Obs.: ${order.notes}`] : []),
    '',
    'Pode confirmar o prazo de entrega e o valor? Obrigado!',
  ].join('\n');
}

/** Documento A4 do pedido, para imprimir ou salvar em PDF. */
function OrderDocument({ order, settings }: { order: PurchaseOrder; settings?: StoreSettings }) {
  return (
    <div className="p-2 font-sans text-[12px] text-black">
      <style>{'@media print { @page { size: A4; margin: 15mm; } }'}</style>
      <div className="mb-4 flex justify-between border-b border-black pb-2">
        <div>
          <p className="text-lg font-bold">{settings?.storeName}</p>
          {settings?.document && <p>CNPJ {settings.document}</p>}
          {settings?.address && <p>{settings.address}</p>}
          {settings?.phone && <p>{settings.phone}</p>}
        </div>
        <div className="text-right">
          <p className="text-lg font-bold">Pedido de compra nº {order.number}</p>
          <p>{formatDate(order.createdAt)}</p>
        </div>
      </div>
      {order.supplier && (
        <p className="mb-3">
          <strong>Fornecedor:</strong> {order.supplier.name}
          {order.supplier.contactName && ` · A/C ${order.supplier.contactName}`}
        </p>
      )}
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-1">Produto</th>
            <th className="py-1 text-right">Quantidade</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item) => (
            <tr key={item.id} className="border-b border-gray-300">
              <td className="py-1">{item.description}</td>
              <td className="py-1 text-right">
                {formatNumber(item.quantity)} {item.unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {order.notes && (
        <p className="mt-3">
          <strong>Observações:</strong> {order.notes}
        </p>
      )}
    </div>
  );
}

/** Pedido salvo: enviar pelo WhatsApp, imprimir/PDF e marcar como recebido ou cancelado. */
export function OrderModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: settings } = useStoreSettings();
  const [printing, setPrinting] = useState(false);
  const [billing, setBilling] = useState(false);
  const { data: order, error } = useQuery({
    queryKey: ['purchase-orders', 'detail', id],
    queryFn: () => api.get<PurchaseOrder>(`/purchase-orders/${id}`),
  });

  const setStatus = useMutation({
    mutationFn: (status: 'RECEIVED' | 'CANCELLED') =>
      api.post<PurchaseOrder>(`/purchase-orders/${id}/status`, { status }),
    onSuccess: (updated) => {
      toast.success(updated.status === 'RECEIVED' ? 'Pedido marcado como recebido' : 'Pedido cancelado');
      for (const key of ['purchase-orders', 'reports']) queryClient.invalidateQueries({ queryKey: [key] });
    },
  });

  const print = () => {
    setPrinting(true);
    setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 150);
  };

  const phone = order?.supplier?.phone?.replace(/\D/g, '');
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={order ? `Pedido nº ${order.number}` : 'Pedido'}
      description={order ? `${order.supplier?.name ?? 'Sem fornecedor'} · ${formatDate(order.createdAt)}` : undefined}
      footer={
        order && (
          <>
            {can('products:write') && order.status === 'OPEN' && (
              <>
                <Button
                  variant="ghost"
                  className="mr-auto"
                  icon={<XCircle className="size-4" />}
                  loading={setStatus.isPending && setStatus.variables === 'CANCELLED'}
                  onClick={() => setStatus.mutate('CANCELLED')}
                >
                  Cancelar pedido
                </Button>
                <Button
                  variant="secondary"
                  icon={<CircleCheck className="size-4" />}
                  loading={setStatus.isPending && setStatus.variables === 'RECEIVED'}
                  onClick={() => setStatus.mutate('RECEIVED')}
                >
                  Marcar como recebido
                </Button>
              </>
            )}
            {can('bills:manage') && order.status !== 'CANCELLED' && (
              <Button variant="secondary" icon={<WalletCards className="size-4" />} onClick={() => setBilling(true)}>
                Lançar conta a pagar
              </Button>
            )}
            <Button variant="secondary" icon={<Printer className="size-4" />} onClick={print}>
              Imprimir / PDF
            </Button>
            {phone && phone.length >= 10 ? (
              <a
                href={whatsappLink(phone, orderMessage(order, settings?.storeName))}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
              >
                <MessageCircle className="size-4" /> Enviar pelo WhatsApp
              </a>
            ) : null}
          </>
        )
      }
    >
      {printing &&
        order &&
        createPortal(<OrderDocument order={order} settings={settings} />, document.getElementById('print-root')!)}
      {billing && order && (
        <BillFormModal
          bill={null}
          initial={{
            description: `Pedido nº ${order.number}${order.supplier ? ` – ${order.supplier.name}` : ''}`,
            supplierId: order.supplier?.id,
            purchaseOrderId: order.id,
            amountCents: order.totalCents,
          }}
          onClose={() => setBilling(false)}
        />
      )}
      {error ? (
        <ErrorMessage error={error} />
      ) : !order ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <Badge tone={ORDER_STATUS[order.status].tone}>{ORDER_STATUS[order.status].label}</Badge>
            feito por {order.createdBy.name}
            {order.closedAt && ` · encerrado em ${formatDate(order.closedAt)}`}
          </div>
          {!phone && order.status === 'OPEN' && (
            <p className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800">
              O fornecedor está sem telefone no cadastro. Preencha em Fornecedores para enviar pelo WhatsApp, ou use
              Imprimir / PDF.
            </p>
          )}
          <Table>
            <thead>
              <tr>
                <Th>Produto</Th>
                <Th className="text-right">Quantidade</Th>
                <Th className="text-right">Custo estimado</Th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.id}>
                  <Td className="text-slate-900">{item.description}</Td>
                  <Td className="text-right tabular-nums">
                    {formatNumber(item.quantity)} {item.unit}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {item.unitCostCents ? formatMoney(Math.round(item.quantity * item.unitCostCents)) : '—'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="text-right text-sm text-slate-600">
            Total estimado (pelo último custo):{' '}
            <strong className="text-slate-900">{formatMoney(order.totalCents)}</strong>
          </p>
          {order.notes && <p className="text-sm text-slate-600">Observações: {order.notes}</p>}
          {order.status === 'OPEN' && (
            <p className="text-xs text-slate-500">
              Enquanto o pedido está aguardando entrega, a sugestão de compra não pede esses produtos de novo. Quando a
              mercadoria chegar, dê entrada pela NF-e (ou Nova movimentação) e marque o pedido como recebido.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Monta o pedido a partir da sugestão: ajusta quantidades, tira itens e escreve observações. */
export function OrderDraftModal({
  supplier,
  lines: initial,
  onClose,
  onCreated,
}: {
  supplier: { id: string; name: string } | null;
  lines: DraftLine[];
  onClose: () => void;
  onCreated: (order: PurchaseOrder) => void;
}) {
  const queryClient = useQueryClient();
  const [lines, setLines] = useState(initial.map((line) => ({ ...line, text: String(line.quantity) })));
  const [notes, setNotes] = useState('');
  const quantities = lines.map((line) => Number(line.text.replace(',', '.')));
  const invalid = lines.some(
    (line, index) => !(quantities[index] > 0) || (!line.fractional && !Number.isInteger(quantities[index])),
  );
  const total = lines.reduce((sum, line, index) => sum + Math.round((quantities[index] || 0) * line.costCents), 0);

  const create = useMutation({
    mutationFn: () =>
      api.post<PurchaseOrder>('/purchase-orders', {
        supplierId: supplier?.id,
        items: lines.map((line, index) => ({ productId: line.productId, quantity: quantities[index] })),
        notes,
      }),
    onSuccess: (order) => {
      for (const key of ['purchase-orders', 'reports']) queryClient.invalidateQueries({ queryKey: [key] });
      onCreated(order);
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Pedido para ${supplier?.name ?? 'fornecedor não cadastrado'}`}
      description="Confira as quantidades sugeridas antes de salvar."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={create.isPending} disabled={lines.length === 0 || invalid} onClick={() => create.mutate()}>
            Salvar pedido
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {create.error && <ErrorMessage error={create.error} />}
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {lines.map((line, index) => (
            <li key={line.productId} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-slate-900">{line.name}</span>
                <span className="text-xs text-slate-500">{line.sku}</span>
              </span>
              <Input
                type="number"
                min={quantityStep(line.fractional)}
                step={quantityStep(line.fractional)}
                value={line.text}
                onChange={(e) =>
                  setLines((current) => current.map((l, i) => (i === index ? { ...l, text: e.target.value } : l)))
                }
                className="h-9 w-24 text-right"
                aria-label={`Quantidade de ${line.name}`}
              />
              <span className="w-8 text-xs text-slate-500">{line.unit}</span>
              <button
                type="button"
                onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                aria-label={`Tirar ${line.name} do pedido`}
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
        <p className="text-right text-sm text-slate-600">
          Custo estimado: <strong className="text-slate-900">{formatMoney(total)}</strong>
        </p>
        <div>
          <label htmlFor="order-notes" className="mb-1.5 block text-sm font-medium text-slate-700">
            Observações para o fornecedor
          </label>
          <Textarea
            id="order-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex.: entregar até sexta, pagamento em 28 dias"
          />
        </div>
      </div>
    </Modal>
  );
}
