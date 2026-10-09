/**
 * Base dos comprovantes da impressora térmica de bobina (58 ou 80 mm): notinha de venda,
 * guia de entrega e fechamento de caixa. Nenhum deles é documento fiscal.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { desktop } from '../lib/desktop';
import { useToast } from '../lib/toast';
import type { StoreSettings } from '../lib/types';

/** Linha "descrição ........ valor". */
export const SLIP_ROW = 'flex justify-between gap-2';

/** Linha tracejada que separa as partes do comprovante. */
export const SlipRule = () => <div className="my-1.5 border-t border-dashed border-black" />;

/** Papel da bobina: largura útil e tamanho da letra conforme a impressora. */
export function SlipFrame({ settings, children }: { settings: StoreSettings; children: ReactNode }) {
  const narrow = settings.receiptWidth === 58;
  return (
    <div
      className="bg-white font-mono leading-tight text-black"
      style={{ width: narrow ? '48mm' : '72mm', fontSize: narrow ? '10px' : '11.5px', padding: '2mm' }}
    >
      {children}
    </div>
  );
}

// Uma impressão por vez na página inteira: todos os comprovantes usam a mesma área (#print-root),
// e a notinha e a guia de entrega podem ser pedidas quase juntas.
let printQueue = Promise.resolve();

/**
 * Imprime um comprovante na bobina: monta o conteúdo na área de impressão (#print-root) e chama a impressora.
 * No programa desktop a impressão é direta (sem diálogo) se a impressora estiver configurada.
 */
export function useSlipPrinter(settings: StoreSettings | undefined) {
  const toast = useToast();
  const [job, setJob] = useState<{ content: ReactNode; done: () => void } | null>(null);
  // Se a tela que pediu a impressão fechar antes, libera a fila para as próximas impressões.
  const mounted = useRef(true);
  const pending = useRef<(() => void) | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current?.();
    };
  }, []);

  useEffect(() => {
    if (!job || !settings) return;
    // Espera o conteúdo aparecer na página antes de imprimir.
    const timer = setTimeout(async () => {
      try {
        if (desktop) {
          // Impressora desligada ou sem papel: avisa, em vez de o atendente achar que imprimiu.
          const result = await desktop.printReceipt(settings.receiptWidth);
          if (!result.ok && result.error && result.error !== 'cancelled') {
            toast.error('Não foi possível imprimir', result.error);
          }
        } else window.print();
      } catch (error) {
        toast.error('Não foi possível imprimir', (error as Error).message);
      } finally {
        setJob(null);
        pending.current = null;
        job.done();
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [job, settings, toast]);

  const print = useCallback((content: ReactNode) => {
    printQueue = printQueue.then(
      () =>
        new Promise<void>((done) => {
          if (!mounted.current) return done();
          pending.current = done;
          setJob({ content, done });
        }),
    );
  }, []);

  const portal =
    job && settings
      ? createPortal(
          <>
            <style>{'@media print { @page { margin: 0; } }'}</style>
            {job.content}
          </>,
          document.getElementById('print-root')!,
        )
      : null;

  return { print, portal };
}
