import type { Request } from 'express';
import { badRequest } from './errors.js';

/** Lê um parâmetro de rota garantindo que é uma string simples. */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value === '') throw badRequest(`Parâmetro "${name}" inválido`);
  return value;
}
