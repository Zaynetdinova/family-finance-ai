'use client';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TYPE_LABELS, STATUS_LABELS } from '@/lib/labels';

interface Props {
  values: Record<string, string>;
  categories: { id: string; name: string }[];
  accounts: { id: string; name: string }[];
}

export function TxFilters({ values, categories, accounts }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, start] = useTransition();
  const [q, setQ] = useState(values.q ?? '');

  function set(patch: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete('page');
    start(() => router.replace(`${pathname}?${next.toString()}`));
  }

  // debounce the text search
  useEffect(() => {
    if (q === (values.q ?? '')) return;
    const t = setTimeout(() => set({ q }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const sel = (name: string, label: string, options: [string, string][]) => (
    <label className="flex flex-col gap-1 text-xs text-text-secondary">
      {label}
      <Select value={values[name] ?? ''} onChange={(e) => set({ [name]: e.target.value })} className="w-auto">
        <option value="">Все</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select>
    </label>
  );

  return (
    <div role="search" aria-label="Фильтры операций" className="flex flex-wrap items-end gap-3">
      <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-text-secondary">
        Поиск
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Магазин или комментарий" type="search" />
      </label>
      {sel('type', 'Тип', Object.entries(TYPE_LABELS))}
      {sel('category', 'Категория', categories.map((c) => [c.id, c.name]))}
      {sel('account', 'Счёт', accounts.map((a) => [a.id, a.name]))}
      {sel('currency', 'Валюта', [['RUB', 'RUB'], ['USD', 'USD'], ['ARS', 'ARS']])}
      {sel('status', 'Статус', Object.entries(STATUS_LABELS))}
      <label className="flex flex-col gap-1 text-xs text-text-secondary">С
        <Input type="date" defaultValue={values.from} onChange={(e) => set({ from: e.target.value })} className="w-auto" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-secondary">По
        <Input type="date" defaultValue={values.to} onChange={(e) => set({ to: e.target.value })} className="w-auto" />
      </label>
      <Button variant="ghost" size="sm" onClick={() => { setQ(''); start(() => router.replace(pathname)); }}>Сбросить</Button>
    </div>
  );
}
