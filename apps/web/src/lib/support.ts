import { desktop } from './desktop';
import { formatPhone, whatsappLink } from './format';

/** WhatsApp do suporte do EstoqueIn (DDI + DDD + número, só dígitos). */
const SUPPORT_WHATSAPP = '5511989045896';
export const SUPPORT_WHATSAPP_LABEL = formatPhone(SUPPORT_WHATSAPP.slice(2));

/** Versão do programa instalado (no navegador, "web"). */
async function appVersion() {
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
  return whatsappLink(SUPPORT_WHATSAPP, lines.join('\n'));
}
