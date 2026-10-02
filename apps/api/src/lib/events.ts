import { EventEmitter } from 'node:events';

/**
 * Barramento de eventos de domínio em memória.
 * Os serviços publicam fatos (ex.: "alerta aberto") *depois* que a transação é confirmada,
 * e quem tiver interesse (notificações, webhooks, logs) reage sem acoplar ao fluxo principal.
 */
export interface DomainEvents {
  'alert.opened': [{ alertId: string; escalated: boolean }];
  'alert.resolved': [{ alertId: string }];
}

export const domainEvents = new EventEmitter<DomainEvents>();
