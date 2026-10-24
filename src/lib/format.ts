import { language, t } from '#lib/i18n.ts';

export function formatDate(value: string | null, short = false): string {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(language.current === 'de' ? 'de-DE' : 'en-GB', { day: 'numeric', month: short ? 'short' : 'long', ...(short ? {} : { year: 'numeric' }) }).format(date);
}

/** Calendar-day difference, without DST or time-of-day rounding errors. */
export function daysUntil(value: string, now = new Date()): number {
  const [y, m, d] = value.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
}

export function deadlineLabel(value: string, now = new Date()): string {
  const days = daysUntil(value, now);
  return days === 0 ? t('dueToday') : days < 0 ? t('overdue', { count: Math.abs(days) }) : t('daysLeft', { count: days });
}

export function urgency(value: string): 'high' | 'medium' | 'low' {
  return value === 'high' || value === 'low' ? value : 'medium';
}

export function duration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Browser counterpart of the server normalization; does not import server runtime. */
export function phoneToE164(raw: string): string | null {
  let number = raw.replace(/\(0\)/g, '').replace(/[^\d+]/g, '');
  if (number.startsWith('00')) number = '+' + number.slice(2);
  else if (number.startsWith('0')) number = '+49' + number.slice(1);
  return /^\+[1-9]\d{6,14}$/.test(number) ? number : null;
}

/** Only sum explicit EUR values; never assume an unknown currency or parse prose. */
export function euroAmount(value: string | null): number | null {
  if (!value || !/EUR|€/i.test(value)) return null;
  const numeric = value.replace(/EUR|€/gi, '').replace(/\s/g, '');
  if (!/^[+-]?\d[\d.,]*$/.test(numeric)) return null;
  const lastSeparator = Math.max(numeric.lastIndexOf(','), numeric.lastIndexOf('.'));
  const hasDecimals = lastSeparator >= 0 && numeric.length - lastSeparator === 3;
  const normalized = hasDecimals ? numeric.slice(0, lastSeparator).replace(/[.,]/g, '') + '.' + numeric.slice(lastSeparator + 1) : numeric.replace(/[.,]/g, '');
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}
