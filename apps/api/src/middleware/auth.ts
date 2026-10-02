import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { can, type Permission } from '../auth/permissions.js';
import { verifyToken } from '../auth/tokens.js';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** Está com senha temporária e precisa trocá-la antes de usar o sistema. */
  mustChangePassword: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const unauthorized = () => new AppError(401, 'Sessão inválida ou expirada', 'UNAUTHORIZED');

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const [scheme, token] = req.headers.authorization?.split(' ') ?? [];
  if (scheme !== 'Bearer' || !token) throw unauthorized();

  let userId: string;
  try {
    userId = verifyToken(token).sub;
  } catch {
    throw unauthorized();
  }

  // Busca o usuário a cada requisição para que desativações e trocas de perfil valham na hora.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, active: true, mustChangePassword: true },
  });
  if (!user?.active) throw unauthorized();

  req.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  };
  next();
}

export const requirePermission = (permission: Permission) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user || !can(req.user.role, permission)) {
    throw new AppError(403, 'Você não tem permissão para esta ação', 'FORBIDDEN');
  }
  next();
};

/** Enquanto a senha for temporária, a única coisa permitida é trocá-la. */
export function requirePasswordChanged(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.mustChangePassword) {
    throw new AppError(403, 'Troque a senha temporária para continuar', 'PASSWORD_CHANGE_REQUIRED');
  }
  next();
}

/** Usuário autenticado da requisição (rotas protegidas por `authenticate`). */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
