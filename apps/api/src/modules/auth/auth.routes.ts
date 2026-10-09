import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { authenticate, currentUser } from '../../middleware/auth.js';
import { emailSchema, hashPassword, passwordSchema, verifyLogin, verifyPassword } from '../../auth/passwords.js';
import { toSession } from '../../auth/session.js';
import { signToken } from '../../auth/tokens.js';
import { recordAudit } from '../../lib/audit.js';

export const authRoutes = Router();

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Informe a senha'),
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  // Só tentativas erradas contam: no computador da loja todos entram pelo mesmo endereço.
  skipSuccessfulRequests: true,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Muitas tentativas. Tente novamente em alguns minutos.' } },
});

authRoutes.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email } });

  // Mesmo erro (e mesmo tempo de resposta) para e-mail inexistente e senha errada,
  // para não revelar quais e-mails existem.
  const matches = await verifyLogin(password, user?.passwordHash);
  if (!user?.active || !matches) throw new AppError(401, 'E-mail ou senha inválidos', 'INVALID_CREDENTIALS');

  res.json({ token: signToken(user), ...toSession(user) });
});

authRoutes.get('/me', authenticate, (req, res) => {
  res.json(toSession(currentUser(req)));
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Informe a senha atual'),
  newPassword: passwordSchema('A nova senha'),
});

/** O próprio usuário troca a senha (obrigatório quando a senha é temporária). */
authRoutes.post('/change-password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
  const session = currentUser(req);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.id } });

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new AppError(422, 'A senha atual não confere', 'WRONG_PASSWORD');
  }
  if (currentPassword === newPassword)
    throw new AppError(422, 'A nova senha deve ser diferente da atual', 'SAME_PASSWORD');

  // Nova versão do login: sessões abertas em outros lugares com a senha antiga caem; esta recebe um token novo.
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false, tokenVersion: { increment: 1 } },
  });
  await recordAudit(session, {
    action: 'SECURITY',
    entity: 'User',
    entityId: user.id,
    summary: `${user.name} trocou a própria senha`,
  });

  res.json({ token: signToken(updated), ...toSession({ ...session, mustChangePassword: false }) });
});
