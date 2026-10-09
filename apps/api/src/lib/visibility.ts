import type { Request } from 'express';
import { can } from '../auth/permissions.js';
import { currentUser } from '../middleware/auth.js';

/**
 * Números do negócio (faturamento, custo, margem, valor do estoque) são só do dono e do gerente.
 * Quem tem `reports:read` (administrador e gerente) vê; os outros perfis recebem esses campos vazios.
 * Proteger aqui, e não só na tela, impede que alguém veja os valores pelo navegador.
 */
export const canSeeFinancials = (req: Request) => can(currentUser(req).role, 'reports:read');

/**
 * Venda sem custo (nem do total, nem dos itens, nem das devoluções), para quem não vê números do negócio.
 * A composição do kit guardada no item (kitComponents) também leva o custo de cada componente.
 */
export function saleWithoutCost<
  T extends {
    costCents?: number | null;
    items?: Array<{ unitCostCents?: number | null; kitComponents?: string | null }>;
  },
>(req: Request, sale: T): T {
  if (canSeeFinancials(req)) return sale;
  const clean = { ...sale, costCents: null } as T & { returns?: Array<{ costCents?: number | null }> };
  if (sale.items) clean.items = sale.items.map((item) => ({ ...item, unitCostCents: null, kitComponents: null }));
  if (clean.returns) clean.returns = clean.returns.map((r) => ({ ...r, costCents: null }));
  return clean;
}

/** Tira o custo de um produto para quem não pode ver números do negócio. */
export function withoutCost<T extends { costCents?: number | null }>(req: Request, product: T): T {
  return canSeeFinancials(req) ? product : { ...product, costCents: null };
}

/**
 * Movimentações de estoque (e resultados que as contêm) sem o custo unitário.
 * Percorre o objeto inteiro porque entradas, transferências e granel devolvem as movimentações aninhadas.
 */
export function movementsWithoutCost<T>(req: Request, value: T): T {
  return canSeeFinancials(req) ? value : (stripUnitCost(value) as T);
}

function stripUnitCost(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUnitCost);
  if (value === null || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [key, key === 'unitCostCents' ? null : stripUnitCost(inner)]),
  );
}
