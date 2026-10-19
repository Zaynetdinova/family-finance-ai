'use client';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { createHousehold } from '@/lib/actions/household';
import { ACCOUNT_TYPES, CURRENCY_OPTIONS } from '@/lib/labels';

export function OnboardingForm() {
  const [state, action, pending] = useActionState(createHousehold, null);
  const e = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Field label="Название бюджета" error={e?.householdName}>
        <Input name="householdName" defaultValue="Семья" required />
      </Field>
      <Field label="Основная валюта отчётов" error={e?.baseCurrency}>
        <Select name="baseCurrency" defaultValue="RUB">{CURRENCY_OPTIONS}</Select>
      </Field>
      <fieldset className="flex flex-col gap-4 rounded-xl border border-border p-4">
        <legend className="px-1 text-sm font-medium">Первый счёт</legend>
        <Field label="Название" error={e?.accountName}>
          <Input name="accountName" placeholder="Карта" required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Тип" error={e?.accountType}>
            <Select name="accountType" defaultValue="card">{ACCOUNT_TYPES}</Select>
          </Field>
          <Field label="Валюта счёта" error={e?.accountCurrency}>
            <Select name="accountCurrency" defaultValue="RUB">{CURRENCY_OPTIONS}</Select>
          </Field>
        </div>
        <Field label="Текущий остаток" error={e?.openingBalance}>
          <Input name="openingBalance" inputMode="decimal" defaultValue="0" />
        </Field>
      </fieldset>
      {state && !state.ok && state.error ? <p role="alert" className="text-sm text-negative">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>{pending ? 'Создаём…' : 'Создать'}</Button>
    </form>
  );
}
