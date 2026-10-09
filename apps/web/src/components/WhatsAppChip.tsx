import { MessageCircle } from 'lucide-react';
import { whatsappLink } from '../lib/format';

/**
 * Abre a conversa no WhatsApp com a mensagem pronta (no programa instalado, no navegador padrão).
 * O clique não chega à linha da tabela em que o botão está.
 */
export function WhatsAppChip({ phone, message, label }: { phone: string | null; message: string; label: string }) {
  if (!phone) return <span className="text-xs text-slate-400">sem telefone</span>;
  return (
    <a
      href={whatsappLink(phone, message)}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium whitespace-nowrap text-emerald-800 hover:bg-emerald-100"
    >
      <MessageCircle className="size-3.5" /> {label}
    </a>
  );
}
