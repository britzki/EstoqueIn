import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bike, CircleCheckBig, CircleX, Clock, MessageCircle, PackageCheck, Printer, Truck } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { useStoreSettings } from '../lib/hooks';
import { useToast } from '../lib/toast';
import { formatMoney, formatPhone, whatsappLink } from '../lib/format';
import { addressLine, collectInfo, DELIVERY_STATUS, formatDue, isLate, outForDeliveryMessage } from '../lib/delivery';
import type { Courier, CourierReportRow, DeliveryDetail } from '../lib/types';
import { useDeliverySlipPrinter } from '../components/DeliverySlip';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorMessage,
  Input,
  LinkButton,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Table,
  Tabs,
  Td,
  Th,
} from '../components/ui';
import { SaleModal } from './sales/SalesPage';

/** Painel de entregas: o que separar, o que está na rua e o que já foi entregue hoje. */
export function DeliveriesPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'board' | 'couriers'>('board');
  return (
    <>
      <PageHeader
        title="Entregas"
        description="Separe, mande com o entregador e marque como entregue. Atualiza sozinho a cada 30 segundos."
        actions={
          can('sales:create') && (
            <LinkButton to="/sales/new" icon={<Truck className="size-4" />}>
              Nova venda para entrega
            </LinkButton>
          )
        }
      />
      {can('reports:read') && (
        <div className="mb-4">
          <Tabs
            value={tab}
            onChange={setTab}
            options={[
              { value: 'board', label: 'Painel', icon: <Truck /> },
              { value: 'couriers', label: 'Acerto com entregadores', icon: <Bike /> },
            ]}
          />
        </div>
      )}
      {tab === 'board' ? <Board /> : <CouriersReport />}
    </>
  );
}

function Board() {
  const { data, isPending, error } = useQuery({
    queryKey: ['deliveries', 'board'],
    queryFn: () => api.get<DeliveryDetail[]>('/deliveries'),
    refetchInterval: 30_000,
  });
  // Relógio para o "atrasada" mudar sem recarregar.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const [openSale, setOpenSale] = useState<string | null>(null);

  if (isPending) return <Spinner />;
  if (error) return <ErrorMessage error={error} />;

  const columns = [
    {
      title: 'A separar',
      icon: <PackageCheck className="size-4" />,
      items: data.filter((d) => d.status === 'PENDING' || d.status === 'FAILED'),
    },
    { title: 'Saiu para entrega', icon: <Truck className="size-4" />, items: data.filter((d) => d.status === 'OUT') },
    {
      title: 'Concluídas hoje',
      icon: <CircleCheckBig className="size-4" />,
      items: data.filter((d) => d.status === 'DELIVERED' || d.status === 'CANCELLED').reverse(),
    },
  ];

  return (
    <>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {columns.map((column) => (
          <section key={column.title} aria-label={column.title}>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
              {column.icon}
              {column.title}
              <span className="rounded-full bg-slate-200 px-2 text-xs text-slate-700">{column.items.length}</span>
            </h2>
            <div className="space-y-3">
              {column.items.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
                  Nenhuma entrega
                </p>
              ) : (
                column.items.map((delivery) => (
                  <DeliveryCard
                    key={delivery.id}
                    delivery={delivery}
                    late={isLate(delivery, now)}
                    onOpenSale={() => setOpenSale(delivery.saleId)}
                  />
                ))
              )}
            </div>
          </section>
        ))}
      </div>
      {openSale && <SaleModal saleId={openSale} onClose={() => setOpenSale(null)} />}
    </>
  );
}

