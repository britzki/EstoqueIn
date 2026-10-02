import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Store } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useSetupStatus } from '../lib/hooks';
import type { Session } from '../lib/types';
import { Button, Card, ErrorMessage, Field, Input, Spinner } from '../components/ui';
import { Logo } from '../components/Logo';

/** Primeira execução: cria o administrador da empresa ou carrega a demonstração. */
export function SetupPage() {
  const { startSession } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const status = useSetupStatus();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    confirm: '',
    warehouseName: 'Estoque principal',
  });
  const [mismatch, setMismatch] = useState(false);

  const fresh = useMutation({
    mutationFn: () =>
      api.post<Session & { token: string }>('/setup', {
        mode: 'fresh',
        name: form.name,
        email: form.email,
        password: form.password,
        warehouseName: form.warehouseName,
      }),
    onSuccess: (session) => {
      startSession(session);
      queryClient.invalidateQueries({ queryKey: ['setup'] });
      navigate('/', { replace: true });
    },
  });

  const demo = useMutation({
    mutationFn: () => api.post('/setup', { mode: 'demo' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['setup'] });
      navigate('/login', { replace: true });
    },
  });

  if (status.isPending) return <Spinner />;
  if (status.data && !status.data.needsSetup) return <Navigate to="/login" replace />;

  const errors = fresh.error instanceof ApiError ? fresh.error.fieldErrors : {};
  const busy = fresh.isPending || demo.isPending;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (form.password !== form.confirm) return setMismatch(true);
    setMismatch(false);
    fresh.mutate();
  };

  return (
    <div className="min-h-screen px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-4xl">
        <Logo className="mb-8" />
        <h1 className="text-3xl font-semibold tracking-tight">Bem-vindo ao EstoqueIn</h1>
        <p className="mt-2 text-slate-500">Vamos preparar o sistema. Escolha como quer começar.</p>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-5">
          <Card className="p-6 lg:col-span-3">
            <div className="mb-5 flex items-center gap-3">
              <span className="rounded-lg bg-brand-50 p-2 text-brand-700">
                <Store className="size-5" />
              </span>
              <div>
                <h2 className="font-semibold">Começar a usar</h2>
                <p className="text-sm text-slate-500">Crie o acesso do administrador da empresa.</p>
              </div>
            </div>

            <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {fresh.error && !Object.keys(errors).length ? (
                <div className="sm:col-span-2">
                  <ErrorMessage error={fresh.error} />
                </div>
              ) : null}
              <Field label="Seu nome" required error={errors.name?.[0]} className="sm:col-span-2">
                {(id) => (
                  <Input
                    id={id}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                    autoFocus
                  />
                )}
              </Field>
              <Field label="E-mail (usado para entrar)" required error={errors.email?.[0]} className="sm:col-span-2">
                {(id) => (
                  <Input
                    id={id}
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    required
                  />
                )}
              </Field>
              <Field label="Senha" required error={errors.password?.[0]} hint="Mínimo de 8 caracteres.">
                {(id) => (
                  <Input
                    id={id}
                    type="password"
                    autoComplete="new-password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    required
                  />
                )}
              </Field>
              <Field label="Confirmar senha" required error={mismatch ? 'As senhas não conferem' : undefined}>
                {(id) => (
                  <Input
                    id={id}
                    type="password"
                    autoComplete="new-password"
                    value={form.confirm}
                    onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                    required
                  />
                )}
              </Field>
              <Field
                label="Nome do seu estoque"
                error={errors.warehouseName?.[0]}
                hint="Você pode cadastrar outros locais depois, em Estoques."
                className="sm:col-span-2"
              >
                {(id) => (
                  <Input
                    id={id}
                    value={form.warehouseName}
                    onChange={(e) => setForm({ ...form, warehouseName: e.target.value })}
                  />
                )}
              </Field>
              <div className="sm:col-span-2">
                <Button type="submit" className="w-full" loading={fresh.isPending} disabled={busy}>
                  Criar acesso e entrar
                </Button>
              </div>
            </form>
          </Card>

          <Card className="h-fit p-6 lg:col-span-2">
            <div className="mb-3 flex items-center gap-3">
              <span className="rounded-lg bg-violet-50 p-2 text-violet-700">
                <Sparkles className="size-5" />
              </span>
              <h2 className="font-semibold">Só quero conhecer</h2>
            </div>
            <p className="text-sm text-slate-600">
              Carrega uma mercearia fictícia com depósito, duas lojas, 18 produtos e 45 dias de movimentações, alertas e
              um inventário em andamento.
            </p>
            {demo.error && (
              <div className="mt-4">
                <ErrorMessage error={demo.error} />
              </div>
            )}
            <Button
              variant="secondary"
              className="mt-5 w-full"
              onClick={() => demo.mutate()}
              loading={demo.isPending}
              disabled={busy}
            >
              {demo.isPending ? 'Gerando dados...' : 'Explorar com dados de demonstração'}
            </Button>
            {demo.isPending && (
              <p className="mt-2 text-center text-xs text-slate-500">Isso leva cerca de 20 segundos.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
