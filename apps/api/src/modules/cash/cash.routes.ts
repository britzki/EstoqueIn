import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { param } from '../../lib/http.js';
import { paginated, paginationSchema, toSkipTake } from '../../lib/pagination.js';
import { actorOf, recordAudit } from '../../lib/audit.js';
import { formatCents } from '../../lib/money.js';
import { canSeeFinancials } from '../../lib/visibility.js';
import { currentUser, requirePermission } from '../../middleware/auth.js';
import {
  addCashMovement,
  closeCash,
  closeSchema,
  getCashSummary,
  getOpeningSuggestion,
  getOpenSession,
  movementSchema,
  openCash,
  openSchema,
} from './cash.service.js';

export const cashRoutes = Router();

/** Sem permissão de números do negócio: só o que é da gaveta (dinheiro), sem faturamento nem Pix/cartão. */
function forViewer(
  req: Parameters<typeof canSeeFinancials>[0],
  cash: Awaited<ReturnType<typeof getCashSummary>> | null,
) {
  if (!cash || canSeeFinancials(req)) return cash;
  return {
    ...cash,
    summary: {
      ...cash.summary,
      revenueCents: null,
      byMethod: { CASH: cash.summary.byMethod.CASH },
      // Fiado recebido: também só o que entrou em dinheiro na gaveta.
      accountReceivedByMethod: {
        CASH: cash.summary.accountReceivedByMethod.CASH,
        PIX: 0,
        DEBIT: 0,
        CREDIT: 0,
        OTHER: 0,
      },
      accountReceivedCents: cash.summary.accountReceivedByMethod.CASH,
    },
  };
}

/** Caixa aberto no estoque (ou null). */
cashRoutes.get('/current', async (req, res) => {
  const warehouseId = z.string().min(1).parse(req.query.warehouseId);
  res.json(forViewer(req, await getOpenSession(warehouseId)));
});

/** Troco sugerido para a abertura (o que ficou na gaveta ontem). */
cashRoutes.get('/opening-suggestion', async (req, res) => {
  res.json(await getOpeningSuggestion(z.string().min(1).parse(req.query.warehouseId)));
});

cashRoutes.get('/', async (req, res) => {
  const filters = paginationSchema.extend({ warehouseId: z.string().optional() }).parse(req.query);
  const where = { warehouseId: filters.warehouseId };
  const [data, total] = await prisma.$transaction([
    prisma.cashSession.findMany({
      where,
      include: {
        warehouse: { select: { id: true, name: true } },
        openedBy: { select: { id: true, name: true } },
        closedBy: { select: { id: true, name: true } },
      },
      orderBy: { number: 'desc' },
      ...toSkipTake(filters),
    }),
    prisma.cashSession.count({ where }),
  ]);
  res.json(
    paginated(
      data.map((session) => ({
        ...session,
        differenceCents:
          session.countedCents === null || session.expectedCents === null
            ? null
            : session.countedCents - session.expectedCents,
      })),
      total,
      filters,
    ),
  );
});

cashRoutes.get('/:id', async (req, res) => {
  res.json(forViewer(req, await getCashSummary(param(req, 'id'))));
});

cashRoutes.post('/open', requirePermission('sales:create'), async (req, res) => {
  res.status(201).json(forViewer(req, await openCash(openSchema.parse(req.body), currentUser(req).id)));
});

cashRoutes.post('/:id/movements', requirePermission('sales:create'), async (req, res) => {
  res
    .status(201)
    .json(forViewer(req, await addCashMovement(param(req, 'id'), movementSchema.parse(req.body), currentUser(req).id)));
});

cashRoutes.post('/:id/close', requirePermission('sales:create'), async (req, res) => {
  const session = await closeCash(param(req, 'id'), closeSchema.parse(req.body), currentUser(req).id);
  const difference = session.summary.differenceCents ?? 0;
  await recordAudit(actorOf(req), {
    action: 'UPDATE',
    entity: 'CashSession',
    entityId: session.id,
    summary:
      `Caixa nº ${session.number} fechado: esperado ${formatCents(session.summary.expectedCashCents)}, ` +
      `contado ${formatCents(session.countedCents ?? 0)}` +
      (difference === 0 ? ' (sem diferença)' : ` (diferença de ${formatCents(difference)})`) +
      (session.keptCents === null
        ? ''
        : `; retirado ${formatCents(session.summary.closingWithdrawalCents ?? 0)}, ficou na gaveta ${formatCents(session.keptCents)}`),
  });
  res.json(forViewer(req, session));
});
