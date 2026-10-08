import type { Request } from 'express';
import { can } from '../auth/permissions.js';
import { currentUser } from '../middleware/auth.js';

/**
 * Números do negócio (faturamento, custo, margem, valor do estoque) são só do dono e do gerente.
 * Quem tem `reports:read` (administrador e gerente) vê; os outros perfis recebem esses campos vazios.
 * Proteger aqui, e não só na tela, impede que alguém veja os valores pelo navegador.
 */
export const canSeeFinancials = (req: Request) => can(currentUser(req).role, 'reports:read');

/** Venda sem custo (nem do total, nem dos itens, nem das devoluções), para quem não vê números do negócio. */
export function saleWithoutCost<
  T extends { costCents?: number | null; items?: Array<{ unitCostCents?: number | null }> },
>(req: Request, sale: T): T {
  if (canSeeFinancials(req)) return sale;
  const clean = { ...sale, costCents: null } as T & { returns?: Array<{ costCents?: number | null }> };
  if (sale.items) clean.items = sale.items.map((item) => ({ ...item, unitCostCents: null }));
  if (clean.returns) clean.returns = clean.returns.map((r) => ({ ...r, costCents: null }));
  return clean;
}

/** Tira o custo de um produto para quem não pode ver números do negócio. */
export function withoutCost<T extends { costCents?: number | null }>(req: Request, product: T): T {
  return canSeeFinancials(req) ? product : { ...product, costCents: null };
}
