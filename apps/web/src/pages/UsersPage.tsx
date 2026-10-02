import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { ROLE_LABEL, formatDate } from '../lib/format';
import type { Role, User } from '../lib/types';
import {
  Badge,
  Button,
  Card,
  ErrorMessage,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Table,
  Td,
  Th,
  type Tone,
} from '../components/ui';

const ROLE_TONE: Record<Role, Tone> = { ADMIN: 'violet', MANAGER: 'blue', OPERATOR: 'brand', VIEWER: 'gray' };

const ROLE_DESCRIPTION: Record<Role, string> = {
  ADMIN: 'Acesso total, inclusive usuários.',
  MANAGER: 'Cadastros, ajustes, inventário e relatórios.',
  OPERATOR: 'Entradas, saídas, transferências e contagem.',
  VIEWER: 'Consulta e relatórios, sem alterar nada.',
};

export function UsersPage() {
  const { session } = useAuth();
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/users') });

  return (
    <>
      <PageHeader
        title="Usuários e permissões"
        description="Cada perfil libera um conjunto de ações no sistema."
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            Novo usuário
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(Object.keys(ROLE_LABEL) as Role[]).map((role) => (
          <Card key={role} className="p-4">
            <Badge tone={ROLE_TONE[role]}>{ROLE_LABEL[role]}</Badge>
            <p className="mt-2 text-sm text-slate-600">{ROLE_DESCRIPTION[role]}</p>
          </Card>
        ))}
      </div>

      <Card>
        {users.isPending ? (
          <Spinner />
        ) : users.isError ? (
          <div className="p-4">
            <ErrorMessage error={users.error} />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Usuário</Th>
                <Th>Perfil</Th>
                <Th>Situação</Th>
                <Th className="hidden sm:table-cell">Criado em</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {users.data.map((user) => (
                <tr key={user.id}>
                  <Td>
                    <p className="font-medium text-slate-900">
                      {user.name}{' '}
                      {user.id === session?.user.id && (
                        <span className="text-xs font-normal text-slate-500">(você)</span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500">{user.email}</p>
                  </Td>
                  <Td>
                    <Badge tone={ROLE_TONE[user.role]}>{ROLE_LABEL[user.role]}</Badge>
                  </Td>
                  <Td>{user.active ? <Badge tone="green">Ativo</Badge> : <Badge>Inativo</Badge>}</Td>
                  <Td className="hidden text-slate-500 sm:table-cell">{formatDate(user.createdAt)}</Td>
                  <Td className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(user)}
                      aria-label={`Editar ${user.name}`}
                    >
                      <Pencil className="size-4" />
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {editing && <UserModal user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function UserModal({ user, onClose }: { user: User | null; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: user?.name ?? '',
    email: user?.email ?? '',
    role: user?.role ?? ('OPERATOR' as Role),
    password: '',
    active: user?.active ?? true,
  });

  const save = useMutation({
    mutationFn: () =>
      user
        ? api.patch(`/users/${user.id}`, {
            name: form.name,
            role: form.role,
            active: form.active,
            password: form.password || undefined,
          })
        : api.post('/users', { name: form.name, email: form.email, role: form.role, password: form.password }),
    onSuccess: () => {
      toast.success(user ? 'Usuário atualizado' : 'Usuário criado');
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
  });
  const errors = save.error instanceof ApiError ? save.error.fieldErrors : {};

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={user ? 'Editar usuário' : 'Novo usuário'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="user-form" loading={save.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={onSubmit} className="space-y-4">
        {save.error && !Object.keys(errors).length ? <ErrorMessage error={save.error} /> : null}
        <Field label="Nome" required error={errors.name?.[0]}>
          {(id) => (
            <Input id={id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          )}
        </Field>
        <Field label="E-mail" required={!user} error={errors.email?.[0]}>
          {(id) => (
            <Input
              id={id}
              type="email"
              value={form.email}
              disabled={Boolean(user)}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          )}
        </Field>
        <Field label="Perfil" hint={ROLE_DESCRIPTION[form.role]}>
          {(id) => (
            <Select id={id} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {(Object.keys(ROLE_LABEL) as Role[]).map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={user ? 'Nova senha' : 'Senha'}
          required={!user}
          error={errors.password?.[0]}
          hint={user ? 'Deixe em branco para manter a atual.' : 'Mínimo de 8 caracteres.'}
        >
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required={!user}
            />
          )}
        </Field>
        {user && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
              className="size-4 accent-brand-700"
            />
            Usuário ativo
          </label>
        )}
      </form>
    </Modal>
  );
}
