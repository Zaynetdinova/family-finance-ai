'use client';
import { useState, useTransition } from 'react';
import { Check, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { confirmTransaction, deleteTransaction } from '@/lib/actions/transactions';
import { TransactionFormDialog, type FormAccount, type FormCategory, type FormDebt, type TransactionInitial } from './transaction-form';

interface Props {
  id: string;
  label: string;
  pending: boolean;
  canWrite: boolean;
  initial: TransactionInitial;
  accounts: FormAccount[];
  categories: FormCategory[];
  debts: FormDebt[];
}

export function RowActions({ id, label, pending, canWrite, initial, accounts, categories, debts }: Props) {
  const [busy, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  if (!canWrite) return null;

  const run = (fn: () => ReturnType<typeof deleteTransaction>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(r.message ?? 'Готово'); after?.(); } else toast.error(r.error ?? 'Не удалось выполнить действие');
    });

  return (
    <div className="flex items-center justify-end gap-1">
      {pending ? (
        <Button variant="ghost" size="icon" aria-label={`Подтвердить: ${label}`} disabled={busy} onClick={() => run(() => confirmTransaction(id))}>
          <Check className="h-4 w-4" />
        </Button>
      ) : null}
      <TransactionFormDialog
        trigger={<Button variant="ghost" size="icon" aria-label={`Редактировать: ${label}`}><Pencil className="h-4 w-4" /></Button>}
        {...{ accounts, categories, debts, initial }}
      />
      <Button variant="ghost" size="icon" aria-label={`Удалить: ${label}`} onClick={() => setConfirming(true)}>
        <Trash2 className="h-4 w-4" />
      </Button>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent title="Удалить операцию?" description={`«${label}» будет удалена без возможности восстановления. Остатки и статистика пересчитаются.`}>
          <div className="flex justify-end gap-2">
            <DialogClose asChild><Button variant="outline">Отмена</Button></DialogClose>
            <Button variant="destructive" disabled={busy} onClick={() => run(() => deleteTransaction(id), () => setConfirming(false))}>
              {busy ? 'Удаляем…' : 'Удалить'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
