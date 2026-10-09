import type { AuthUser } from '../middleware/auth.js';
import { permissionsFor } from './permissions.js';

/** O que a interface recebe sobre quem está logado (login, /auth/me, configuração inicial). */
export const toSession = (user: AuthUser) => ({
  user: { id: user.id, name: user.name, email: user.email, role: user.role },
  permissions: permissionsFor(user.role),
  mustChangePassword: user.mustChangePassword,
});
