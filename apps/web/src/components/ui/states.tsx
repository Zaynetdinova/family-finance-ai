import * as React from 'react';
import { AlertTriangle, Inbox } from 'lucide-react';
import { Card } from './card';

export function EmptyState({
  title, description, action, icon,
}: { title: string; description?: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div className="text-text-muted">{icon ?? <Inbox className="h-8 w-8" aria-hidden />}</div>
      <h3 className="text-base font-medium">{title}</h3>
      {description ? <p className="max-w-md text-sm text-text-secondary">{description}</p> : null}
      {action}
    </Card>
  );
}

export function ErrorState({ title = 'Не удалось загрузить данные', message }: { title?: string; message?: string }) {
  return (
    <Card role="alert" className="flex items-start gap-3 border-negative/40 px-5 py-4">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-negative" aria-hidden />
      <div>
        <p className="text-sm font-medium">{title}</p>
        {message ? <p className="mt-1 text-sm text-text-secondary">{message}</p> : null}
      </div>
    </Card>
  );
}

export function Notice({ tone = 'warning', children }: { tone?: 'warning' | 'info'; children: React.ReactNode }) {
  return (
    <div
      role="note"
      className={`rounded-lg border px-4 py-3 text-sm ${tone === 'warning' ? 'border-warning/50 text-text-secondary' : 'border-border text-text-secondary'}`}
    >
      {children}
    </div>
  );
}
