import { amountToString, type Minor } from '@/lib/finance/money';

/** RFC 4180-style CSV writer. Cells starting with = + - @ are prefixed to defuse spreadsheet formulas. */
export function toCsv(header: string[], rows: string[][]): string {
  const cell = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) && !/^-?\d+([.,]\d+)?$/.test(v) ? `'${v}` : v;
    return /[",;\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}

/** Parses CSV with quoted cells; the delimiter (, or ;) is detected from the header line. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

export const EXPORT_HEADER = ['date', 'type', 'amount', 'currency', 'account', 'to_account', 'category', 'counterparty', 'comment', 'status', 'source', 'base_currency', 'base_amount', 'fx_rate', 'fx_rate_date'];

export const fmtMinor = (m: Minor | null) => (m === null ? '' : amountToString(m));

const TYPE_ALIASES: Record<string, string> = {
  income: 'income', доход: 'income',
  expense: 'expense', расход: 'expense',
  transfer: 'transfer', перевод: 'transfer',
  refund: 'refund', возврат: 'refund',
  debt_payment: 'debt_payment', 'платёж по долгу': 'debt_payment', 'платеж по долгу': 'debt_payment',
};
export const parseTypeAlias = (s: string): string | null => TYPE_ALIASES[s.trim().toLowerCase()] ?? null;

/** 'YYYY-MM-DD' or 'DD.MM.YYYY' → ISO date, else null. */
export function parseDateCell(s: string): string | null {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : null;
}
