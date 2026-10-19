'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Copy, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { Select } from '@/components/ui/input';
import { ActionForm, FormField } from '@/components/action-form';
import { archiveAccount, createInvite, refreshRatesNow, removeMember, setDefaultAccount, switchHousehold } from '@/lib/actions/settings';
import type { ActionResult } from '@/lib/actions/result';

function useRun() {
  const [busy, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? 'Готово');
      else toast.error(r.error ?? 'Не удалось выполнить действие');
    });
  return { busy, run };
}

export function ArchiveButton({ id, archived }: { id: string; archived: boolean }) {
  const { busy, run } = useRun();
  return <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(() => archiveAccount(id, !archived))}>{archived ? 'Восстановить' : 'В архив'}</Button>;
}

export function RefreshRatesButton() {
  const { busy, run } = useRun();
  return (
    <Button variant="outline" disabled={busy} onClick={() => run(refreshRatesNow)}>
      <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} aria-hidden /> Обновить курсы
    </Button>
  );
}

export function RemoveMemberButton({ userId, name, self }: { userId: string; name: string; self: boolean }) {
  const { busy, run } = useRun();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>{self ? 'Выйти' : 'Удалить'}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={self ? 'Выйти из бюджета?' : `Удалить участника «${name}»?`} description="Доступ к данным бюджета будет закрыт. Созданные операции останутся.">
          <div className="flex justify-end gap-2">
            <DialogClose asChild><Button variant="outline">Отмена</Button></DialogClose>
            <Button variant="destructive" disabled={busy} onClick={() => run(() => removeMember(userId))}>Подтвердить</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function HouseholdSwitcher({ current, households }: { current: string; households: { id: string; name: string }[] }) {
  const [, start] = useTransition();
  return (
    <label className="flex flex-col gap-1 text-xs text-text-secondary">
      Активный бюджет
      <Select value={current} onChange={(e) => start(() => switchHousehold(e.target.value))} className="w-auto">
        {households.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
      </Select>
    </label>
  );
}

export function InviteForm() {
  const [link, setLink] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <ActionForm action={createInvite} submitLabel="Создать ссылку" resetOnSuccess={false} className="flex flex-wrap items-end gap-3" onSuccess={(r) => setLink(r.link ?? null)}>
        <FormField label="Роль приглашённого" name="role">
          <Select name="role" defaultValue="member">
            <option value="member">Участник (запись и чтение)</option>
            <option value="viewer">Наблюдатель (только чтение)</option>
            <option value="admin">Администратор</option>
          </Select>
        </FormField>
      </ActionForm>
      {link ? (
        <div className="flex items-center gap-2 rounded-lg border border-border p-2">
          <code className="min-w-0 flex-1 truncate text-xs" title={link}>{link}</code>
          <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(link).then(() => toast.success('Скопировано'))}>
            <Copy className="h-3.5 w-3.5" aria-hidden /> Копировать
          </Button>
        </div>
      ) : null}
      <p className="text-xs text-text-muted">Ссылка показывается один раз, действует 7 дней и срабатывает однократно. Передайте её только тому, кого приглашаете.</p>
    </div>
  );
}

export function DefaultAccountSelect({ currency, value, accounts }: { currency: string; value: string; accounts: { id: string; name: string }[] }) {
  const { busy, run } = useRun();
  return (
    <label className="flex flex-col gap-1 text-xs text-text-secondary">
      Счёт по умолчанию, {currency}
      <Select defaultValue={value} disabled={busy} onChange={(e) => run(() => setDefaultAccount(currency, e.target.value))} className="w-auto">
        <option value="">— спрашивать —</option>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </Select>
    </label>
  );
}
