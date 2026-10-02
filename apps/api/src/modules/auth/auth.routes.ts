import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { authenticate, currentUser, type AuthUser } from '../../middleware/auth.js';
import { permissionsFor } from '../../auth/permissions.js';
import { signToken } from '../../auth/tokens.js';
import { recordAudit } from '../../lib/audit.js';

export const authRoutes = Router();

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('E-mail inválido')),
  password: z.string().min(1, 'Informe a senha'),
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Muitas tentativas. Tente novamente em alguns minutos.' } },
});

const toSession = (user: AuthUser) => ({
  user: { id: user.id, name: user.name, email: user.email, role: user.role },
  permissions: permissionsFor(user.role),
  mustChangePassword: user.mustChangePassword,
});

authRoutes.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email } });

  // Mesmo erro para e-mail inexistente e senha errada, para não revelar quais e-mails existem.
  const valid = user?.active && (await bcrypt.compare(password, user.passwordHash));
  if (!user || !valid) throw new AppError(401, 'E-mail ou senha inválidos', 'INVALID_CREDENTIALS');

  res.json({ token: signToken(user.id), ...toSession(user) });
});

authRoutes.get('/me', authenticate, (req, res) => {
  res.json(toSession(currentUser(req)));
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Informe a senha atual'),
  newPassword: z.string().min(8, 'A nova senha deve ter pelo menos 8 caracteres').max(72),
});

/** O próprio usuário troca a senha (obrigatório quando a senha é temporária). */
authRoutes.post('/change-password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
  const session = currentUser(req);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.id } });

  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new AppError(422, 'A senha atual não confere', 'WRONG_PASSWORD');
  }
  if (currentPassword === newPassword)
    throw new AppError(422, 'A nova senha deve ser diferente da atual', 'SAME_PASSWORD');

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(newPassword, 10), mustChangePassword: false },
  });
  await recordAudit(session, {
    action: 'SECURITY',
    entity: 'User',
    entityId: user.id,
    summary: `${user.name} trocou a própria senha`,
  });

  res.json(toSession({ ...session, mustChangePassword: false }));
});
