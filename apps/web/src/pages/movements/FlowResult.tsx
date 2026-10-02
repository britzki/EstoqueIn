import type { ReactNode } from 'react';
import { Bell, BellOff, CircleCheck, PackageCheck, RefreshCw, Scale, TriangleAlert } from 'lucide-react';
import clsx from 'clsx';
import { MOVEMENT_LABEL, formatNumber } from '../../lib/format';
import type { AlertType, MovementResult } from '../../lib/types';

const ALERT_DETAIL: Record<AlertType, string> = {
  LOW_STOCK: 'Estoque abaixo do mínimo',
  OUT_OF_STOCK: 'Produto sem estoque',
  NEGATIVE_STOCK: 'Estoque negativo: confira a contagem',
};

/**
 * Mostra, passo a passo, o que o sistema fez com a movimentação:
 * registro → saldo atualizado → checagem do mínimo → alerta.
 */
export function FlowResult({
  result,
  warehouseName,
  min,
  unit,
}: {
  result: MovementResult;
  warehouseName: string;
  min: number;
  unit: string;
}) {
  const { movement, balance, alert } = result;
  const before = balance - movement.quantity;
  const threshold = alert.kind === 'none' ? min : alert.alert.threshold;

  const alertStep: { tone: Tone; icon: ReactNode; title: string; detail: string } = (() => {
    switch (alert.kind) {
      case 'opened':
        return {
          tone: 'warning',
          icon: <Bell />,
          title: 'Alerta aberto',
          detail: ALERT_DETAIL[alert.alert.type],
        };
      case 'escalated':
        return {
          tone: 'danger',
          icon: <TriangleAlert />,
          title: 'Alerta agravado',
          detail: 'Saldo zerou — sem estoque',
        };
      case 'updated':
        return {
          tone: 'warning',
          icon: <Bell />,
          title: 'Alerta continua aberto',
          detail: 'Saldo ainda no mínimo ou abaixo',
        };
      case 'resolved':
        return {
          tone: 'success',
          icon: <CircleCheck />,
          title: 'Alerta resolvido',
          detail: 'Saldo voltou acima do mínimo',
        };
      default:
        return {
          tone: 'neutral',
          icon: <BellOff />,
          title: 'Nenhum alerta',
          detail: threshold > 0 ? 'Saldo acima do mínimo' : 'Produto sem mínimo definido',
        };
    }
  })();

  const steps = [
    {
      tone: 'success' as Tone,
      icon: <PackageCheck />,
      title: `${MOVEMENT_LABEL[movement.type]} registrada`,
      detail: `${movement.quantity > 0 ? '+' : ''}${formatNumber(movement.quantity)} ${unit} em ${warehouseName}`,
    },
    {
      tone: 'success' as Tone,
      icon: <RefreshCw />,
      title: 'Saldo atualizado',
      detail: `${formatNumber(before)} → ${formatNumber(balance)}`,
    },
    {
      tone: 'success' as Tone,
      icon: <Scale />,
      title: 'Estoque mínimo verificado',
      detail:
        threshold > 0
          ? `Mínimo ${formatNumber(threshold)} · saldo ${balance <= threshold ? '≤' : '>'} mínimo`
          : 'Sem mínimo configurado',
    },
    alertStep,
  ];

  return (
    <ol className="relative space-y-4">
      {steps.map((step, index) => (
        <li key={index} className="relative flex gap-3">
          {index < steps.length - 1 && (
            <span className="absolute top-8 left-4 h-[calc(100%-1rem)] w-px bg-slate-200" aria-hidden />
          )}
          <span
            className={clsx(
              'relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full [&>svg]:size-4',
              TONES[step.tone],
            )}
          >
            {step.icon}
          </span>
          <div className="pt-1">
            <p className="text-sm font-medium text-slate-900">{step.title}</p>
            <p className="text-sm text-slate-500">{step.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

type Tone = 'success' | 'warning' | 'danger' | 'neutral';

const TONES: Record<Tone, string> = {
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-red-100 text-red-700',
  neutral: 'bg-slate-100 text-slate-500',
};
