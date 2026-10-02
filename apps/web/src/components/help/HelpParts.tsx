import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useStoreSettings } from '../../lib/hooks';
import type { HelpArticle } from '../../lib/help';
import { SUPPORT_WHATSAPP_LABEL, supportLink } from '../../lib/support';

/** Texto da resposta: parágrafos e, quando começam com "1.", passos numerados. */
export function HelpAnswer({ article, className }: { article: HelpArticle; className?: string }) {
  const blocks: Array<{ kind: 'p'; text: string } | { kind: 'ol'; items: string[] }> = [];
  for (const line of article.answer) {
    const step = line.match(/^\d+\.\s+(.*)$/);
    const last = blocks.at(-1);
    if (step && last?.kind === 'ol') last.items.push(step[1]);
    else if (step) blocks.push({ kind: 'ol', items: [step[1]] });
    else blocks.push({ kind: 'p', text: line });
  }
  return (
    <div className={cn('space-y-2 text-sm text-slate-700', className)}>
      {blocks.map((block, index) =>
        block.kind === 'p' ? (
          <p key={index}>{block.text}</p>
        ) : (
          <ol key={index} className="list-decimal space-y-1 pl-5">
            {block.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}

/** Abre o WhatsApp do suporte com a versão, a loja e (se houver) a dúvida já escritas. */
export function SupportButton({ question, className }: { question?: string; className?: string }) {
  const { data: settings } = useStoreSettings();
  const [href, setHref] = useState<string>();
  useEffect(() => {
    let active = true;
    supportLink({ storeName: settings?.storeName, question }).then((link) => active && setHref(link));
    return () => {
      active = false;
    };
  }, [settings?.storeName, question]);

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700',
        !href && 'pointer-events-none opacity-60',
        className,
      )}
    >
      <MessageCircle className="size-4" /> Falar com o suporte
    </a>
  );
}

export const supportLabel = `WhatsApp ${SUPPORT_WHATSAPP_LABEL}`;
