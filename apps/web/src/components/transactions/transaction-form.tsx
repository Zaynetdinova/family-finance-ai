'use client';
import { useActionState, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { saveTransaction } from '@/lib/actions/transactions';
import { TYPE_LABELS } from '@/lib/labels';
import type { ActionResult } from '@/lib/actions/result';

export interface FormAccount { id: string; name: string; currency: string }
export interface FormCategory { id: string; name: string; kind: 'income' | 'expense' }
export interface FormDebt { id: string; name: string; currency: string }

export interface TransactionInitial {
  id: string;
  type: string;
  amount: string;
  accountId: string;
  occurredOn: string;
  categoryId: string;
  counterparty: string;
  comment: string;
  transferAccountId: string;
  transferAmount: string;
  debtId: string;
  interest: string;
  fee: string;
}

interface Props {
  trigger: React.ReactNode;
  accounts: FormAccount[];
  categories: FormCategory[];
  debts: FormDebt[];
  initial?: TransactionInitial;
  today?: string;
}

export function TransactionFormDialog({ trigger, accounts, categories, debts, initial, today }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={initial ? 'Редактировать операцию' : 'Новая операция'} description="Валюта берётся из выбранного счёта. Курс фиксируется при сохранении.">
        <TransactionForm {...{ accounts, categories, debts, initial, today }} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function TransactionForm({ accounts, categories, debts, initial, today, onDone }: Omit<Props, 'trigger'> & { onDone: () => void }) {
  const boundAction = saveTransaction.bind(null, initial?.id ?? null);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(boundAction, null);
  const [type, setType] = useState(initial?.type ?? 'expense');
  const [accountId, setAccountId] = useState(initial?.accountId ?? accounts[0]?.id ?? '');
  const [toId, setToId] = useState(initial?.transferAccountId ?? '');
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? 'Сохранено');
      onDone();
    } else if (state && !state.ok && state.error) toast.error(state.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const acc = accounts.find((a) => a.id === accountId);
  const dest = accounts.find((a) => a.id === toId);
  const crossCurrency = type === 'transfer' && acc && dest && acc.currency !== dest.currency;
  const kind = type === 'income' ? 'income' : 'expense';
  const cats = useMemo(() => categories.filter((c) => c.kind === kind), [categories, kind]);
  const showCategory = type !== 'transfer' && type !== 'debt_payment';

  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Тип" error={errors?.type}>
          <Select name="type" value={type} onChange={(e) => setType(e.target.value)}>
            {Object.entries(TYPE_LABELS).filter(([v]) => v !== 'debt_payment' || debts.length > 0).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Дата" error={errors?.occurredOn}>
          <Input name="occurredOn" type="date" defaultValue={initial?.occurredOn ?? today} required />
        </Field>
      </div>

      <div className="grid grid-cols-[1fr_auto] items-end gap-3">
        <Field label="Сумма" error={errors?.amount}>
          <Input name="amount" inputMode="decimal" defaultValue={initial?.amount} placeholder="0,00" required autoFocus />
        </Field>
        <span className="pb-2 text-sm font-medium text-text-secondary" aria-label="Валюта операции">{acc?.currency ?? '—'}</span>
      </div>

      <Field label={type === 'transfer' ? 'Со счёта' : 'Счёт'} error={errors?.accountId}>
        <Select name="accountId" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
        </Select>
      </Field>

      {type === 'transfer' ? (
        <>
          <Field label="На счёт" error={errors?.transferAccountId}>
            <Select name="transferAccountId" value={toId} onChange={(e) => setToId(e.target.value)} required>
              <option value="">Выберите…</option>
              {accounts.filter((a) => a.id !== accountId).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
            </Select>
          </Field>
          {crossCurrency ? (
            <Field label={`Поступило на счёт, ${dest!.currency}`} error={errors?.transferAmount}>
              <Input name="transferAmount" inputMode="decimal" defaultValue={initial?.transferAmount} required />
            </Field>
          ) : null}
          <p className="text-xs text-text-muted">Перевод между своими счетами не считается ни доходом, ни расходом.</p>
        </>
      ) : null}

      {type === 'debt_payment' ? (
        <>
          <Field label="Долг" error={errors?.debtId}>
            <Select name="debtId" defaultValue={initial?.debtId ?? ''} required>
              <option value="">Выберите…</option>
              {debts.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.currency})</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Из них проценты" error={errors?.interest}><Input name="interest" inputMode="decimal" defaultValue={initial?.interest} placeholder="0" /></Field>
            <Field label="Из них комиссии" error={errors?.fee}><Input name="fee" inputMode="decimal" defaultValue={initial?.fee} placeholder="0" /></Field>
          </div>
          {errors?.principal ? <p role="alert" className="text-xs text-negative">{errors.principal}</p> : null}
          <p className="text-xs text-text-muted">Остальное засчитывается в погашение основного долга и не считается расходом.</p>
        </>
      ) : null}

      {showCategory ? (
        <Field label="Категория" error={errors?.categoryId}>
          <Select name="categoryId" defaultValue={initial?.categoryId ?? ''}>
            <option value="">Без категории</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
      ) : null}

      <Field label={type === 'income' ? 'Источник' : 'Получатель / магазин'} error={errors?.counterparty}>
        <Input name="counterparty" defaultValue={initial?.counterparty} maxLength={120} />
      </Field>
      <Field label="Комментарий" error={errors?.comment}>
        <Textarea name="comment" defaultValue={initial?.comment} maxLength={500} rows={2} />
      </Field>

      {state && !state.ok && state.error ? <p role="alert" className="text-sm text-negative">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>{pending ? 'Сохраняем…' : 'Сохранить'}</Button>
    </form>
  );
}
