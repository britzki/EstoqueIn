import { env } from '../../config/env.js';
import { domainEvents } from '../../lib/events.js';
import { prisma } from '../../lib/prisma.js';

const TYPE_LABEL = {
  LOW_STOCK: 'Estoque baixo',
  OUT_OF_STOCK: 'Sem estoque',
  NEGATIVE_STOCK: 'Estoque negativo',
} as const;

/**
 * Reage aos eventos de alerta: registra no log e, se configurado, envia um webhook.
 * Falhas aqui nunca afetam a movimentação, que já foi confirmada.
 */
export function registerAlertNotifier() {
  domainEvents.on('alert.opened', async ({ alertId, escalated }) => {
    try {
      const alert = await prisma.stockAlert.findUnique({
        where: { id: alertId },
        include: {
          product: { select: { sku: true, name: true, unit: true } },
          warehouse: { select: { code: true, name: true } },
        },
      });
      if (!alert) return;

      const text =
        `⚠️ ${TYPE_LABEL[alert.type]}${escalated ? ' (agravado)' : ''}: ${alert.product.name} (${alert.product.sku}) ` +
        `em ${alert.warehouse.name} — saldo ${alert.quantity} ${alert.product.unit}, mínimo ${alert.threshold}`;

      if (env.NODE_ENV !== 'test') console.info(`[alerta] ${text}`);
      if (!env.ALERT_WEBHOOK_URL) return;

      await fetch(env.ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // "text" (Slack) e "content" (Discord) permitem usar o webhook direto nessas ferramentas.
        body: JSON.stringify({
          event: 'stock.alert.opened',
          text,
          content: text,
          alert: {
            id: alert.id,
            type: alert.type,
            escalated,
            quantity: alert.quantity,
            threshold: alert.threshold,
            product: alert.product,
            warehouse: alert.warehouse,
            createdAt: alert.createdAt,
          },
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      console.error('[alerta] falha ao notificar', error);
    }
  });
}
