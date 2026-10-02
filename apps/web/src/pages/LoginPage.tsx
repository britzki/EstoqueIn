import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { Bell, ScanBarcode, ArrowLeftRight, ChartColumn } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useSetupStatus } from '../lib/hooks';
import { Button, ErrorMessage, Field, Input } from '../components/ui';
import { Logo } from '../components/Logo';

const FEATURES = [
  { icon: <ArrowLeftRight />, text: 'Entradas, saídas e transferências entre estoques' },
  { icon: <Bell />, text: 'Alertas automáticos de estoque mínimo' },
  { icon: <ScanBarcode />, text: 'Leitor de código de barras e inventário' },
  { icon: <ChartColumn />, text: 'Relatórios, curva ABC e exportação CSV' },
];

export function LoginPage() {
  const { session, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  const status = useSetupStatus();
  const demoAccounts = status.data?.demoAccounts ?? [];

  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/';
  if (session) return <Navigate to={redirectTo} replace />;
  if (status.data?.needsSetup) return <Navigate to="/setup" replace />;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden overflow-hidden bg-slate-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -top-24 -right-24 size-96 rounded-full bg-brand-700/30 blur-3xl" aria-hidden />
        <Logo className="relative text-white" />
        <div className="relative">
          <h1 className="max-w-md text-4xl font-semibold tracking-tight">
            Seu estoque sob controle, do recebimento ao balcão.
          </h1>
          <p className="mt-4 max-w-md text-slate-400">
            Produto chegou, entrada registrada, saldo atualizado — e se ficar abaixo do mínimo, o alerta aparece na
            hora.
          </p>
          <ul className="mt-10 space-y-4">
            {FEATURES.map((feature) => (
              <li key={feature.text} className="flex items-center gap-3 text-slate-300">
                <span className="rounded-lg bg-slate-800 p-2 text-brand-200 [&>svg]:size-4">{feature.icon}</span>
                {feature.text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-slate-500">Gestão de estoque para pequenas empresas</p>
      </section>

      <section className="flex items-center justify-center px-4 py-12 sm:px-6">
        <div className="w-full max-w-sm">
          <Logo className="mb-8 lg:hidden" />
          <h2 className="text-2xl font-semibold tracking-tight">Entrar</h2>
          <p className="mt-1 text-sm text-slate-500">
            {demoAccounts.length
              ? 'Use uma das contas de demonstração abaixo.'
              : 'Informe seu e-mail e senha de acesso.'}
          </p>

          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            {error ? <ErrorMessage error={error} /> : null}
            <Field label="E-mail">
              {(id) => (
                <Input
                  id={id}
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </Field>
            <Field label="Senha">
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>
            <Button type="submit" className="w-full" loading={submitting}>
              Entrar
            </Button>
          </form>

          {demoAccounts.length > 0 && (
            <div className="mt-8">
              <p className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">Contas de demonstração</p>
              <div className="grid grid-cols-2 gap-2">
                {demoAccounts.map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    onClick={() => {
                      setEmail(account.email);
                      setPassword(account.password);
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm hover:border-brand-600 hover:bg-brand-50"
                  >
                    <span className="block font-medium text-slate-900">{account.role}</span>
                    <span className="block truncate text-xs text-slate-500">{account.email}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
