import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { MulterError } from 'multer';
import { ZodError, z } from 'zod';
import { AppError } from '../lib/errors.js';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Rota ${req.method} ${req.path} não encontrada` } });
}

export function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction) {
  // Resposta já começou a ser enviada (ex.: download): o Express encerra a conexão.
  if (res.headersSent) return next(err);

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Dados inválidos',
        details: z.flattenError(err).fieldErrors,
      },
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = (err.meta?.target as string[] | string | undefined) ?? 'campo';
      res.status(409).json({
        error: { code: 'CONFLICT', message: `Já existe um registro com este valor (${target})` },
      });
      return;
    }
    if (err.code === 'P2003') {
      res.status(400).json({ error: { code: 'INVALID_REFERENCE', message: 'Registro relacionado não existe' } });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Registro não encontrado' } });
      return;
    }
  }

  if (err instanceof MulterError) {
    res.status(400).json({ error: { code: 'UPLOAD_ERROR', message: err.message } });
    return;
  }

  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'JSON inválido no corpo da requisição' } });
    return;
  }

  // Erros do leitor do corpo da requisição (corpo grande demais, codificação não suportada...).
  const status = (err as { status?: unknown; type?: unknown } | null)?.status;
  if (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    typeof (err as { type?: unknown }).type === 'string'
  ) {
    const message = status === 413 ? 'Dados grandes demais para enviar de uma vez' : 'Requisição inválida';
    res.status(status).json({ error: { code: 'BAD_REQUEST', message } });
    return;
  }

  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno do servidor' } });
}
