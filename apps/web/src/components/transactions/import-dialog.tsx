'use client';
import { useActionState, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { importTransactions, type ImportResult } from '@/lib/actions/import';

export function ImportDialog() {
  const [state, action, pending] = useActionState<ImportResult | null, FormData>(importTransactions, null);
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><Upload className="h-4 w-4" aria-hidden /> Импорт CSV</Button></DialogTrigger>
      <DialogContent title="Импорт из CSV" description="Колонки: date, type, amount, account (обязательные); currency, to_account, category, counterparty, comment (необязательные).">
        <form action={action} className="flex flex-col gap-3">
          <Input type="file" name="file" accept=".csv,text/csv" required />
          <p className="text-xs text-text-muted">
            Дата: ГГГГ-ММ-ДД или ДД.ММ.ГГГГ. Тип: income/expense/transfer/refund или доход/расход/перевод/возврат. Счёт и категория — по названию. Повторная загрузка того же файла дубликатов не создаёт.
          </p>
          {state && !state.ok ? <p role="alert" className="text-sm text-negative">{state.error}</p> : null}
          {state?.ok ? (
            <div role="status" className="text-sm">
              <p className="text-positive">Импортировано: {state.imported}. Пропущено как уже загруженные: {state.skipped}.</p>
              {state.errors.length ? (
                <ul className="mt-2 list-disc pl-5 text-xs text-negative">{state.errors.map((e) => <li key={e}>{e}</li>)}</ul>
              ) : null}
            </div>
          ) : null}
          <Button type="submit" disabled={pending}>{pending ? 'Загружаем…' : 'Загрузить'}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
