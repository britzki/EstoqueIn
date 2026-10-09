import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError, tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import type { Session } from '../lib/types';
import { Button, ErrorMessage, Field, Input, Modal } from './ui';
import { Logo } from './Logo';

function ChangePasswordForm({ onDone }: { onDone?: () => void }) {
  const toast = useToast();
  const { updateSession } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [mismatch, setMismatch] = useState(false);

  const change = useMutation({
    mutationFn: () =>
      api.post<Session & { token: string }>('/auth/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      }),
    onSuccess: ({ token, ...session }) => {
      // A troca de senha encerra as outras sessões; esta continua com o token novo.
      tokenStore.set(token);
      updateSession(session);
      toast.success('Senha alterada');
      onDone?.();
    },
  });
  const errors = change.error instanceof ApiError ? change.error.fieldErrors : {};

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (form.newPassword !== form.confirm) return setMismatch(true);
    setMismatch(false);
    change.mutate();
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {change.error && !Object.keys(errors).length ? <ErrorMessage error={change.error} /> : null}
      <Field label="Senha atual" required>
        {(id) => (
          <Input
            id={id}
            type="password"
            autoComplete="current-password"
            value={form.currentPassword}
            onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
            required
            autoFocus
          />
        )}
      </Field>
      <Field label="Nova senha" required error={errors.newPassword?.[0]} hint="Mínimo de 8 caracteres.">
        {(id) => (
          <Input
            id={id}
            type="password"
            autoComplete="new-password"
            value={form.newPassword}
            onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
            required
          />
        )}
      </Field>
      <Field label="Confirmar nova senha" required error={mismatch ? 'As senhas não conferem' : undefined}>
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
      <Button type="submit" className="w-full" loading={change.isPending}>
        Salvar nova senha
      </Button>
    </form>
  );
}

/** Troca voluntária, aberta pelo menu do usuário. */
export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="Alterar minha senha">
      <ChangePasswordForm onDone={onClose} />
    </Modal>
  );
}

/** Tela obrigatória quando o usuário entrou com uma senha temporária. */
export function ForcedPasswordChange() {
  const { logout } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Logo className="mb-8" />
        <h1 className="text-2xl font-semibold tracking-tight">Crie uma nova senha</h1>
        <p className="mt-1 mb-6 text-sm text-slate-500">
          Você entrou com uma senha temporária. Para continuar, defina uma senha que só você conheça.
        </p>
        <ChangePasswordForm />
        <button onClick={logout} className="mt-4 w-full text-center text-sm text-slate-500 hover:text-slate-900">
          Sair
        </button>
      </div>
    </div>
  );
}
