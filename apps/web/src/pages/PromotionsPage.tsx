import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgePercent, Plus } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { dayEndIso, dayStartIso, formatDate, formatMoney, parseMoneyInput, toDateInput } from '../lib/format';
import { promotionLabel } from '../lib/pricing';
import type { Product, Promotion } from '../lib/types';
import { ProductPicker } from '../components/ProductPicker';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorMessage,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Table,
  Tabs,
  Td,
  Th,
} from '../components/ui';

type Status = 'current' | 'scheduled' | 'ended';

/** Promoções com prazo: começam e terminam sozinhas, e o caixa já cobra o preço promocional. */
export function PromotionsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>('current');
  const [creating, setCreating] = useState(false);
  const promotions = useQuery({
    queryKey: ['promotions', 'list', status],
    queryFn: () =>
      api.get<Array<Promotion & { product: NonNullable<Promotion['product']> }>>('/promotions', { status }),
  });
  const end = useMutation({
    mutationFn: (id: string) => api.post(`/promotions/${id}/end`),
    onSuccess: () => {
      toast.success('Promoção encerrada', 'O preço voltou ao normal.');
      queryClient.invalidateQueries({ queryKey: ['promotions'] });
    },
  });

  return (
    <>
      <PageHeader
        title="Promoções"
        description="Preço promocional ou leve X, pague Y, com data para começar e terminar. O caixa aplica sozinho."
        actions={
          can('products:write') && (
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Nova promoção
            </Button>
          )
        }
      />
      <div className="mb-4">
        <Tabs
          value={status}
          onChange={setStatus}
          options={[
            { value: 'current', label: 'Valendo agora' },
            { value: 'scheduled', label: 'Agendadas' },
            { value: 'ended', label: 'Encerradas' },
          ]}
        />
      </div>
      <Card>
        {promotions.isPending ? (
          <Spinner />
        ) : promotions.isError ? (
          <div className="p-4">
            <ErrorMessage error={promotions.error} />
          </div>
        ) : promotions.data.length === 0 ? (
          <EmptyState
            icon={<BadgePercent />}
            title="Nenhuma promoção aqui"
            description="Crie uma promoção para um produto: ela começa e termina nas datas escolhidas."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Produto</Th>
                <Th>Promoção</Th>
                <Th className="hidden sm:table-cell text-right">Preço normal</Th>
                <Th>Período</Th>
                {status !== 'ended' && can('products:write') && <Th />}
              </tr>
            </thead>
            <tbody>
              {promotions.data.map((promotion) => (
                <tr key={promotion.id}>
                  <Td>
                    <span className="font-medium text-slate-900">{promotion.product.name}</span>
                    <span className="block text-xs text-slate-500">{promotion.product.sku}</span>
                  </Td>
                  <Td>
                    <Badge tone="green">{promotionLabel(promotion)}</Badge>
                  </Td>
                  <Td className="hidden sm:table-cell text-right tabular-nums">
                    {formatMoney(promotion.product.priceCents)}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {formatDate(promotion.startsAt)} a {formatDate(promotion.endsAt)}
                    {!promotion.active && (
                      <span className="block text-xs text-slate-500">encerrada antes do prazo</span>
                    )}
                  </Td>
                  {status !== 'ended' && can('products:write') && (
                    <Td className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={end.isPending && end.variables === promotion.id}
                        onClick={() => end.mutate(promotion.id)}
                      >
                        Encerrar
                      </Button>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {creating && <PromotionModal onClose={() => setCreating(false)} />}
    </>
  );
}

function PromotionModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const today = toDateInput(new Date());
  const [product, setProduct] = useState<Product | null>(null);
  const [type, setType] = useState<'PRICE' | 'BUY_X_PAY_Y'>('PRICE');
  const [price, setPrice] = useState('');
  const [buy, setBuy] = useState('3');
  const [pay, setPay] = useState('2');
  const [startsAt, setStartsAt] = useState(today);
  const [endsAt, setEndsAt] = useState(toDateInput(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)));

  const save = useMutation({
    mutationFn: () =>
      api.post('/promotions', {
        productId: product?.id,
        type,
        ...(type === 'PRICE'
          ? { priceCents: parseMoneyInput(price) }
          : { buyQuantity: Number(buy), payQuantity: Number(pay) }),
        startsAt: dayStartIso(startsAt),
        endsAt: dayEndIso(endsAt),
      }),
    onSuccess: () => {
      toast.success('Promoção criada');
      queryClient.invalidateQueries({ queryKey: ['promotions'] });
      onClose();
    },
  });
  const errors = save.error instanceof ApiError ? save.error.fieldErrors : {};

  return (
    <Modal
      open
      onClose={onClose}
      title="Nova promoção"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} disabled={!product || endsAt < startsAt} onClick={() => save.mutate()}>
            Criar promoção
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.error && !Object.keys(errors).length ? <ErrorMessage error={save.error} /> : null}
        <Field label="Produto" required>
          {(id) => <ProductPicker id={id} value={product} onChange={setProduct} autoFocus />}
        </Field>
        {product && <p className="-mt-2 text-sm text-slate-500">Preço normal: {formatMoney(product.priceCents)}</p>}
        <Field label="Tipo">
          {(id) => (
            <Select id={id} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="PRICE">Preço promocional</option>
              <option value="BUY_X_PAY_Y">Leve X, pague Y</option>
            </Select>
          )}
        </Field>
        {type === 'PRICE' ? (
          <Field label="Preço promocional (R$)" required error={errors.priceCents?.[0]}>
            {(id) => <Input id={id} value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />}
          </Field>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Leve" error={errors.buyQuantity?.[0]}>
              {(id) => <Input id={id} type="number" min={2} value={buy} onChange={(e) => setBuy(e.target.value)} />}
            </Field>
            <Field label="Pague" error={errors.payQuantity?.[0]}>
              {(id) => <Input id={id} type="number" min={1} value={pay} onChange={(e) => setPay(e.target.value)} />}
            </Field>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Começa em">
            {(id) => <Input id={id} type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />}
          </Field>
          <Field label="Termina em" hint="Vale até o fim do dia." error={errors.endsAt?.[0]}>
            {(id) => <Input id={id} type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />}
          </Field>
        </div>
      </div>
    </Modal>
  );
}
