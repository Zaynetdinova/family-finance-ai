import * as React from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function StatCard({
  label, value, hint, tone, children,
}: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'positive' | 'negative'; children?: React.ReactNode }) {
  return (
    <Card className="p-4 sm:p-5">
      <p className="text-xs font-medium text-text-secondary">{label}</p>
      <p className={cn('tabular mt-1.5 text-xl font-semibold tracking-tight sm:text-2xl', tone === 'positive' && 'text-positive', tone === 'negative' && 'text-negative')}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-text-muted">{hint}</p> : null}
      {children}
    </Card>
  );
}
