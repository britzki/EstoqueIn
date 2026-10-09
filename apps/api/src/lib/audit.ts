import type { Request } from 'express';
import { prisma, type Tx } from './prisma.js';

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'IMPORT' | 'SECURITY';

export interface AuditActor {
  id?: string | null;
  name: string;
}

interface AuditEntry {
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  summary: string;
  changes?: Changes;
}

export type Changes = Record<string, { from: unknown; to: unknown }>;

/** Campos que nunca entram no registro (a troca de senha é registrada, a senha não). */
const SECRET_FIELDS = new Set(['passwordHash', 'password']);

/**
 * Compara o registro antes e depois e devolve só o que mudou, entre os campos informados.
 * `undefined` no "depois" significa "campo não enviado" e é ignorado.
 */
export function diff<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  fields: Array<keyof T & string>,
): Changes {
  const changes: Changes = {};
  for (const field of fields) {
    if (SECRET_FIELDS.has(field) || after[field] === undefined) continue;
    const from = before[field] ?? null;
    const to = after[field] ?? null;
    if (!sameValue(from, to)) changes[field] = { from, to };
  }
  return changes;
}

/** Datas chegam como objetos diferentes (do banco e do formulário): compara pelo instante. */
const sameValue = (a: unknown, b: unknown) =>
  a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;

/** Grava um registro no histórico de alterações. */
export async function recordAudit(actor: AuditActor, entry: AuditEntry, client: Tx = prisma) {
  await client.auditLog.create({
    data: {
      userId: actor.id ?? null,
      userName: actor.name,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      summary: entry.summary,
      changes: entry.changes && Object.keys(entry.changes).length ? JSON.stringify(entry.changes) : null,
    },
  });
}

/** Registra uma alteração somente se algum campo realmente mudou. */
export async function recordUpdate(actor: AuditActor, entry: Omit<AuditEntry, 'action'> & { changes: Changes }) {
  if (Object.keys(entry.changes).length === 0) return;
  await recordAudit(actor, { ...entry, action: 'UPDATE' });
}

export const actorOf = (req: Request): AuditActor => ({ id: req.user?.id, name: req.user?.name ?? 'Sistema' });
