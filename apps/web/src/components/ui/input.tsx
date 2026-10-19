import * as React from 'react';
import { cn } from '@/lib/utils';

const field =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm min-h-9 placeholder:text-text-muted disabled:opacity-50';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(field, className)} {...props} />,
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={cn(field, 'min-h-20', className)} {...props} />,
);
Textarea.displayName = 'Textarea';

/** Native select: best behaviour on mobile and with assistive tech. */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => <select ref={ref} className={cn(field, 'pr-8', className)} {...props} />,
);
Select.displayName = 'Select';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-xs font-medium text-text-secondary', className)} {...props} />;
}

export function Field({
  label, error, children, className,
}: { label: string; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label>{label}</Label>
      {children}
      {error ? <p role="alert" className="text-xs text-negative">{error}</p> : null}
    </div>
  );
}
