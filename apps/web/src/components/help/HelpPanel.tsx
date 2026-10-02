import { useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import { BookOpen, X } from 'lucide-react';
import { articlesForRoute } from '../../lib/help';
import { HelpAssistant } from './HelpAssistant';

/**
 * Painel de ajuda, aberto pelo botão "Ajuda" do menu ou pela tecla F1 em qualquer tela.
 * Já começa com as dúvidas da tela atual e tem atalho para a central de ajuda completa.
 */
export function HelpPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pathname } = useLocation();
  const local = articlesForRoute(pathname).slice(0, 4);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end print:hidden">
      <div className="absolute inset-0 bg-slate-900/20" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label="Ajuda"
        className="relative flex h-full w-full max-w-md flex-col bg-white shadow-xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <p className="font-semibold text-slate-900">Ajuda</p>
            <p className="text-xs text-slate-500">Respostas na hora, mesmo sem internet.</p>
          </div>
          <div className="flex items-center gap-1">
            <Link
              to="/help"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-brand-700 hover:bg-brand-50"
            >
              <BookOpen className="size-4" /> Todas as dúvidas
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Fechar ajuda"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>
        {/* key: ao trocar de tela, a conversa recomeça com as dúvidas da tela nova. */}
        <HelpAssistant key={pathname} suggestions={local.length ? local : undefined} />
      </aside>
    </div>
  );
}
