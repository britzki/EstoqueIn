import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine, Lock } from 'lucide-react';
import { api } from '../../lib/api';
import { useCurrentCash, useSaleWarehouse } from '../../lib/hooks';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { formatDateTime, formatMoney, parseMoneyInput } from '../../lib/format';
import type { CashDetail } from '../../lib/types';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ErrorMessage,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
} from '../../components/ui';
import { CashDetailModal, CashHistory } from './CashHistory';
import { CashSummaryView } from './CashSummary';
import { CloseCashModal } from './CloseCashModal';
import { invalidateCash, OpenCashForm } from './OpenCashForm';

export function CashPage() {
  const { can } = useAuth();
  const { warehouses, warehouseId, setWarehouseId } = useSaleWarehouse();
  const current = useCurrentCash(warehouseId);
  const [viewing, setViewing] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Caixa"
        description="Abertura com o troco, sangrias e suprimentos, e o fechamento com a conferência do dinheiro."
        actions={
          warehouses.length > 1 && (
            <Select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="w-auto"
              aria-label="Estoque do caixa"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  Caixa de: {w.name}
                </option>
              ))}
            </Select>
          )
        }
      />

      {current.isLoading ? (
        <Spinner />
      ) : current.error ? (
        <ErrorMessage error={current.error} />
      ) : current.data ? (
        <OpenCash cash={current.data} canOperate={can('sales:create')} />
      ) : (
        <Card className="mb-6">
          <CardHeader
            title="Caixa fechado"
            description="Conte o dinheiro da gaveta e informe o troco para começar o dia."
          />
          {can('sales:create') ? (
            <OpenCashForm warehouseId={warehouseId} />
          ) : (
            <p className="p-5 text-sm text-slate-500">Seu perfil não abre o caixa.</p>
          )}
        </Card>
      )}

      {/* Outro estoque, outra lista: começa de novo na página 1. */}
      <CashHistory key={warehouseId} warehouseId={warehouseId} onOpen={setViewing} />
      {viewing && <CashDetailModal id={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

function OpenCash({ cash, canOperate }: { cash: CashDetail; canOperate: boolean }) {
  const [movement, setMovement] = useState<'WITHDRAWAL' | 'DEPOSIT' | null>(null);
  const [closing, setClosing] = useState(false);

  return (
    <div className="mb-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-slate-600">
          <Badge tone="green">Aberto</Badge>
          Caixa nº {cash.number} · aberto por {cash.openedBy.name} em {formatDateTime(cash.openedAt)}
        </p>
        {cash.summary.openingDifferenceCents ? (
          <p className="w-full rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800 lg:order-last">
            Abriu com {formatMoney(cash.openingCents)}, mas no último fechamento ficaram{' '}
            {formatMoney(cash.summary.previousKeptCents ?? 0)} na gaveta (diferença de{' '}
            {formatMoney(cash.summary.openingDifferenceCents)}).
          </p>
        ) : null}
        {canOperate && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              icon={<ArrowUpFromLine className="size-4" />}
              onClick={() => setMovement('WITHDRAWAL')}
            >
              Sangria
            </Button>
            <Button
              variant="secondary"
              icon={<ArrowDownToLine className="size-4" />}
              onClick={() => setMovement('DEPOSIT')}
            >
              Suprimento
            </Button>
            <Button icon={<Lock className="size-4" />} onClick={() => setClosing(true)}>
              Fechar caixa
            </Button>
          </div>
        )}
      </div>
      <CashSummaryView cash={cash} />
      {movement && <MovementModal cash={cash} type={movement} onClose={() => setMovement(null)} />}
      {closing && <CloseCashModal cash={cash} onClose={() => setClosing(false)} />}
    </div>
  );
}

function MovementModal({
  cash,
  type,
  onClose,
}: {
  cash: CashDetail;
  type: 'WITHDRAWAL' | 'DEPOSIT';
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const withdrawal = type === 'WITHDRAWAL';
  const save = useMutation({
    mutationFn: () =>
      api.post<CashDetail>(`/cash/${cash.id}/movements`, {
        type,
        amountCents: parseMoneyInput(amount) ?? 0,
        reason,
      }),
    onSuccess: () => {
      invalidateCash(queryClient);
      toast.success(withdrawal ? 'Sangria registrada' : 'Suprimento registrado');
      onClose();
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={withdrawal ? 'Sangria (retirada de dinheiro)' : 'Suprimento (reforço de troco)'}
      description={
        withdrawal
          ? 'Dinheiro tirado da gaveta: depósito no banco, pagamento de fornecedor, motoboy...'
          : 'Dinheiro colocado na gaveta durante o dia.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} disabled={!parseMoneyInput(amount)} onClick={() => save.mutate()}>
            Registrar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.error && <ErrorMessage error={save.error} />}
        <Field label="Valor (R$)" required>
          {(id) => (
            <Input id={id} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoFocus />
          )}
        </Field>
        <Field label="Motivo" required>
          {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={160} />}
        </Field>
      </div>
    </Modal>
  );
}
