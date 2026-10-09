import { env } from '../config/env.js';

/**
 * Datas sempre no fuso da empresa (APP_TIMEZONE). O config/env.ts também define process.env.TZ
 * com esse fuso, então os métodos locais de Date (getDate, setHours...) já usam o horário da loja.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: env.APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Data no formato AAAA-MM-DD (agrupamento por dia nos gráficos e relatórios). */
export const dayKey = (date: Date) => dayFormatter.format(date);

/** Início (00:00) do dia de hoje. */
export function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** "AAAA-MM-DD HH:MM" no horário da loja, para as planilhas (o Excel entende e ordena certo). */
export const localDateTime = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** Número do dia no calendário da loja (para contar dias entre datas sem erro de fuso). */
export const calendarDay = (date: Date) =>
  Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);

/** Meio-dia do dia de calendário informado (o oposto de calendarDay). */
export function fromCalendarDay(day: number) {
  const utc = new Date(day * DAY_MS);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(), 12);
}
