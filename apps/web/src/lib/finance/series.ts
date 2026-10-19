import { type Minor } from './money';
import { type DateRange, type IsoDate, addDays, addMonths, startOfMonth, startOfWeek } from './dates';
import { type View, flowOf } from './ledger';
import type { LedgerTx } from './types';

export type Bucket = 'day' | 'week' | 'month';

export interface SeriesPoint {
  /** First day of the bucket, clipped to the range start. */
  start: IsoDate;
  income: Minor;
  expense: Minor;
}

function bucketStart(date: IsoDate, bucket: Bucket, range: DateRange): IsoDate {
  const s = bucket === 'day' ? date : bucket === 'week' ? startOfWeek(date) : startOfMonth(date);
  return s < range.from ? range.from : s;
}

function nextBucket(start: IsoDate, bucket: Bucket): IsoDate {
  return bucket === 'day' ? addDays(start, 1) : bucket === 'week' ? addDays(startOfWeek(start), 7) : addMonths(start, 1);
}

/** Income/expense per day, week or month. Empty buckets are present with zeros (not omitted). */
export function timeSeries(txs: LedgerTx[], opts: { range: DateRange; bucket: Bucket; view: View }): SeriesPoint[] {
  const { range, bucket, view } = opts;
  const points = new Map<IsoDate, SeriesPoint>();
  for (let s = range.from; s <= range.to; s = nextBucket(s, bucket)) {
    points.set(s, { start: s, income: 0n, expense: 0n });
  }
  for (const tx of txs) {
    if (tx.occurredOn < range.from || tx.occurredOn > range.to) continue;
    const flow = flowOf(tx, view);
    if (!flow) continue;
    const p = points.get(bucketStart(tx.occurredOn, bucket, range));
    if (!p) continue;
    p.income += flow.income;
    p.expense += flow.expense;
  }
  return [...points.values()];
}

/** Pick a sensible bucket for the length of the range. */
export function defaultBucket(days: number): Bucket {
  return days <= 31 ? 'day' : days <= 140 ? 'week' : 'month';
}
