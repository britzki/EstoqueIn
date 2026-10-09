import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { api } from '../../lib/api';
import { useStoreSettings } from '../../lib/hooks';
import { useToast } from '../../lib/toast';
import { centsToInput, formatMoney, parseMoneyInput } from '../../lib/format';
import type { CashDetail } from '../../lib/types';
import { useSlipPrinter } from '../../components/Slip';
import { Button, ErrorMessage, Field, Input, Modal, Textarea } from '../../components/ui';
import { CashSlip } from './CashSlip';
import { DifferenceNotice, WithdrawalNotice } from './CashSummary';
import { invalidateCash } from './OpenCashForm';

/** Fechamento: confere o dinheiro contado com o esperado e diz quanto retirar e quanto deixar na gaveta. */
export function CloseCashModal({ cash, onClose }: { cash: CashDetail; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: settings } = useStoreSettings();
  const slip = useSlipPrinter(settings);
  const [counted, setCounted] = useState('');
  const [kept, setKept] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [closed, setClosed] = useState<CashDetail | null>(null);

  const countedCents = parseMoneyInput(counted);
  const difference = countedCents === null ? null : countedCents - cash.summary.expectedCashCents;
  // Fica na gaveta: o troco fixo da loja (ou tudo o que houver, se faltar dinheiro), a menos que o usuário mude.
  // Campo vazio vale o padrão, como no servidor; texto que não é valor bloqueia o fechamento.
  const floatCents = settings?.cashFloatCents ?? 0;
  const defaultKept = floatCents > 0 && countedCents !== null ? Math.min(floatCents, countedCents) : null;
  const keptTyped = kept !== null && kept.trim() !== '';
  const keptCents = keptTyped ? parseMoneyInput(kept) : defaultKept;
  const keptInvalid = keptTyped && keptCents === null;
  const withdrawal = countedCents !== null && keptCents !== null ? countedCents - keptCents : null;
  const keptTooHigh = withdrawal !== null && withdrawal < 0;

  const close = useMutation({
    mutationFn: () =>
      api.post<CashDetail>(`/cash/${cash.id}/close`, { countedCents, keptCents: keptCents ?? undefined, notes }),
    onSuccess: (result) => {
      setClosed(result);
      // A tela só troca para "caixa fechado" ao concluir; antes disso, dá para imprimir o fechamento.
      toast.success(`Caixa nº ${result.number} fechado`);
    },
  });

  const finish = () => {
    invalidateCash(queryClient);
    onClose();
  };
  // Enquanto o fechamento está sendo gravado, a janela não fecha (senão a tela continuaria mostrando o caixa aberto).
  const dismiss = () => {
    if (!close.isPending) onClose();
  };

  if (closed) {
    return (
      <Modal
        open
        onClose={finish}
        title={`Caixa nº ${closed.number} fechado`}
        footer={
          <>
            <Button
              variant="secondary"
              icon={<Printer className="size-4" />}
              disabled={!settings}
              onClick={() => settings && slip.print(<CashSlip cash={closed} settings={settings} />)}
            >
              Imprimir fechamento
            </Button>
            <Button onClick={finish}>Concluir</Button>
          </>
        }
      >
        {slip.portal}
        <div className="space-y-3">
          <DifferenceNotice difference={closed.summary.differenceCents ?? 0} />
          {closed.keptCents !== null && (
            <WithdrawalNotice withdrawal={closed.summary.closingWithdrawalCents ?? 0} kept={closed.keptCents} />
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={dismiss}
      title={`Fechar caixa nº ${cash.number}`}
      description="Conte o dinheiro da gaveta (sem contar Pix e cartão) e informe o total."
      footer={
        <>
          <Button variant="ghost" onClick={dismiss} disabled={close.isPending}>
            Cancelar
          </Button>
          <Button
            loading={close.isPending}
            disabled={countedCents === null || keptTooHigh || keptInvalid}
            onClick={() => close.mutate()}
          >
            Fechar caixa
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {close.error && <ErrorMessage error={close.error} />}
        <dl className="space-y-1 rounded-lg bg-slate-50 px-4 py-3 text-sm">
          <Row label="Troco inicial" value={cash.openingCents} />
          <Row label="Vendas em dinheiro (já sem troco e devoluções)" value={cash.summary.byMethod.CASH ?? 0} />
          {cash.summary.accountReceivedByMethod.CASH > 0 && (
            <Row label="Fiado recebido em dinheiro" value={cash.summary.accountReceivedByMethod.CASH} />
          )}
          <Row label="Suprimentos" value={cash.summary.depositsCents} />
          <Row label="Sangrias" value={-cash.summary.withdrawalsCents || 0} />
          <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold text-slate-900">
            <dt>Esperado na gaveta</dt>
            <dd className="tabular-nums">{formatMoney(cash.summary.expectedCashCents)}</dd>
          </div>
        </dl>
        <Field label="Dinheiro contado (R$)" required>
          {(id) => (
            <Input id={id} value={counted} onChange={(e) => setCounted(e.target.value)} inputMode="decimal" autoFocus />
          )}
        </Field>
        {difference !== null && <DifferenceNotice difference={difference} />}
        <Field
          label="Fica na gaveta para amanhã (R$)"
          hint={
            floatCents > 0
              ? `Troco fixo da loja: ${formatMoney(floatCents)}. O resto é retirado.`
              : 'Deixe em branco para não registrar a retirada.'
          }
          error={keptInvalid ? 'Valor inválido' : keptTooHigh ? 'Não pode ser maior que o dinheiro contado' : undefined}
        >
          {(id) => (
            <Input
              id={id}
              value={kept ?? (defaultKept !== null ? centsToInput(defaultKept) : '')}
              onChange={(e) => setKept(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
            />
          )}
        </Field>
        {withdrawal !== null && !keptTooHigh && keptCents !== null && (
          <WithdrawalNotice withdrawal={withdrawal} kept={keptCents} />
        )}
        <Field label="Observação" hint="Ex.: explicação da diferença.">
          {(id) => <Textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-slate-600">
      <dt>{label}</dt>
      <dd className="tabular-nums">{formatMoney(value)}</dd>
    </div>
  );
}
