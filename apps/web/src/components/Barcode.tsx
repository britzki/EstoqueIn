import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

const isEan13 = (code: string) => /^\d{13}$/.test(code);

/** Renderiza o código como SVG: EAN-13 quando possível, senão Code 128. */
export function Barcode({ value, height = 60, className }: { value: string; height?: number; className?: string }) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, value, {
        format: isEan13(value) ? 'EAN13' : 'CODE128',
        height,
        width: 2,
        fontSize: 14,
        margin: 8,
        background: '#ffffff',
      });
    } catch {
      JsBarcode(ref.current, value, { format: 'CODE128', height, width: 2, fontSize: 14, margin: 8 });
    }
  }, [value, height]);

  return <svg ref={ref} className={className} role="img" aria-label={`Código de barras ${value}`} />;
}
