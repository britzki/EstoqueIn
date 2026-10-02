import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Bot, SendHorizontal, ThumbsDown, ThumbsUp } from 'lucide-react';
import { cn } from '../../lib/cn';
import { HELP_ARTICLES, searchHelp, type HelpArticle } from '../../lib/help';
import { HelpAnswer, SupportButton } from './HelpParts';

type Message =
  | { id: number; from: 'user'; text: string }
  | {
      id: number;
      from: 'bot';
      kind: 'answer';
      article: HelpArticle;
      related: HelpArticle[];
      question: string;
      feedback?: 'yes' | 'no';
    }
  | { id: number; from: 'bot'; kind: 'not-found'; question: string; related: HelpArticle[] }
  | { id: number; from: 'bot'; kind: 'text'; text: string };

let nextId = 1;

const STARTERS = ['fazer-venda', 'fechar-caixa', 'devolucao', 'entrada'].map((id) =>
  HELP_ARTICLES.find((article) => article.id === id)!,
);

/**
 * Assistente de dúvidas: procura a resposta nas perguntas frequentes, sem internet.
 * Quando não encontra (ou a resposta não resolveu), oferece o WhatsApp do suporte com a dúvida escrita.
 */
export function HelpAssistant({ suggestions = STARTERS }: { suggestions?: HelpArticle[] }) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: nextId++,
      from: 'bot',
      kind: 'text',
      text: 'Olá! Escreva sua dúvida do seu jeito, por exemplo "como devolvo um produto?" ou "caixa não bateu".',
    },
  ]);
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const ask = (question: string) => {
    const text = question.trim();
    if (!text) return;
    const matches = searchHelp(text, 4);
    const reply: Message = matches.length
      ? {
          id: nextId++,
          from: 'bot',
          kind: 'answer',
          article: matches[0].article,
          related: matches.slice(1, 4).map((match) => match.article),
          question: text,
        }
      : { id: nextId++, from: 'bot', kind: 'not-found', question: text, related: [] };
    setMessages((current) => [...current, { id: nextId++, from: 'user', text }, reply]);
    setInput('');
  };

  const show = (article: HelpArticle) =>
    setMessages((current) => [
      ...current,
      { id: nextId++, from: 'user', text: article.question },
      { id: nextId++, from: 'bot', kind: 'answer', article, related: [], question: article.question },
    ]);

  const giveFeedback = (id: number, feedback: 'yes' | 'no') =>
    setMessages((current) => {
      const updated = current.map((message) =>
        message.id === id && message.from === 'bot' && message.kind === 'answer' ? { ...message, feedback } : message,
      );
      const target = current.find((message) => message.id === id);
      if (feedback === 'yes') {
        return [
          ...updated,
          { id: nextId++, from: 'bot', kind: 'text', text: 'Que bom! Se tiver outra dúvida, é só escrever.' },
        ];
      }
      return [
        ...updated,
        {
          id: nextId++,
          from: 'bot',
          kind: 'not-found',
          question: target && 'question' in target ? target.question : '',
          related: target && target.from === 'bot' && target.kind === 'answer' ? target.related : [],
        },
      ];
    });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    ask(input);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {messages.map((message) =>
          message.from === 'user' ? (
            <div key={message.id} className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-brand-700 px-3 py-2 text-sm text-white">
                {message.text}
              </p>
            </div>
          ) : (
            <div key={message.id} className="flex gap-2">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                <Bot className="size-4" />
              </span>
              <div className="max-w-[88%] min-w-0 space-y-2 rounded-2xl rounded-tl-sm bg-slate-100 px-3 py-2">
                {message.kind === 'text' && <p className="text-sm text-slate-700">{message.text}</p>}

                {message.kind === 'answer' && (
                  <>
                    <p className="text-sm font-semibold text-slate-900">{message.article.question}</p>
                    <HelpAnswer article={message.article} />
                    {message.feedback === undefined ? (
                      <div className="flex items-center gap-2 pt-1 text-xs text-slate-500">
                        Resolveu?
                        <button
                          type="button"
                          onClick={() => giveFeedback(message.id, 'yes')}
                          className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-slate-700 hover:bg-emerald-50"
                        >
                          <ThumbsUp className="size-3.5" /> Sim
                        </button>
                        <button
                          type="button"
                          onClick={() => giveFeedback(message.id, 'no')}
                          className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-slate-700 hover:bg-red-50"
                        >
                          <ThumbsDown className="size-3.5" /> Não
                        </button>
                      </div>
                    ) : null}
                    {message.related.length > 0 && message.feedback === undefined && (
                      <RelatedList title="Também pode ajudar:" articles={message.related} onPick={show} />
                    )}
                  </>
                )}

                {message.kind === 'not-found' && (
                  <>
                    <p className="text-sm text-slate-700">
                      {message.related.length
                        ? 'Talvez uma destas responda:'
                        : 'Não encontrei essa resposta aqui. Tente com outras palavras ou fale com o suporte, que já recebe sua dúvida escrita.'}
                    </p>
                    {message.related.length > 0 && <RelatedList articles={message.related} onPick={show} />}
                    {message.related.length > 0 && (
                      <p className="text-sm text-slate-700">Se não, fale com o suporte:</p>
                    )}
                    <SupportButton question={message.question} />
                  </>
                )}
              </div>
            </div>
          ),
        )}
        {messages.length === 1 && suggestions.length > 0 && (
          <RelatedList title="Dúvidas comuns:" articles={suggestions} onPick={show} className="pl-9" />
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={onSubmit} className="flex gap-2 border-t border-slate-200 p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escreva sua dúvida..."
          aria-label="Sua dúvida"
          className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-sm focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="flex size-10 items-center justify-center rounded-lg bg-brand-700 text-white hover:bg-brand-800 disabled:opacity-50"
          aria-label="Enviar"
        >
          <SendHorizontal className="size-4" />
        </button>
      </form>
    </div>
  );
}

function RelatedList({
  title,
  articles,
  onPick,
  className,
}: {
  title?: string;
  articles: HelpArticle[];
  onPick: (article: HelpArticle) => void;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1', className)}>
      {title && <p className="text-xs text-slate-500">{title}</p>}
      {articles.map((article) => (
        <button
          key={article.id}
          type="button"
          onClick={() => onPick(article)}
          className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left text-sm text-brand-800 hover:bg-brand-50"
        >
          {article.question}
        </button>
      ))}
    </div>
  );
}
