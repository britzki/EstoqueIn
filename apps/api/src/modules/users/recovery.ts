import { randomInt } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { recordAudit } from '../../lib/audit.js';
import { hashPassword } from '../../auth/passwords.js';

// Sem caracteres que se confundem (0/O, 1/l/I) para a senha ser fácil de digitar.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

const temporaryPassword = (length = 10) => Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

/**
 * Recuperação de acesso sem internet: gera uma senha temporária para o administrador.
 *
 * Só é chamada de fora da API (menu do programa instalado ou linha de comando), ou seja,
 * por quem tem acesso físico ao computador. A senha precisa ser trocada no primeiro acesso
 * e a redefinição fica no registro de alterações.
 */
export async function resetAdminPassword(origin = 'menu do programa') {
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  // Prefere um administrador ativo; se todos estiverem desativados, reativa o mais antigo.
  const admin = admins.find((user) => user.active) ?? admins[0];
  if (!admin) throw new Error('Não há nenhum administrador cadastrado. Use a configuração inicial.');

  const password = temporaryPassword();
  await prisma.user.update({
    where: { id: admin.id },
    // A versão nova do login derruba qualquer sessão aberta com a senha antiga.
    data: {
      passwordHash: await hashPassword(password),
      mustChangePassword: true,
      active: true,
      tokenVersion: { increment: 1 },
    },
  });
  await recordAudit(
    { name: 'Recuperação de acesso' },
    {
      action: 'SECURITY',
      entity: 'User',
      entityId: admin.id,
      summary: `Senha do administrador ${admin.name} redefinida pelo ${origin}`,
    },
  );

  return { name: admin.name, email: admin.email, temporaryPassword: password };
}
