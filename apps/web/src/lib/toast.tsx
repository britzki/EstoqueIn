import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { TriangleAlert, CircleCheck, Info, X, CircleX } from 'lucide-react';
import clsx from 'clsx';

type ToastKind = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}

type Notify = (title: string, description?: string) => void;

interface ToastApi {
  success: Notify;
  error: Notify;
  warning: Notify;
  info: Notify;
}

const ToastContext = createContext<ToastApi | null>(null);

const STYLES: Record<ToastKind, { icon: typeof Info; className: string }> = {
  success: { icon: CircleCheck, className: 'text-emerald-600' },
  error: { icon: CircleX, className: 'text-red-600' },
  warning: { icon: TriangleAlert, className: 'text-amber-600' },
  info: { icon: Info, className: 'text-sky-600' },
};

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), []);

  const push = useCallback(
    (kind: ToastKind): Notify =>
      (title, description) => {
        const id = nextId++;
        setItems((current) => [...current.slice(-3), { id, kind, title, description }]);
        setTimeout(() => dismiss(id), kind === 'error' || kind === 'warning' ? 7000 : 4000);
      },
    [dismiss],
  );

  const api = useMemo(
    () => ({ success: push('success'), error: push('error'), warning: push('warning'), info: push('info') }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:left-auto sm:w-96">
        {items.map((item) => {
          const { icon: Icon, className } = STYLES[item.kind];
          return (
            <div
              key={item.id}
              role="status"
              className="pointer-events-auto flex w-full gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-lg"
            >
              <Icon className={clsx('mt-0.5 size-5 shrink-0', className)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">{item.title}</p>
                {item.description && <p className="mt-0.5 text-sm text-slate-600">{item.description}</p>}
              </div>
              <button
                onClick={() => dismiss(item.id)}
                className="text-slate-400 hover:text-slate-600"
                aria-label="Fechar notificação"
              >
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast deve ser usado dentro de <ToastProvider>');
  return context;
}
