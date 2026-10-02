import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { notFound, unprocessable } from '../../lib/errors.js';
import { currentUser } from '../../middleware/auth.js';
import { param } from '../../lib/http.js';
import { actorOf, diff, recordAudit, recordUpdate } from '../../lib/audit.js';

export const usersRoutes = Router();

const roles = ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'] as const;
const password = z.string().min(8, 'A senha deve ter pelo menos 8 caracteres').max(72);

const createSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  email: z.string().trim().toLowerCase().pipe(z.email('E-mail inválido')),
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
    data: { ...data, passwordHash: await bcrypt.hash(plain, 10) },
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
    // Senha definida por outra pessoa é temporária: o usuário troca no próximo acesso.
    data: { ...data, ...(plain && { passwordHash: await bcrypt.hash(plain, 10), mustChangePassword: !isSelf }) },
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
