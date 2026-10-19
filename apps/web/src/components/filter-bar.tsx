'use client';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';
import { Input, Select } from '@/components/ui/input';

const PERIODS = [
  ['today', 'Сегодня'], ['week', 'Неделя'], ['month', 'Месяц'], ['prev_month', 'Прошлый месяц'],
  ['30d', '30 дней'], ['year', 'Год'], ['custom', 'Свой период'],
] as const;

interface Props {
  period: string;
  from: string;
  to: string;
  cur: string;
  user: string;
  baseCurrency: string;
  members: { userId: string; name: string }[];
}

export function FilterBar({ period, from, to, cur, user, baseCurrency, members }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  function set(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    next.delete('page');
    start(() => router.replace(`${pathname}?${next.toString()}`));
  }

  return (
    <div role="search" aria-label="Фильтры" aria-busy={pending} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs text-text-secondary">
        Период
        <Select value={period} onChange={(e) => set({ period: e.target.value, ...(e.target.value === 'custom' ? {} : { from: null, to: null }) })} className="w-auto">
          {PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </label>
      {period === 'custom' ? (
        <>
          <label className="flex flex-col gap-1 text-xs text-text-secondary">С
            <Input type="date" defaultValue={from} onChange={(e) => e.target.value && set({ from: e.target.value })} className="w-auto" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-secondary">По
            <Input type="date" defaultValue={to} onChange={(e) => e.target.value && set({ to: e.target.value })} className="w-auto" />
          </label>
        </>
      ) : null}
      <label className="flex flex-col gap-1 text-xs text-text-secondary">
        Валюта
        <Select value={cur} onChange={(e) => set({ cur: e.target.value === 'base' ? null : e.target.value })} className="w-auto">
          <option value="base">Единая ({baseCurrency})</option>
          <option value="RUB">Только RUB</option>
          <option value="USD">Только USD</option>
          <option value="ARS">Только ARS</option>
        </Select>
      </label>
      {members.length > 1 ? (
        <label className="flex flex-col gap-1 text-xs text-text-secondary">
          Участник
          <Select value={user} onChange={(e) => set({ user: e.target.value || null })} className="w-auto">
            <option value="">Все</option>
            {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
          </Select>
        </label>
      ) : null}
    </div>
  );
}
