import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildContext } from '@/lib/db/queries';
import type { JobStore, Recipient } from './run';

export function createSupabaseJobStore(db: SupabaseClient): JobStore {
  return {
    async recipients() {
      const { data: profiles, error } = await db.from('profiles').select('id, telegram_chat_id, timezone').not('telegram_chat_id', 'is', null);
      if (error) throw new Error(`profiles: ${error.message}`);
      const list = (profiles ?? []) as { id: string; telegram_chat_id: number; timezone: string }[];
      if (!list.length) return [];
      const ids = list.map((p) => p.id);
      const [sched, prefs] = await Promise.all([
        db.from('scheduled_reports').select('user_id, household_id, kind, enabled, send_hour, send_weekday').in('user_id', ids),
        db.from('notification_preferences').select('*').in('user_id', ids),
      ]);
      if (sched.error) throw new Error(`scheduled_reports: ${sched.error.message}`);
      if (prefs.error) throw new Error(`notification_preferences: ${prefs.error.message}`);
      type PrefRow = { user_id: string; payment_reminders: boolean; reminder_days_before: number; budget_alerts: boolean; budget_alert_pct: number };
      return list.map((p): Recipient => {
        const pr = (prefs.data as PrefRow[]).find((x) => x.user_id === p.id);
        return {
          userId: p.id,
          chatId: p.telegram_chat_id,
          timezone: p.timezone,
          schedules: ((sched.data ?? []) as (Recipient['schedules'][number] & { user_id: string })[]).filter((s) => s.user_id === p.id),
          prefs: pr ? { paymentReminders: pr.payment_reminders, reminderDaysBefore: pr.reminder_days_before, budgetAlerts: pr.budget_alerts, budgetAlertPct: pr.budget_alert_pct } : null,
        };
      });
    },
    loadContext: (userId, householdId) => buildContext(db, { id: userId, email: null }, householdId),
    async claim(userId, kind, key) {
      const { error } = await db.from('notifications_sent').insert({ user_id: userId, kind, dedupe_key: key });
      if (!error) return true;
      if (error.code === '23505') return false;
      throw new Error(`notifications_sent: ${error.message}`);
    },
    async markSent(userId, key) {
      await db.from('notifications_sent').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('user_id', userId).eq('dedupe_key', key);
    },
    async release(userId, key) {
      await db.from('notifications_sent').delete().eq('user_id', userId).eq('dedupe_key', key).eq('status', 'claimed');
    },
  };
}
