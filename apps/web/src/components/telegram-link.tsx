'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { createTelegramLink, unlinkTelegram } from '@/lib/actions/telegram';

export function TelegramLink({ linked }: { linked: boolean }) {
  const [busy, start] = useTransition();
  const [link, setLink] = useState<{ url: string; code: string } | null>(null);
  if (linked) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-positive">Telegram привязан.</span>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => start(async () => {
          const r = await unlinkTelegram();
          if (r.ok) toast.success(r.message ?? 'Готово'); else toast.error(r.error ?? 'Ошибка');
        })}>Отвязать</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-text-secondary">Привяжите Telegram, чтобы записывать операции сообщениями, голосом и фото чеков.</p>
      <Button className="self-start" disabled={busy} onClick={() => start(async () => {
        const r = await createTelegramLink();
        if (r.ok && r.link && r.code) { setLink({ url: r.link, code: r.code }); toast.success(r.message ?? 'Готово'); } else if (!r.ok) toast.error(r.error ?? 'Ошибка');
      })}>Получить ссылку</Button>
      {link ? (
        <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
          <a href={link.url} target="_blank" rel="noreferrer" className="font-medium text-accent underline">Открыть бота и привязать</a>
          <p className="text-xs text-text-muted">Или отправьте боту: <code>/start {link.code}</code>. Код одноразовый, действует 15 минут.</p>
        </div>
      ) : null}
    </div>
  );
}
