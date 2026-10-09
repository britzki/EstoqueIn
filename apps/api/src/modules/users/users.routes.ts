import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { notFound, unprocessable } from '../../lib/errors.js';
import { currentUser } from '../../middleware/auth.js';
import { param } from '../../lib/http.js';
import { actorOf, diff, recordAudit, recordUpdate } from '../../lib/audit.js';
import { emailSchema, hashPassword, passwordSchema } from '../../auth/passwords.js';

export const usersRoutes = Router();

const roles = ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'] as const;
const password = passwordSchema();

const createSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  email: emailSchema,
  role: z.enum(roles),
  password,
});

const updateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: z.enum(roles).optional(),
  active: z.boolean().optional(),
  password: password.optional(),
});

const publicFields = { id: true, name: true, email: true, role: true, active: true, createdAt: true } as const;

usersRoutes.get('/', async (_req, res) => {
  const users = await prisma.user.findMany({ select: publicFields, orderBy: { name: 'asc' } });
  res.json(users);
});

usersRoutes.post('/', async (req, res) => {
  const { password: plain, ...data } = createSchema.parse(req.body);
  const user = await prisma.user.create({
    data: { ...data, passwordHash: await hashPassword(plain) },
    select: publicFields,
  });
  await recordAudit(actorOf(req), {
    action: 'CREATE',
    entity: 'User',
    entityId: user.id,
    summary: `Usuário ${user.name} criado com o perfil ${user.role}`,
  });
  res.status(201).json(user);
});

usersRoutes.patch('/:id', async (req, res) => {
  const { password: plain, ...data } = updateSchema.parse(req.body);
  const target = await prisma.user.findUnique({ where: { id: param(req, 'id') } });
  if (!target) throw notFound('Usuário');

  const isSelf = target.id === currentUser(req).id;
  if (isSelf && (data.active === false || (data.role && data.role !== 'ADMIN'))) {
    throw unprocessable('Você não pode desativar nem rebaixar o próprio usuário');
  }

  const user = await prisma.user.update({
    where: { id: target.id },
    // Senha definida por outra pessoa é temporária: o usuário troca no próximo acesso, e as sessões
    // abertas com a senha antiga caem (ex.: senha vazada). A sessão do próprio administrador continua.
    data: {
      ...data,
      ...(plain && {
        passwordHash: await hashPassword(plain),
        mustChangePassword: !isSelf,
        ...(!isSelf && { tokenVersion: { increment: 1 } }),
      }),
    },
    select: publicFields,
  });
  await recordUpdate(actorOf(req), {
    entity: 'User',
    entityId: user.id,
    summary: `Usuário ${user.name} alterado${plain ? ' (senha redefinida)' : ''}`,
    changes: {
      ...diff(target, data, ['name', 'role', 'active']),
      ...(plain && { password: { from: '•••', to: 'redefinida' } }),
    },
  });
  res.json(user);
});
