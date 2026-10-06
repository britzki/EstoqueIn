import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { notFound, unprocessable } from '../../lib/errors.js';
import { actorOf, recordAudit } from '../../lib/audit.js';
import { requirePermission } from '../../middleware/auth.js';

/**
 * Categorias de produto. São texto livre no cadastro, então "Racao" e "Rações" viram duas.
 * Aqui dá para renomear (e, renomeando para uma que já existe, juntar) ou remover, de uma vez só.
 */
export const categoriesRoutes = Router();

const name = z.string().trim().min(1, 'Informe o nome').max(60);

/** Categorias com a quantidade de produtos ativos e inativos em cada uma. */
categoriesRoutes.get('/summary', async (_req, res) => {
  const [groups, rules] = await Promise.all([
    prisma.product.groupBy({
      by: ['category', 'active'],
      where: { category: { not: null } },
      _count: { _all: true },
    }),
    prisma.loyaltyRule.findMany({ where: { category: { not: null } }, select: { category: true, name: true } }),
  ]);
  const byName = new Map<string, { name: string; active: number; inactive: number; loyaltyRules: string[] }>();
  for (const group of groups) {
    const entry = byName.get(group.category!) ?? { name: group.category!, active: 0, inactive: 0, loyaltyRules: [] };
    if (group.active) entry.active += group._count._all;
    else entry.inactive += group._count._all;
    byName.set(group.category!, entry);
  }
  for (const rule of rules) byName.get(rule.category!)?.loyaltyRules.push(rule.name);
  res.json([...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
});

/** Renomeia; se o nome novo já existe, as duas categorias viram uma (junta). */
categoriesRoutes.post('/rename', requirePermission('products:write'), async (req, res) => {
  const { from, to } = z.object({ from: name, to: name }).parse(req.body);
  if (from === to) throw unprocessable('O nome novo é igual ao atual');
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.product.count({ where: { category: from } });
    if (existing === 0) throw notFound('Categoria');
    const merged = (await tx.product.count({ where: { category: to } })) > 0;
    const products = await tx.product.updateMany({ where: { category: from }, data: { category: to } });
    const rules = await tx.loyaltyRule.updateMany({ where: { category: from }, data: { category: to } });
    return { products: products.count, loyaltyRules: rules.count, merged };
  });
  await recordAudit(actorOf(req), {
    action: 'UPDATE',
    entity: 'Category',
    summary: result.merged
      ? `Categoria "${from}" juntada a "${to}" (${result.products} produto(s))`
      : `Categoria "${from}" renomeada para "${to}" (${result.products} produto(s))`,
  });
  res.json(result);
});

/** Remove a categoria: os produtos ficam sem categoria. Não remove se um cartão fidelidade usa. */
categoriesRoutes.post('/remove', requirePermission('products:write'), async (req, res) => {
  const { category } = z.object({ category: name }).parse(req.body);
  const rule = await prisma.loyaltyRule.findFirst({ where: { category } });
  if (rule) {
    throw unprocessable(
      `O cartão fidelidade "${rule.name}" usa esta categoria. Mude o cartão antes de remover.`,
      'CATEGORY_IN_USE',
    );
  }
  const { count } = await prisma.product.updateMany({ where: { category }, data: { category: null } });
  if (count === 0) throw notFound('Categoria');
  await recordAudit(actorOf(req), {
    action: 'UPDATE',
    entity: 'Category',
    summary: `Categoria "${category}" removida (${count} produto(s) ficaram sem categoria)`,
  });
  res.json({ products: count });
});
