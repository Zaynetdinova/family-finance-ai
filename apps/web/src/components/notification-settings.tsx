'use client';
import { Input, Select } from '@/components/ui/input';
import { ActionForm, FormField } from '@/components/action-form';
import { saveNotificationSettings } from '@/lib/actions/notifications';

export interface NotificationValues {
  timezone: string;
  daily: { enabled: boolean; hour: number };
  weekly: { enabled: boolean; hour: number; day: number };
  monthly: { enabled: boolean; hour: number };
  paymentReminders: boolean;
  reminderDaysBefore: number;
  budgetAlerts: boolean;
  budgetAlertPct: number;
}

const HOURS = Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>);
const DAYS = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'].map((d, i) => <option key={i} value={i + 1}>{d}</option>);

export function NotificationSettings({ values, timezones, telegramLinked }: { values: NotificationValues; timezones: string[]; telegramLinked: boolean }) {
  const v = values;
  return (
    <ActionForm action={saveNotificationSettings} submitLabel="Сохранить" resetOnSuccess={false}>
      {!telegramLinked ? <p className="text-sm text-text-muted">Уведомления приходят в Telegram — сначала привяжите его выше.</p> : null}
      <FormField label="Часовой пояс" name="timezone">
        <Select name="timezone" defaultValue={v.timezone}>{timezones.map((tz) => <option key={tz} value={tz}>{tz}</option>)}</Select>
      </FormField>

      <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-medium">Сводки</legend>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-40 items-center gap-2 text-sm"><input type="checkbox" name="dailyEnabled" defaultChecked={v.daily.enabled} /> Ежедневная, в</label>
          <Select name="dailyHour" defaultValue={v.daily.hour} className="w-auto" aria-label="Время ежедневной сводки">{HOURS}</Select>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-40 items-center gap-2 text-sm"><input type="checkbox" name="weeklyEnabled" defaultChecked={v.weekly.enabled} /> Еженедельная:</label>
          <Select name="weeklyDay" defaultValue={v.weekly.day} className="w-auto" aria-label="День недели">{DAYS}</Select>
          <Select name="weeklyHour" defaultValue={v.weekly.hour} className="w-auto" aria-label="Время еженедельной сводки">{HOURS}</Select>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-40 items-center gap-2 text-sm"><input type="checkbox" name="monthlyEnabled" defaultChecked={v.monthly.enabled} /> Месячный отчёт 1-го числа, в</label>
          <Select name="monthlyHour" defaultValue={v.monthly.hour} className="w-auto" aria-label="Время месячного отчёта">{HOURS}</Select>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-medium">Напоминания</legend>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="paymentReminders" defaultChecked={v.paymentReminders} /> О платежах по долгам за</label>
          <FormField label="дней" name="reminderDaysBefore"><Input name="reminderDaysBefore" inputMode="numeric" defaultValue={v.reminderDaysBefore} className="w-20" /></FormField>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="budgetAlerts" defaultChecked={v.budgetAlerts} /> О лимитах бюджета при</label>
          <FormField label="% использования" name="budgetAlertPct"><Input name="budgetAlertPct" inputMode="numeric" defaultValue={v.budgetAlertPct} className="w-20" /></FormField>
        </div>
        <p className="text-xs text-text-muted">Напоминания не приходят с 22:00 до 9:00 по вашему времени. Каждое приходит один раз.</p>
      </fieldset>
    </ActionForm>
  );
}
