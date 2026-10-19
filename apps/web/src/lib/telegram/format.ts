import { formatMinor, type Currency, type Minor } from '@/lib/finance/money';

/** Escape text for Telegram HTML parse mode. User-provided strings must always go through this. */
export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const m = (v: Minor, c: Currency) => esc(formatMinor(v, c));

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export function dateRu(iso: string): string {
  return `${Number(iso.slice(8))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

/** Callback payloads are limited to 64 bytes by Telegram. */
export function cb(...parts: string[]): string {
  const s = parts.join(':');
  if (Buffer.byteLength(s, 'utf8') > 64) throw new Error('callback_data exceeds 64 bytes');
  return s;
}

export function parseCb(data: string | undefined): string[] {
  return (data ?? '').split(':');
}
