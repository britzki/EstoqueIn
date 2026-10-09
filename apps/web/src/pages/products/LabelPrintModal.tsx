import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer } from 'lucide-react';
import { formatMoney } from '../../lib/format';
import type { Product } from '../../lib/types';
import { Barcode } from '../../components/Barcode';
import { Button, DecimalInput, Field, Modal } from '../../components/ui';

/** Etiquetas de gôndola: nome, preço e código de barras, impressas via window.print(). */
export function LabelPrintModal({ product, onClose }: { product: Product & { barcode: string }; onClose: () => void }) {
  const [copies, setCopies] = useState(6);
  // Quantidade de etiquetas é sempre inteira (de 1 a 60).
  const count = Math.min(Math.max(Math.floor(copies) || 1, 1), 60);

  const label = (
    <div
      className="flex flex-col items-center rounded border border-dashed border-slate-300 p-2 text-center"
      style={{ breakInside: 'avoid' }}
    >
      <p className="line-clamp-2 text-xs font-medium text-slate-900">{product.name}</p>
      <p className="text-base font-bold text-slate-900">{formatMoney(product.priceCents)}</p>
      <Barcode value={product.barcode} height={36} className="max-w-full" />
    </div>
  );

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title="Imprimir etiquetas"
        description="Etiquetas com nome, preço e código de barras."
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Fechar
            </Button>
            <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>
              Imprimir {count}
            </Button>
          </>
        }
      >
        <Field label="Quantidade de etiquetas">
          {(id) => <DecimalInput id={id} value={copies} onChange={(value) => setCopies(Number(value))} />}
        </Field>
        <p className="mt-4 mb-2 text-sm font-medium text-slate-700">Pré-visualização</p>
        <div className="w-56">{label}</div>
      </Modal>

      {createPortal(
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: count }, (_, index) => (
            <div key={index}>{label}</div>
          ))}
        </div>,
        document.getElementById('print-root')!,
      )}
    </>
  );
}
