export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code = 'APP_ERROR',
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (entity: string) => new AppError(404, `${entity} não encontrado(a)`, 'NOT_FOUND');

export const badRequest = (message: string, details?: unknown) => new AppError(400, message, 'BAD_REQUEST', details);

export const conflict = (message: string) => new AppError(409, message, 'CONFLICT');

export const unprocessable = (message: string, code = 'UNPROCESSABLE', details?: unknown) =>
  new AppError(422, message, code, details);
