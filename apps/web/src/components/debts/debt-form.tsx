'use client';
import { useState, useTransition } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Input, Select, Textarea } from '@/components/ui/input';
import { ActionForm, FormField } from '@/components/action-form';
import { deleteDebt, saveDebt } from '@/lib/actions/debts';
import { CURRENCY_OPTIONS } from '@/lib/labels';

export interface DebtInitial {
  id: string;
  name: string;
  direction: string;
  kind: string;
  currency: string;
  originalAmount: string;
  currentBalance: string;
  interestRate: string;
  rateType: string;
  minPayment: string;
  paymentDay: string;
  openedOn: string;
  dueDate: string;
  counterparty: string;
  allowsPrepayment: boolean;
  priority: boolean;
  notes: string;
}

export function DebtFormDialog({ trigger, initial }: { trigger: React.ReactNode; initial?: DebtInitial }) {
  const [open, setOpen] = useState(false);
  const d = initial;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={d ? 'Изменить долг' : 'Новый долг'} description="Кредит, ипотека, долг человеку или деньги, которые должны вам.">
        <ActionForm action={saveDebt.bind(null, d?.id ?? null)} submitLabel="Сохранить" resetOnSuccess={false} onSuccess={() => setOpen(false)}>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Название" name="name" className="col-span-2"><Input name="name" defaultValue={d?.name} required /></FormField>
            <FormField label="Направление" name="direction">
              <Select name="direction" defaultValue={d?.direction ?? 'owed_by_me'}>
                <option value="owed_by_me">Я должен</option>
                <option value="owed_to_me">Мне должны</option>
              </Select>
            </FormField>
            <FormField label="Вид" name="kind">
              <Select name="kind" defaultValue={d?.kind ?? 'loan'}>
                <option value="loan">Кредит</option><option value="mortgage">Ипотека</option><option value="credit_card">Кредитная карта</option>
                <option value="personal">Долг человеку</option><option value="other">Другое</option>
              </Select>
            </FormField>
            <FormField label="Валюта" name="currency"><Select name="currency" defaultValue={d?.currency ?? 'RUB'}>{CURRENCY_OPTIONS}</Select></FormField>
            <FormField label="Контрагент" name="counterparty"><Input name="counterparty" defaultValue={d?.counterparty} placeholder="Банк или человек" /></FormField>
            <FormField label="Первоначальная сумма" name="originalAmount"><Input name="originalAmount" inputMode="decimal" defaultValue={d?.originalAmount} required /></FormField>
            <FormField label="Текущий остаток" name="currentBalance"><Input name="currentBalance" inputMode="decimal" defaultValue={d?.currentBalance} required /></FormField>
            <FormField label="Ставка, % годовых" name="interestRate"><Input name="interestRate" inputMode="decimal" defaultValue={d?.interestRate} placeholder="12,5" /></FormField>
            <FormField label="Тип ставки" name="rateType">
              <Select name="rateType" defaultValue={d?.rateType ?? 'fixed'}><option value="fixed">Фиксированная</option><option value="variable">Плавающая</option></Select>
            </FormField>
            <FormField label="Минимальный платёж" name="minPayment"><Input name="minPayment" inputMode="decimal" defaultValue={d?.minPayment} /></FormField>
            <FormField label="День платежа (1–31)" name="paymentDay"><Input name="paymentDay" inputMode="numeric" defaultValue={d?.paymentDay} /></FormField>
            <FormField label="Дата открытия" name="openedOn"><Input name="openedOn" type="date" defaultValue={d?.openedOn} /></FormField>
            <FormField label="Срок погашения" name="dueDate"><Input name="dueDate" type="date" defaultValue={d?.dueDate} /></FormField>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="allowsPrepayment" defaultChecked={d?.allowsPrepayment ?? true} /> Допускается досрочное погашение</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="priority" defaultChecked={d?.priority} /> Приоритетное обязательство</label>
          <FormField label="Заметки" name="notes"><Textarea name="notes" defaultValue={d?.notes} rows={2} /></FormField>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

export function DebtRowActions({ initial, canDelete }: { initial: DebtInitial; canDelete: boolean }) {
  const [busy, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex items-center gap-1">
      <DebtFormDialog initial={initial} trigger={<Button variant="ghost" size="icon" aria-label={`Изменить долг ${initial.name}`}><Pencil className="h-4 w-4" /></Button>} />
      {canDelete ? (
        <>
          <Button variant="ghost" size="icon" aria-label={`Удалить долг ${initial.name}`} onClick={() => setConfirming(true)}><Trash2 className="h-4 w-4" /></Button>
          <Dialog open={confirming} onOpenChange={setConfirming}>
            <DialogContent title="Удалить долг?" description={`«${initial.name}» будет удалён вместе с историей платежей по нему. Если по долгу есть операции, сначала удалите их.`}>
              <div className="flex justify-end gap-2">
                <DialogClose asChild><Button variant="outline">Отмена</Button></DialogClose>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() => start(async () => {
                    const r = await deleteDebt(initial.id);
                    if (r.ok) { toast.success(r.message ?? 'Удалено'); setConfirming(false); } else toast.error(r.error ?? 'Не удалось удалить');
                  })}
                >
                  {busy ? 'Удаляем…' : 'Удалить'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}
