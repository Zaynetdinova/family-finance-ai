import type { Metadata } from 'next';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Notice } from '@/components/ui/states';
import { ActionForm, FormField } from '@/components/action-form';
import { TelegramLink } from '@/components/telegram-link';
import { ArchiveButton, DefaultAccountSelect, HouseholdSwitcher, InviteForm, RefreshRatesButton, RemoveMemberButton } from '@/components/settings-controls';
import { addManualRate, createAccount, createCategory, updateHouseholdSettings } from '@/lib/actions/settings';
import { loadRecentRates, requireContext } from '@/lib/db/queries';
import { categoryNamer } from '@/lib/report';
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS, CURRENCY_OPTIONS, ROLE_LABELS } from '@/lib/labels';

export const metadata: Metadata = { title: 'Настройки' };

export default async function SettingsPage() {
  const ctx = await requireContext();
  const admin = ctx.role === 'owner' || ctx.role === 'admin';
  const canWrite = admin || ctx.role === 'member';
  const rates = await loadRecentRates(ctx, 10);
  const catName = categoryNamer(ctx);
  const custom = ctx.categories.filter((c) => !c.is_system);
  const parents = ctx.categories.filter((c) => !c.parent_id);
  const adminKeyMissing = !process.env.SUPABASE_SECRET_KEY;
  const defaultsRes = await ctx.supabase.from('default_accounts').select('currency, account_id').eq('user_id', ctx.userId).eq('household_id', ctx.household.id);
  const defaults = new Map(((defaultsRes.data ?? []) as { currency: string; account_id: string }[]).map((d) => [d.currency, d.account_id]));
  const liveAccounts = ctx.accounts.filter((a) => !a.is_archived);
  const accountCurrencies = [...new Set(liveAccounts.map((a) => a.currency))];

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Настройки</h1>
        <p className="text-sm text-text-secondary">Ваша роль: {ROLE_LABELS[ctx.role]}</p>
      </div>

      {ctx.households.length > 1 ? <HouseholdSwitcher current={ctx.household.id} households={ctx.households} /> : null}

      <Card>
        <CardHeader><CardTitle>Бюджет</CardTitle></CardHeader>
        <CardContent>
          {admin ? (
            <ActionForm action={updateHouseholdSettings} submitLabel="Сохранить" resetOnSuccess={false}>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Название" name="name"><Input name="name" defaultValue={ctx.household.name} required /></FormField>
                <FormField label="Основная валюта отчётов" name="baseCurrency"><Select name="baseCurrency" defaultValue={ctx.household.base_currency}>{CURRENCY_OPTIONS}</Select></FormField>
              </div>
            </ActionForm>
          ) : <p className="text-sm">{ctx.household.name} · валюта отчётов {ctx.household.base_currency}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Telegram</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <TelegramLink linked={ctx.profile.telegram_user_id !== null} />
          {accountCurrencies.length ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-3">
                {accountCurrencies.map((c) => (
                  <DefaultAccountSelect key={c} currency={c} value={defaults.get(c) ?? ''} accounts={liveAccounts.filter((a) => a.currency === c).map((a) => ({ id: a.id, name: a.name }))} />
                ))}
              </div>
              <p className="text-xs text-text-muted">Если в сообщении счёт не назван, бот запишет операцию на счёт по умолчанию этой валюты. Без него бот спросит, если счетов в валюте несколько.</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Счета</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="divide-y divide-border text-sm">
            {ctx.accounts.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                <span>{a.name} <span className="text-text-muted">· {ACCOUNT_TYPE_LABELS[a.type]} · {a.currency}</span> {a.is_archived ? <Badge>архив</Badge> : null}</span>
                {canWrite ? <ArchiveButton id={a.id} archived={a.is_archived} /> : null}
              </li>
            ))}
          </ul>
          {canWrite ? (
            <ActionForm action={createAccount} submitLabel="Добавить счёт">
              <div className="grid gap-3 sm:grid-cols-4">
                <FormField label="Название" name="name"><Input name="name" required /></FormField>
                <FormField label="Тип" name="type"><Select name="type" defaultValue="card">{ACCOUNT_TYPES}</Select></FormField>
                <FormField label="Валюта" name="currency"><Select name="currency" defaultValue="RUB">{CURRENCY_OPTIONS}</Select></FormField>
                <FormField label="Остаток" name="openingBalance"><Input name="openingBalance" inputMode="decimal" defaultValue="0" /></FormField>
              </div>
            </ActionForm>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Свои категории</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          {custom.length ? (
            <ul className="flex flex-wrap gap-2 text-sm">{custom.map((c) => <li key={c.id}><Badge>{catName(c.id)} · {c.kind === 'income' ? 'доход' : 'расход'}</Badge></li>)}</ul>
          ) : <p className="text-sm text-text-muted">Своих категорий пока нет. Базовые категории доступны всем.</p>}
          {canWrite ? (
            <ActionForm action={createCategory} submitLabel="Добавить категорию">
              <div className="grid gap-3 sm:grid-cols-3">
                <FormField label="Название" name="name"><Input name="name" required /></FormField>
                <FormField label="Тип" name="kind"><Select name="kind" defaultValue="expense"><option value="expense">Расход</option><option value="income">Доход</option></Select></FormField>
                <FormField label="Родительская (необязательно)" name="parentId">
                  <Select name="parentId" defaultValue=""><option value="">— нет —</option>{parents.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.kind === 'income' ? 'доход' : 'расход'})</option>)}</Select>
                </FormField>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isFixed" /> Постоянный (обязательный) расход</label>
            </ActionForm>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Участники</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="divide-y divide-border text-sm">
            {ctx.members.map((m) => (
              <li key={m.userId} className="flex items-center justify-between gap-3 py-2">
                <span>{m.name} {m.userId === ctx.userId ? <span className="text-text-muted">(вы)</span> : null} <Badge>{ROLE_LABELS[m.role]}</Badge></span>
                {m.role !== 'owner' && (admin || m.userId === ctx.userId) ? <RemoveMemberButton userId={m.userId} name={m.name} self={m.userId === ctx.userId} /> : null}
              </li>
            ))}
          </ul>
          {admin ? <InviteForm /> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Курсы валют</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          {adminKeyMissing ? <Notice>Не задан <code>SUPABASE_SECRET_KEY</code>: автоматическое и ручное обновление курсов отключено. Операции в USD/ARS будут сохраняться без курса.</Notice> : null}
          {rates.length === 0 ? <p className="text-sm text-text-muted">Курсов пока нет. Операции в валюте, отличной от валюты отчётов, не попадут в сводные суммы, пока не появится курс.</p> : (
            <ul className="divide-y divide-border text-sm">
              {rates.slice(0, 8).map((r, i) => (
                <li key={i} className="tabular flex justify-between gap-3 py-1.5"><span>1 {r.base_currency} = {Number(r.rate)} {r.quote_currency}</span><span className="text-text-muted">{r.rate_date} · {r.source}</span></li>
              ))}
            </ul>
          )}
          {admin ? (
            <>
              <RefreshRatesButton />
              <ActionForm action={addManualRate} submitLabel="Сохранить курс">
                <div className="grid gap-3 sm:grid-cols-4">
                  <FormField label="1 единица" name="base"><Select name="base" defaultValue="USD">{CURRENCY_OPTIONS}</Select></FormField>
                  <FormField label="равна" name="rate"><Input name="rate" inputMode="decimal" placeholder="1050,5" required /></FormField>
                  <FormField label="в валюте" name="quote"><Select name="quote" defaultValue="ARS">{CURRENCY_OPTIONS}</Select></FormField>
                  <FormField label="на дату" name="date"><Input name="date" type="date" defaultValue={ctx.today} required /></FormField>
                </div>
              </ActionForm>
              <p className="text-xs text-text-muted">Автокурсы — open.er-api.com, для ARS это официальный курс; для «блю»-курса введите свой вручную: он приоритетнее автоматического на ту же дату.</p>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
