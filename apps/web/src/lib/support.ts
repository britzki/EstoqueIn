import { desktop } from './desktop';

/** WhatsApp do suporte do EstoqueIn (DDI + DDD + número, só dígitos). */
export const SUPPORT_WHATSAPP = '5511989045896';
export const SUPPORT_WHATSAPP_LABEL = '(11) 98904-5896';

/** Versão do programa instalado (no navegador, "web"). */
export async function appVersion() {
  try {
    return desktop ? await desktop.getVersion() : 'web';
  } catch {
    return 'desconhecida';
  }
}

/** Link do WhatsApp do suporte, com a versão e a loja já na mensagem para agilizar o atendimento. */
export async function supportLink({ storeName, question }: { storeName?: string; question?: string } = {}) {
  const lines = [
    'Olá! Preciso de ajuda com o EstoqueIn.',
    question ? `Dúvida: ${question}` : null,
    storeName ? `Loja: ${storeName}` : null,
    `Versão: ${await appVersion()}`,
  ].filter(Boolean);
  return `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(lines.join('\n'))}`;
}
