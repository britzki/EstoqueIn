import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bike, Plus } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { centsToInput, formatMoney, formatPhone, parseMoneyInput } from '../../lib/format';
import { useToast } from '../../lib/toast';
import type { Courier } from '../../lib/types';
import { Badge, Button, Card, CardHeader, ErrorMessage, Field, Input, Modal, Spinner } from '../../components/ui';

/** Entregadores: quem leva as entregas e quanto recebe por entrega (para o acerto). */
export function CouriersCard() {
  const [editing, setEditing] = useState<Courier | 'new' | null>(null);
  const { data: couriers, isLoading } = useQuery({
    queryKey: ['couriers'],
    queryFn: () => api.get<Courier[]>('/couriers'),
  });

  return (
    <Card>
      <CardHeader
        title="Entregadores"
        description="Escolhidos quando a entrega sai. O acerto mostra quantas entregas cada um fez e quanto pagar."
        actions={
          <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            Novo entregador
          </Button>
        }
      />
      <div className="p-5">
        {isLoading ? (
          <Spinner />
        ) : !couriers?.length ? (
          <p className="text-sm text-slate-500">Nenhum entregador ainda. Exemplo: o motoboy que faz as entregas.</p>
        ) : (
          <ul className="space-y-2">
            {couriers.map((courier) => (
              <li
                key={courier.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  <Bike className="size-4 text-brand-700" />
                  <span className="font-medium text-slate-900">{courier.name}</span>
                  {courier.phone && <span className="text-slate-500">{formatPhone(courier.phone)}</span>}
                  {!courier.active && <Badge>Desativado</Badge>}
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-slate-600">
                    {courier.feePerDeliveryCents > 0
                      ? `${formatMoney(courier.feePerDeliveryCents)} por entrega`
                      : 'sem valor por entrega'}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(courier)}>
                    Editar
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {editing && <CourierModal courier={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function CourierModal({ courier, onClose }: { courier: Courier | null; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState(courier?.name ?? '');
  const [phone, setPhone] = useState(courier?.phone ?? '');
  const [fee, setFee] = useState(courier?.feePerDeliveryCents ? centsToInput(courier.feePerDeliveryCents) : '');
  const [active, setActive] = useState(courier?.active ?? true);
  // Vazio = sem valor por entrega; texto que não é valor não vira R$ 0,00 sem avisar.
  const feeInvalid = fee.trim() !== '' && parseMoneyInput(fee) === null;

  const save = useMutation({
    mutationFn: () => {
      const body = { name, phone, feePerDeliveryCents: parseMoneyInput(fee) ?? 0, active };
      return courier ? api.patch<Courier>(`/couriers/${courier.id}`, body) : api.post<Courier>('/couriers', body);
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['couriers'] });
      toast.success(courier ? 'Entregador alterado' : 'Entregador cadastrado', saved.name);
      onClose();
    },
  });
  const errors = save.error instanceof ApiError ? save.error.fieldErrors : {};

  return (
    <Modal
      open
      onClose={onClose}
      title={courier ? 'Editar entregador' : 'Novo entregador'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            loading={save.isPending}
            disabled={name.trim().length < 2 || feeInvalid}
            onClick={() => save.mutate()}
          >
            Salvar
          </Button>
        </>
      }
    >
      {save.error && !Object.keys(errors).length ? <ErrorMessage error={save.error} /> : null}
      <div className="space-y-4">
        <Field label="Nome" required error={errors.name?.[0]}>
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}
        </Field>
        <Field label="Telefone / WhatsApp" error={errors.phone?.[0]}>
          {(id) => (
            <Input
              id={id}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              placeholder="(11) 91234-5678"
            />
          )}
        </Field>
        <Field
          label="Quanto a loja paga por entrega (R$)"
          hint="Para o acerto. Deixe em branco se combinar de outro jeito."
          error={feeInvalid ? 'Valor inválido' : errors.feePerDeliveryCents?.[0]}
        >
          {(id) => (
            <Input
              id={id}
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
            />
          )}
        </Field>
        {courier && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="size-4 accent-brand-700"
            />
            Ativo (aparece na hora de mandar a entrega)
          </label>
        )}
      </div>
    </Modal>
  );
}
