'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireContext } from '@/lib/db/queries';
import { dbError, fieldErrors, type ActionResult } from './result';

const hour = z.coerce.number().int().min(0).max(23);
const schema = z.object({
  timezone: z.string().refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }, 'Неизвестный часовой пояс'),
  dailyEnabled: z.boolean(),
  dailyHour: hour,
  weeklyEnabled: z.boolean(),
  weeklyHour: hour,
  weeklyDay: z.coerce.number().int().min(1).max(7),
  monthlyEnabled: z.boolean(),
  monthlyHour: hour,
  paymentReminders: z.boolean(),
  reminderDaysBefore: z.coerce.number().int().min(0, 'От 0 до 30').max(30, 'От 0 до 30'),
  budgetAlerts: z.boolean(),
  budgetAlertPct: z.coerce.number().int().min(1, 'От 1 до 200').max(200, 'От 1 до 200'),
});

export async function saveNotificationSettings(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const on = (k: string) => fd.get(k) === 'on';
  const parsed = schema.safeParse({
    ...Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string')),
    dailyEnabled: on('dailyEnabled'), weeklyEnabled: on('weeklyEnabled'), monthlyEnabled: on('monthlyEnabled'),
    paymentReminders: on('paymentReminders'), budgetAlerts: on('budgetAlerts'),
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;
  const sb = ctx.supabase;

  const p = await sb.from('profiles').update({ timezone: v.timezone }).eq('id', ctx.userId);
  if (p.error) return { ok: false, error: dbError(p.error.message) };

  const rows = [
    { kind: 'daily', enabled: v.dailyEnabled, send_hour: v.dailyHour, send_weekday: null },
    { kind: 'weekly', enabled: v.weeklyEnabled, send_hour: v.weeklyHour, send_weekday: v.weeklyDay },
    { kind: 'monthly', enabled: v.monthlyEnabled, send_hour: v.monthlyHour, send_weekday: null },
  ].map((r) => ({ ...r, user_id: ctx.userId, household_id: ctx.household.id }));
  const s = await sb.from('scheduled_reports').upsert(rows, { onConflict: 'user_id,household_id,kind' });
  if (s.error) return { ok: false, error: dbError(s.error.message) };

  const n = await sb.from('notification_preferences').upsert({
    user_id: ctx.userId, payment_reminders: v.paymentReminders, reminder_days_before: v.reminderDaysBefore,
    budget_alerts: v.budgetAlerts, budget_alert_pct: v.budgetAlertPct,
  }, { onConflict: 'user_id' });
  if (n.error) return { ok: false, error: dbError(n.error.message) };

  revalidatePath('/settings');
  return { ok: true, message: 'Настройки уведомлений сохранены' };
}
