import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';

interface TokenPayload {
  sub: string;
  /** Versão do login do usuário (User.tokenVersion). Tokens antigos, sem ela, valem como versão 0. */
  ver?: number;
}

export const signToken = (user: { id: string; tokenVersion: number }) =>
  jwt.sign({ sub: user.id, ver: user.tokenVersion } satisfies TokenPayload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  });

export const verifyToken = (token: string) => jwt.verify(token, env.JWT_SECRET) as TokenPayload;
