import bcrypt from 'bcryptjs';
import { z } from 'zod';

/** Custo do bcrypt: lento o bastante contra força bruta, rápido o bastante para o login (~0,1 s). */
const HASH_ROUNDS = 10;

/** Senha nova: 8 a 72 caracteres (o bcrypt ignora o que passa de 72 bytes). */
export const passwordSchema = (label = 'A senha') =>
  z.string().min(8, `${label} deve ter pelo menos 8 caracteres`).max(72);

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email('E-mail inválido'));

export const hashPassword = (plain: string) => bcrypt.hash(plain, HASH_ROUNDS);

export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

// Hash de uma senha qualquer, usado quando o e-mail não existe: o login demora o mesmo tempo
// nos dois casos, então não dá para descobrir quais e-mails estão cadastrados medindo a resposta.
const DUMMY_HASH = bcrypt.hashSync('estoquein-usuario-inexistente', HASH_ROUNDS);

/** Confere a senha de um usuário que pode não existir, sempre no mesmo tempo. */
export const verifyLogin = (plain: string, hash: string | undefined) => bcrypt.compare(plain, hash ?? DUMMY_HASH);