function DeliveryCard({
  delivery,
  late,
  onOpenSale,
}: {
  delivery: DeliveryDetail;
  late: boolean;
  onOpenSale: () => void;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: settings } = useStoreSettings();
  const slip = useDeliverySlipPrinter(settings);
  const [dispatching, setDispatching] = useState(false);
  const [failing, setFailing] = useState(false);
  const collect = collectInfo(delivery);
  const open = delivery.status === 'PENDING' || delivery.status === 'OUT' || delivery.status === 'FAILED';

  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: object }) =>
      api.post<DeliveryDetail>(`/deliveries/${delivery.id}/${path}`, body ?? {}),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      toast.success(`Entrega nº ${updated.number}`, DELIVERY_STATUS[updated.status]);
      setDispatching(false);
      setFailing(false);
    },
  });

  return (
    <Card
      className={cn(
        'p-4',
        late && 'border-red-300 bg-red-50/60',
        delivery.status === 'FAILED' && 'border-amber-300 bg-amber-50/60',
        !open && 'opacity-75',
      )}
    >
      {slip.portal}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">
            Nº {delivery.number} · {delivery.customer.name}
          </p>
          <button type="button" onClick={onOpenSale} className="text-xs text-brand-700 hover:underline">
            Venda nº {delivery.sale.number} · {formatMoney(delivery.sale.totalCents)}
          </button>
        </div>
        {delivery.status === 'FAILED' ? (
          <Badge tone="orange">Não entregue</Badge>
        ) : delivery.status === 'CANCELLED' ? (
          <Badge tone="red">Cancelada</Badge>
        ) : delivery.status === 'DELIVERED' ? (
          <Badge tone="green">Entregue</Badge>
        ) : (
          <Badge tone={late ? 'red' : delivery.scheduled ? 'violet' : 'gray'} icon={<Clock className="size-3" />}>
            {late ? 'Atrasada' : delivery.scheduled ? 'Agendada' : 'Até'} {formatDue(delivery.dueAt)}
          </Badge>
        )}
      </div>

      <p className="mt-2 text-sm text-slate-800">{addressLine(delivery)}</p>
      {delivery.reference && <p className="text-xs text-slate-500">Ref.: {delivery.reference}</p>}
      {delivery.phone && <p className="text-xs text-slate-500">{formatPhone(delivery.phone)}</p>}
      {delivery.notes && <p className="mt-1 text-xs text-slate-600">Obs.: {delivery.notes}</p>}
      {delivery.failReason && delivery.status === 'FAILED' && (
        <p className="mt-1 text-xs font-medium text-amber-800">Motivo: {delivery.failReason}</p>
      )}

      <p className="mt-2 text-sm">
        {collect ? (
          <span className="font-medium text-amber-800">
            Cobrar {formatMoney(collect.amountCents)} ({collect.methods})
            {collect.paysWithCents !== null && ` · levar troco de ${formatMoney(collect.changeCents)}`}
          </span>
        ) : (
          <span className="text-emerald-700">Já pago</span>
        )}
      </p>
      {delivery.courier && (
        <p className="mt-1 flex items-center gap-1 text-xs text-slate-600">
          <Bike className="size-3.5" /> {delivery.courier.name}
        </p>
      )}

      {open && can('sales:create') && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={<Printer className="size-4" />}
            onClick={() => void slip.print(delivery)}
          >
            Guia
          </Button>
          {(delivery.status === 'PENDING' || delivery.status === 'FAILED') && (
            <Button size="sm" icon={<Truck className="size-4" />} onClick={() => setDispatching(true)}>
              Saiu
            </Button>
          )}
          {delivery.status === 'OUT' && (
            <>
              <Button
                size="sm"
                icon={<CircleCheckBig className="size-4" />}
                loading={action.isPending}
                onClick={() => action.mutate({ path: 'deliver' })}
              >
                Entregue
              </Button>
              {delivery.phone && settings && (
                <a
                  href={whatsappLink(delivery.phone, outForDeliveryMessage(delivery, settings.storeName))}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-300 px-3 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
                >
                  <MessageCircle className="size-4" /> Avisar
                </a>
              )}
            </>
          )}
          {delivery.status !== 'FAILED' && (
            <Button size="sm" variant="ghost" icon={<CircleX className="size-4" />} onClick={() => setFailing(true)}>
              Não entregue
            </Button>
          )}
        </div>
      )}

      {dispatching && (
        <DispatchModal
          delivery={delivery}
          loading={action.isPending}
          error={action.error}
          onClose={() => setDispatching(false)}
          onConfirm={(courierId) => action.mutate({ path: 'dispatch', body: { courierId } })}
        />
      )}
      {failing && (
        <FailModal
          delivery={delivery}
          loading={action.isPending}
          error={action.error}
          onClose={() => setFailing(false)}
          onConfirm={(reason) => action.mutate({ path: 'fail', body: { reason } })}
        />
      )}
    </Card>
  );
}

const LAST_COURIER_KEY = 'estoquein.lastCourier';

