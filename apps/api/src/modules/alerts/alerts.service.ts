import type { StockAlert } from '@prisma/client';
import type { Tx } from '../../lib/prisma.js';
import { domainEvents } from '../../lib/events.js';

const SEVERITY = { LOW_STOCK: 1, OUT_OF_STOCK: 2, NEGATIVE_STOCK: 3 } as const;

export type AlertChange =
  { kind: 'none' } | { kind: 'opened' | 'escalated' | 'updated' | 'resolved'; alert: StockAlert };

/**
 * Reavalia o alerta de estoque mínimo de um produto em um estoque.
 *
 * Regras:
 * - mínimo vigente = mínimo do estoque (se definido) ou mínimo padrão do produto;
 * - mínimo 0 significa "não monitorar";
 * - saldo <= mínimo abre um alerta LOW_STOCK (ou OUT_OF_STOCK se zerou);
 * - saldo negativo (venda além do registrado) sempre abre NEGATIVE_STOCK, mesmo sem mínimo;
 * - existe no máximo um alerta OPEN por produto/estoque;
 * - quando o saldo volta acima do mínimo, o alerta é resolvido automaticamente.
 *
 * Roda dentro da mesma transação da movimentação, então saldo e alerta nunca ficam inconsistentes.
 */
export async function evaluateStockAlert(
  tx: Tx,
  productId: string,
  warehouseId: string,
  at: Date = new Date(),
): Promise<AlertChange> {
  const level = await tx.stockLevel.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } },
    include: { product: { select: { minStock: true } } },
  });
  if (!level) return { kind: 'none' };

  const threshold = level.minQuantity ?? level.product.minStock;
  const breached = level.quantity < 0 || (threshold > 0 && level.quantity <= threshold);
  const open = await tx.stockAlert.findFirst({ where: { productId, warehouseId, status: 'OPEN' } });

  if (breached) {
    const type = level.quantity < 0 ? 'NEGATIVE_STOCK' : level.quantity === 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK';

    if (!open) {
      const alert = await tx.stockAlert.create({
        data: { productId, warehouseId, type, quantity: level.quantity, threshold, createdAt: at, updatedAt: at },
      });
      return { kind: 'opened', alert };
    }

    // Situação piorou (baixo → zerado → negativo): escala o alerta e pede nova ciência.
    const escalated = SEVERITY[type] > SEVERITY[open.type];
    const alert = await tx.stockAlert.update({
      where: { id: open.id },
      data: {
        type,
        quantity: level.quantity,
        threshold,
        updatedAt: at,
        ...(escalated && { acknowledgedAt: null, acknowledgedById: null }),
      },
    });
    return { kind: escalated ? 'escalated' : 'updated', alert };
  }

  if (open) {
    const alert = await tx.stockAlert.update({
      where: { id: open.id },
      data: { status: 'RESOLVED', resolvedAt: at, quantity: level.quantity, threshold, updatedAt: at },
    });
    return { kind: 'resolved', alert };
  }

  return { kind: 'none' };
}

/** Publica os eventos de alerta. Deve ser chamado apenas depois do commit da transação. */
export function publishAlertChanges(changes: AlertChange[]) {
  for (const change of changes) {
    if (change.kind === 'opened' || change.kind === 'escalated') {
      domainEvents.emit('alert.opened', { alertId: change.alert.id, escalated: change.kind === 'escalated' });
    } else if (change.kind === 'resolved') {
      domainEvents.emit('alert.resolved', { alertId: change.alert.id });
    }
  }
}
