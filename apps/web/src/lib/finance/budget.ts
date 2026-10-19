import { type Minor, ratioBp } from './money';
import { type IsoDate, diffDays } from './dates';

export type LimitState = 'ok' | 'warning' | 'exceeded';

export interface LimitStatus {
  usedBp: number | null;
  remaining: Minor;
  state: LimitState;
}

/** Spend against a category limit. `warnAtBp` defaults to 80%. A zero limit with any spend is exceeded. */
export function limitStatus(limit: Minor, spent: Minor, warnAtBp = 8000): LimitStatus {
  const used = ratioBp(spent, limit);
  const state: LimitState = spent > limit ? 'exceeded' : used !== null && used >= warnAtBp ? 'warning' : 'ok';
  return { usedBp: used, remaining: limit - spent, state: limit === 0n && spent > 0n ? 'exceeded' : state };
}

/**
 * Money that can be set aside this month:
 *   income − expenses so far − mandatory payments still to come − reserve
 * Never negative; `shortfall` tells how much is missing instead.
 */
export function availableToSave(opts: { income: Minor; expense: Minor; upcomingMandatory: Minor; reserve: Minor }): {
  available: Minor;
  shortfall: Minor;
} {
  const raw = opts.income - opts.expense - opts.upcomingMandatory - opts.reserve;
  return raw >= 0n ? { available: raw, shortfall: 0n } : { available: 0n, shortfall: -raw };
}

export interface GoalProgress {
  progressBp: number | null;
  remaining: Minor;
  achieved: boolean;
  /** Whole months until the target date (at least 1); null without a date or when past. */
  monthsLeft: number | null;
  requiredPerMonth: Minor | null;
}

export function goalProgress(opts: { target: Minor; current: Minor; targetDate: IsoDate | null; today: IsoDate }): GoalProgress {
  const remaining = opts.target > opts.current ? opts.target - opts.current : 0n;
  let monthsLeft: number | null = null;
  if (opts.targetDate && opts.targetDate > opts.today) monthsLeft = Math.max(1, Math.ceil(diffDays(opts.today, opts.targetDate) / 30.4375));
  return {
    progressBp: ratioBp(opts.current > opts.target ? opts.target : opts.current, opts.target),
    remaining,
    achieved: opts.current >= opts.target,
    monthsLeft,
    requiredPerMonth: monthsLeft && remaining > 0n ? (remaining + BigInt(monthsLeft) - 1n) / BigInt(monthsLeft) : null,
  };
}

/**
 * Category totals including sub-categories: spending in "Транспорт › Такси" counts toward
 * both "Такси" and its parent "Транспорт", so a limit on the parent sees it.
 */
export function rollUpByCategory(
  items: { categoryId: string | null; expense: Minor }[],
  categories: { id: string; parentId?: string | null }[],
): Map<string, Minor> {
  const parent = new Map(categories.map((c) => [c.id, c.parentId ?? null] as const));
  const out = new Map<string, Minor>();
  for (const it of items) {
    let id: string | null = it.categoryId;
    for (let depth = 0; id && depth < 5; depth++) {
      out.set(id, (out.get(id) ?? 0n) + it.expense);
      id = parent.get(id) ?? null;
    }
  }
  return out;
}
