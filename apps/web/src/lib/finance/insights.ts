import { type Currency, type Minor, formatMinor, bpToPercent } from './money';
import type { Comparison } from './compare';
import type { PeriodSummary } from './summary';
import type { LimitState } from './budget';

export interface Insight {
  tone: 'fact' | 'attention';
  text: string;
}

export interface InsightInput {
  summary: PeriodSummary;
  comparison: Comparison;
  currency: Currency;
  categoryName: (id: string | null) => string;
  budgetAlerts: { name: string; state: Exclude<LimitState, 'ok'>; usedBp: number | null }[];
  overduePayments: number;
  unusualCount: number;
}

const fmtPct = (bp: number | null, signed = false) =>
  bp === null ? '—' : `${signed && bp > 0 ? '+' : ''}${(bpToPercent(bp) ?? 0).toFixed(1).replace('.', ',')}%`;

/**
 * Plain-language facts derived only from computed numbers. No model is involved, so every
 * statement here can be traced to a figure on the screen.
 */
export function buildInsights(i: InsightInput): Insight[] {
  const { summary: s, comparison: c, currency } = i;
  const m = (v: Minor) => formatMinor(v, currency);
  const out: Insight[] = [];
  if (!s.hasData) return out;

  if (s.provisional) out.push({ tone: 'fact', text: 'Период ещё не завершён: показатели предварительные.' });

  if (s.net < 0n) out.push({ tone: 'attention', text: `Расходы превысили доходы на ${m(-s.net)}.` });

  const top = s.byCategory.find((x) => x.expense > 0n);
  if (top) {
    out.push({ tone: 'fact', text: `Больше всего потрачено на «${i.categoryName(top.categoryId)}»: ${m(top.expense)} (${fmtPct(top.shareBp)} расходов).` });
  }

  if (c.comparable) {
    const e = c.expense;
    if (e.diff === 0n) out.push({ tone: 'fact', text: 'Расходы на уровне предыдущего периода.' });
    else {
      const dir = e.diff > 0n ? 'выросли' : 'снизились';
      const share = e.changeBp === null ? '' : ` (${fmtPct(e.changeBp, true)})`;
      out.push({ tone: e.diff > 0n ? 'attention' : 'fact', text: `Расходы ${dir} на ${m(e.diff < 0n ? -e.diff : e.diff)}${share} по сравнению с предыдущим периодом.` });
    }
    const grown = c.categories.find((x) => x.diff > 0n && !x.isNew);
    if (grown && grown.changeBp !== null && grown.changeBp >= 2000) {
      out.push({ tone: 'attention', text: `Сильнее всего выросла категория «${i.categoryName(grown.categoryId)}»: ${fmtPct(grown.changeBp, true)}.` });
    }
  } else {
    const why = {
      no_previous_data: 'в предыдущем периоде нет операций',
      no_current_data: 'в выбранном периоде нет операций',
      different_length: 'периоды разной длины',
      different_currency: 'разные валюты отчёта',
    }[c.reason];
    out.push({ tone: 'fact', text: `Сравнение с предыдущим периодом невозможно: ${why}.` });
  }

  for (const b of i.budgetAlerts) {
    out.push({
      tone: 'attention',
      text: b.state === 'exceeded' ? `Лимит «${b.name}» превышен (${fmtPct(b.usedBp)}).` : `Лимит «${b.name}» использован на ${fmtPct(b.usedBp)}.`,
    });
  }
  if (i.overduePayments > 0) out.push({ tone: 'attention', text: `Просроченных обязательных платежей: ${i.overduePayments}.` });
  if (i.unusualCount > 0) out.push({ tone: 'attention', text: `Необычно крупных расходов для своих категорий: ${i.unusualCount}.` });
  if (s.unconverted.count > 0) {
    out.push({ tone: 'attention', text: `${s.unconverted.count} операц. в другой валюте не вошли в суммы: нет курса на дату операции.` });
  }
  return out;
}
