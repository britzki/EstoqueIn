import type { AlertType, MovementType, PaymentMethod, Role } from './types';

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const number = new Intl.NumberFormat('pt-BR');
const percent = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });
const compactMoney = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});

export const formatMoney = (cents: number) => money.format(cents / 100);
export const formatCompactMoney = (cents: number) => compactMoney.format(cents / 100);
export const formatNumber = (value: number) => number.format(value);
export const formatPercent = (value: number) => percent.format(value);

export const formatDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function formatRelative(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'agora';
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  const days = Math.floor(diff / 86400);
  return days === 1 ? 'ontem' : `há ${days} dias`;
}

/**
 * Valor digitado em reais para centavos: "12,50", "12.50" e "R$ 1.250,00" funcionam.
 * Ponto seguido de 1 ou 2 dígitos (e sem vírgula) é decimal, como no teclado numérico;
 * nos outros casos o ponto separa milhares. Retorna null para vazio ou inválido.
 */
export function parseMoneyInput(text: string): number | null {
  const raw = text.replace(/[R$\s]/g, '');
  const clean = /^\d*\.\d{1,2}$/.test(raw) ? raw : raw.replace(/\./g, '').replace(',', '.');
  if (!clean) return null;
  const value = Number(clean);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
}

/** Valor sem o "R$", para as colunas dos comprovantes impressos ("12,50"). */
export const formatMoneyPlain = (cents: number) => formatMoney(cents).replace('R$', '').trim();

/**
 * Vencimento de conta: gravado ao meio-dia do dia escolhido. "AAAA-MM-DD" do vencimento e a data por extenso.
 */
export const dueDay = (iso: string) => new Date(iso).toISOString().slice(0, 10);
export const formatDueDay = (iso: string) => formatDate(`${dueDay(iso)}T12:00:00`);

export const centsToInput = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

/** Data local AAAA-MM-DD, para inputs do tipo date. */
export const toDateInput = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};

/** Converte o dia do input em ISO no começo/fim do dia local. */
export const dayStartIso = (day: string) => new Date(`${day}T00:00:00`).toISOString();
export const dayEndIso = (day: string) => new Date(`${day}T23:59:59.999`).toISOString();

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  ENTRY: 'Entrada',
  EXIT: 'Saída',
  TRANSFER_IN: 'Transf. recebida',
  TRANSFER_OUT: 'Transf. enviada',
  ADJUSTMENT: 'Ajuste',
  FRACTION_OUT: 'Abertura p/ granel',
  FRACTION_IN: 'Entrada de granel',
  SALE_CANCEL: 'Venda cancelada',
  SALE_RETURN: 'Devolução de cliente',
};

export const MOVEMENT_TONE: Record<MovementType, 'green' | 'orange' | 'blue' | 'violet' | 'gray'> = {
  ENTRY: 'green',
  EXIT: 'orange',
  TRANSFER_IN: 'blue',
  TRANSFER_OUT: 'blue',
  ADJUSTMENT: 'violet',
  FRACTION_OUT: 'gray',
  FRACTION_IN: 'gray',
  SALE_CANCEL: 'green',
  SALE_RETURN: 'green',
};

export const ALERT_LABEL: Record<AlertType, string> = {
  LOW_STOCK: 'Estoque baixo',
  OUT_OF_STOCK: 'Sem estoque',
  NEGATIVE_STOCK: 'Estoque negativo',
};

/** Formas de pagamento na ordem das telas; sem o fiado, as que recebem dinheiro na hora. */
export const PAYMENT_METHODS: PaymentMethod[] = ['CASH', 'PIX', 'DEBIT', 'CREDIT', 'OTHER', 'ACCOUNT'];
export const RECEIVING_METHODS = ['CASH', 'PIX', 'DEBIT', 'CREDIT', 'OTHER'] as const satisfies PaymentMethod[];

export const INVENTORY_STATUS = {
  OPEN: { label: 'Em contagem', tone: 'blue' },
  COMPLETED: { label: 'Concluído', tone: 'green' },
  CANCELLED: { label: 'Cancelado', tone: 'gray' },
} as const;

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Dinheiro',
  PIX: 'Pix',
  DEBIT: 'Débito',
  CREDIT: 'Crédito',
  OTHER: 'Outro',
  ACCOUNT: 'Fiado',
};

/** Primeiro nome, para as mensagens ("Olá, Maria!"). */
export const firstName = (name: string) => name.split(' ')[0];

/** Link do WhatsApp para o número (só dígitos, com DDD). */
export const whatsappLink = (phone: string, text: string) =>
  `https://wa.me/${phone.length <= 11 ? '55' + phone : phone}?text=${encodeURIComponent(text)}`;

export const formatPhone = (phone: string) =>
  phone.length === 11
    ? `(${phone.slice(0, 2)}) ${phone.slice(2, 7)}-${phone.slice(7)}`
    : phone.length === 10
      ? `(${phone.slice(0, 2)}) ${phone.slice(2, 6)}-${phone.slice(6)}`
      : phone;

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Administrador',
  MANAGER: 'Gerente',
  OPERATOR: 'Operador',
  VIEWER: 'Somente leitura',
};

export const UNITS = ['UN', 'PCT', 'CX', 'SC', 'FD', 'KG', 'G', 'L', 'ML', 'M'];

/** Unidades que, por padrão, são vendidas com casas decimais. */
export const FRACTIONAL_UNITS = ['KG', 'G', 'L', 'ML', 'M'];

/** Arredonda para 3 casas, eliminando resíduos de ponto flutuante em contas feitas na tela. */
export const roundQty = (value: number) => Math.round((value + Number.EPSILON) * 1000) / 1000;
