import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, Pencil, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { Button, ErrorMessage, Input, Modal, Spinner } from '../../components/ui';

interface CategorySummary {
  name: string;
  active: number;
  inactive: number;
  loyaltyRules: string[];
}

/**
 * Gerenciar categorias: renomear (renomeando para uma que já existe, as duas viram uma) e remover.
 * Corrige de uma vez categorias digitadas de jeitos diferentes ("Racao" e "Rações").
 */
export function CategoriesModal({ onClose }: { onClose: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const {
    data: categories,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['categories', 'summary'],
    queryFn: () => api.get<CategorySummary[]>('/products/categories/summary'),
  });

  const refresh = () => {
    for (const key of ['categories', 'products', 'product', 'loyalty-rules', 'reports']) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  };

  const rename = useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) =>
      api.post<{ products: number; merged: boolean }>('/products/categories/rename', { from, to }),
    onSuccess: (result, { from, to }) => {
      toast.success(
        result.merged ? `"${from}" juntada a "${to}"` : `Categoria renomeada para "${to}"`,
        `${result.products} produto(s) atualizado(s).`,
      );
      setEditing(null);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (category: string) => api.post<{ products: number }>('/products/categories/remove', { category }),
    onSuccess: (result, category) => {
      toast.success(`Categoria "${category}" removida`, `${result.products} produto(s) ficaram sem categoria.`);
      setRemoving(null);
      refresh();
    },
  });

  const existing = new Set(categories?.map((category) => category.name));
  const target = newName.trim();
  const willMerge = editing !== null && target !== editing && existing.has(target);

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Categorias"
      description='Para juntar duas categorias (ex.: "Racao" e "Rações"), renomeie uma com o nome exato da outra.'
      footer={<Button onClick={onClose}>Fechar</Button>}
    >
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorMessage error={error} />
      ) : !categories?.length ? (
        <p className="text-sm text-slate-500">Nenhuma categoria ainda. Elas são criadas no cadastro dos produtos.</p>
      ) : (
        <div className="space-y-3">
          {(rename.error || remove.error) && <ErrorMessage error={rename.error ?? remove.error} />}
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {categories.map((category) => (
              <li key={category.name} className="px-4 py-3 text-sm">
                {editing === category.name ? (
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      rename.mutate({ from: category.name, to: target });
                    }}
                  >
                    <Input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="h-9 w-64"
                      maxLength={60}
                      autoFocus
                      aria-label={`Novo nome para ${category.name}`}
                      list="category-names"
                    />
                    <Button
                      size="sm"
                      type="submit"
                      loading={rename.isPending}
                      disabled={!target || target === category.name}
                    >
                      {willMerge ? 'Juntar' : 'Renomear'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      Cancelar
                    </Button>
                    {willMerge && (
                      <p className="w-full text-xs text-amber-700">
                        "{target}" já existe: os produtos de "{category.name}" passam para ela e as duas viram uma.
                      </p>
                    )}
                  </form>
                ) : removing === category.name ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-slate-700">
                      Remover "{category.name}"? Os {category.active + category.inactive} produto(s) ficam sem
                      categoria.
                    </span>
                    <span className="flex gap-2">
                      <Button
                        size="sm"
                        variant="danger"
                        loading={remove.isPending}
                        onClick={() => remove.mutate(category.name)}
                      >
                        Remover
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRemoving(null)}>
                        Voltar
                      </Button>
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-medium text-slate-900">{category.name}</span>
                      <span className="block text-xs text-slate-500">
                        {category.active} produto(s)
                        {category.inactive > 0 && ` · ${category.inactive} inativo(s)`}
                      </span>
                      {category.loyaltyRules.length > 0 && (
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-brand-700">
                          <Gift className="size-3" /> Cartão fidelidade: {category.loyaltyRules.join(', ')}
                        </span>
                      )}
                    </span>
                    {can('products:write') && (
                      <span className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Pencil className="size-3.5" />}
                          onClick={() => {
                            setEditing(category.name);
                            setNewName(category.name);
                            setRemoving(null);
                          }}
                        >
                          Renomear
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Trash2 className="size-3.5" />}
                          disabled={category.loyaltyRules.length > 0}
                          title={
                            category.loyaltyRules.length > 0
                              ? 'Usada por um cartão fidelidade: mude o cartão antes de remover'
                              : undefined
                          }
                          onClick={() => {
                            setRemoving(category.name);
                            setEditing(null);
                          }}
                        >
                          Remover
                        </Button>
                      </span>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <datalist id="category-names">
            {categories.map((category) => (
              <option key={category.name} value={category.name} />
            ))}
          </datalist>
        </div>
      )}
    </Modal>
  );
}
