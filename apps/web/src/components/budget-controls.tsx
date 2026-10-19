'use client';
import { useState, useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ActionForm, FormField } from '@/components/action-form';
import { contributeToGoal, deleteGoal, removeLimit } from '@/lib/actions/budgets';
import type { ActionResult } from '@/lib/actions/result';

export function RemoveButton({ label, onConfirm, confirmText }: { label: string; onConfirm: () => Promise<ActionResult>; confirmText?: string }) {
  const [busy, start] = useTransition();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="icon" aria-label={label} onClick={() => setOpen(true)}><Trash2 className="h-4 w-4" /></Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={label} description={confirmText ?? 'Действие нельзя отменить.'}>
          <div className="flex justify-end gap-2">
            <DialogClose asChild><Button variant="outline">Отмена</Button></DialogClose>
            <Button variant="destructive" disabled={busy} onClick={() => start(async () => {
              const r = await onConfirm();
              if (r.ok) { toast.success(r.message ?? 'Готово'); setOpen(false); } else toast.error(r.error ?? 'Не удалось выполнить');
            })}>Удалить</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export const RemoveLimitButton = ({ id, name }: { id: string; name: string }) => (
  <RemoveButton label={`Удалить лимит: ${name}`} onConfirm={() => removeLimit(id)} confirmText="Лимит будет снят, расходы останутся." />
);
export const DeleteGoalButton = ({ id, name }: { id: string; name: string }) => (
  <RemoveButton label={`Удалить цель: ${name}`} onConfirm={() => deleteGoal(id)} confirmText="Цель будет удалена вместе с накопленной суммой в учёте цели; операции не затрагиваются." />
);

export function ContributeForm({ id }: { id: string }) {
  return (
    <ActionForm action={contributeToGoal.bind(null, id)} submitLabel="Добавить" className="flex items-end gap-2">
      <FormField label="Пополнить на" name="amount"><Input name="amount" inputMode="decimal" placeholder="1000" className="w-32" /></FormField>
    </ActionForm>
  );
}
