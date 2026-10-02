import { useState } from 'react';
import { ChevronDown, LifeBuoy, Search } from 'lucide-react';
import { cn } from '../lib/cn';
import { HELP_ARTICLES, HELP_CATEGORIES, searchHelp, type HelpArticle, type HelpCategory } from '../lib/help';
import { useDebounced } from '../lib/hooks';
import { Card, CardHeader, EmptyState, Input, PageHeader } from '../components/ui';
import { HelpAnswer, SupportButton, supportLabel } from '../components/help/HelpParts';
import { HelpAssistant } from '../components/help/HelpAssistant';

/** Central de ajuda: perguntas frequentes com busca, assistente e contato com o suporte. */
export function HelpPage() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<HelpCategory | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const query = useDebounced(search.trim(), 200);

  const results: HelpArticle[] = query
    ? searchHelp(query, 12).map((match) => match.article)
    : HELP_ARTICLES.filter((article) => !category || article.category === category);

  return (
    <>
      <PageHeader
        title="Central de ajuda"
        description="Perguntas frequentes sobre o EstoqueIn. Funciona sem internet."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOpenId(null);
              }}
              placeholder="Buscar: fechar caixa, devolução, etiqueta da balança..."
              className="h-11 pl-9"
              aria-label="Buscar nas perguntas"
            />
          </div>

          {!query && (
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Categorias">
              {[null, ...HELP_CATEGORIES].map((item) => (
                <button
                  key={item ?? 'todas'}
                  type="button"
                  role="tab"
                  aria-selected={category === item}
                  onClick={() => {
                    setCategory(item);
                    setOpenId(null);
                  }}
                  className={cn(
                    'rounded-full border px-3 py-1 text-sm',
                    category === item
                      ? 'border-brand-700 bg-brand-50 text-brand-800'
                      : 'border-slate-300 text-slate-600 hover:bg-slate-50',
                  )}
                >
                  {item ?? 'Todas'}
                </button>
              ))}
            </div>
          )}

          <Card>
            {results.length === 0 ? (
              <EmptyState
                icon={<LifeBuoy />}
                title="Nenhuma pergunta encontrada"
                description="Tente outras palavras, pergunte ao assistente ao lado ou fale com o suporte."
                action={<SupportButton question={query} />}
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {results.map((article) => {
                  const open = openId === article.id;
                  return (
                    <li key={article.id}>
                      <button
                        type="button"
                        onClick={() => setOpenId(open ? null : article.id)}
                        aria-expanded={open}
                        className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-slate-50"
                      >
                        <span>
                          <span className="block text-sm font-medium text-slate-900">{article.question}</span>
                          {(query || !category) && <span className="text-xs text-slate-500">{article.category}</span>}
                        </span>
                        <ChevronDown
                          className={cn('size-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')}
                        />
                      </button>
                      {open && <HelpAnswer article={article} className="px-5 pb-4" />}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="flex h-[32rem] flex-col overflow-hidden">
            <CardHeader title="Pergunte ao assistente" description="Escreva a dúvida do seu jeito." />
            <HelpAssistant />
          </Card>
          <Card className="p-5">
            <p className="font-medium text-slate-900">Não encontrou?</p>
            <p className="mt-1 mb-3 text-sm text-slate-500">
              Fale com o suporte pelo {supportLabel}. Se for um erro, gere antes o arquivo em Ajuda → Gerar arquivo de
              diagnóstico (menu do programa) e envie junto.
            </p>
            <SupportButton />
          </Card>
        </div>
      </div>
    </>
  );
}