function DispatchModal({
  delivery,
  loading,
  error,
  onClose,
  onConfirm,
}: {
  delivery: DeliveryDetail;
  loading: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (courierId: string | null) => void;
}) {
  const { data: couriers = [] } = useQuery({
    queryKey: ['couriers'],
    queryFn: () => api.get<Courier[]>('/couriers'),
    select: (list) => list.filter((c) => c.active),
  });
  const [courierId, setCourierId] = useState(() => {
    try {
      return localStorage.getItem(LAST_COURIER_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const valid = couriers.some((c) => c.id === courierId) ? courierId : '';
  const confirm = () => {
    try {
      if (valid) localStorage.setItem(LAST_COURIER_KEY, valid);
    } catch {
      /* sem armazenamento: só não lembra o último */
    }
    onConfirm(valid || null);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Entrega nº ${delivery.number} saiu`}
      description={addressLine(delivery)}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button loading={loading} onClick={confirm}>
            Confirmar saída
          </Button>
        </>
      }
    >
      {error ? <ErrorMessage error={error} /> : null}
      <label htmlFor="courier" className="mb-1.5 block text-sm font-medium text-slate-700">
        Entregador
      </label>
      <Select id="courier" value={valid} onChange={(e) => setCourierId(e.target.value)}>
        <option value="">Não informar</option>
        {couriers.map((courier) => (
          <option key={courier.id} value={courier.id}>
            {courier.name}
          </option>
        ))}
      </Select>
      {couriers.length === 0 && (
        <p className="mt-1 text-xs text-slate-500">
          Cadastre os entregadores em Configurações para fazer o acerto no fim do dia ou da semana.
        </p>
      )}
    </Modal>
  );
}

function FailModal({
  delivery,
  loading,
  error,
  onClose,
  onConfirm,
}: {
  delivery: DeliveryDetail;
  loading: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const reasons = ['Cliente ausente', 'Endereço não encontrado', 'Cliente recusou'];
  return (
    <Modal
      open
      onClose={onClose}
      title={`Entrega nº ${delivery.number} não entregue`}
      description="A entrega volta para “A separar”: dá para mandar de novo ou, se o cliente desistir, cancelar a venda (o estoque volta)."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button
            variant="danger"
            disabled={reason.trim().length < 3}
            loading={loading}
            onClick={() => onConfirm(reason)}
          >
            Confirmar
          </Button>
        </>
      }
    >
      {error ? <ErrorMessage error={error} /> : null}
      <div className="mb-2 flex flex-wrap gap-2">
        {reasons.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setReason(option)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs',
              reason === option ? 'border-brand-700 bg-brand-50 text-brand-800' : 'border-slate-300 text-slate-700',
            )}
          >
            {option}
          </button>
        ))}
      </div>
      <Input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="O que aconteceu?"
        aria-label="Motivo"
      />
    </Modal>
  );
}

const toInputDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Quantas entregas cada entregador fez e quanto a loja deve pagar a ele no período. */
function CouriersReport() {
  const today = new Date();
  const weekAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
  const [from, setFrom] = useState(toInputDate(weekAgo));
  const [to, setTo] = useState(toInputDate(today));
  const { data, isPending, error } = useQuery({
    queryKey: ['deliveries', 'couriers-report', from, to],
    queryFn: () =>
      api.get<CourierReportRow[]>('/deliveries/couriers-report', {
        from: new Date(`${from}T00:00:00`).toISOString(),
        to: new Date(`${to}T23:59:59.999`).toISOString(),
      }),
    enabled: Boolean(from && to),
  });

  return (
    <Card>
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
        <label className="text-sm text-slate-700">
          De
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-auto" />
        </label>
        <label className="text-sm text-slate-700">
          Até
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-auto" />
        </label>
      </div>
      {isPending ? (
        <Spinner />
      ) : error ? (
        <div className="p-4">
          <ErrorMessage error={error} />
        </div>
      ) : data.length === 0 ? (
        <EmptyState icon={<Bike />} title="Nenhuma entrega concluída no período" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Entregador</Th>
              <Th className="text-right">Entregas</Th>
              <Th className="text-right">Taxas cobradas dos clientes</Th>
              <Th className="text-right">Recebido na porta</Th>
              <Th className="text-right">A pagar ao entregador</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.courier?.id ?? 'none'}>
                <Td className="font-medium text-slate-900">{row.courier?.name ?? 'Sem entregador informado'}</Td>
                <Td className="text-right tabular-nums">{row.deliveries}</Td>
                <Td className="text-right tabular-nums">{formatMoney(row.feesChargedCents)}</Td>
                <Td className="text-right tabular-nums">{formatMoney(row.collectedCents)}</Td>
                <Td className="text-right font-semibold tabular-nums">
                  {row.courier ? formatMoney(row.toPayCents) : '—'}
                  {row.courier && row.courier.feePerDeliveryCents > 0 && (
                    <span className="block text-xs font-normal text-slate-500">
                      {row.deliveries} × {formatMoney(row.courier.feePerDeliveryCents)}
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
