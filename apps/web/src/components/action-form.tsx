'use client';
import { createContext, useActionState, useContext, useEffect, useRef, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/input';
import type { ActionResult } from '@/lib/actions/result';

const ErrorsContext = createContext<Record<string, string> | undefined>(undefined);

/** Field that shows the server-side validation error for `name`. */
export function FormField({ label, name, children, className }: { label: string; name: string; children: ReactNode; className?: string }) {
  const errors = useContext(ErrorsContext);
  return <Field label={label} error={errors?.[name]} className={className}>{children}</Field>;
}

interface Props<R extends ActionResult> {
  action: (prev: R | null, fd: FormData) => Promise<R>;
  submitLabel: string;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  onSuccess?: (result: R) => void;
}

/** <form> wired to a server action: pending state, field errors, toasts, optional reset. */
export function ActionForm<R extends ActionResult>({ action, submitLabel, children, className, resetOnSuccess = true, onSuccess }: Props<R>) {
  const [state, formAction, pending] = useActionState<R | null, FormData>(action, null);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      if (state.message) toast.success(state.message);
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.(state);
    } else if (state.error) toast.error(state.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <ErrorsContext.Provider value={errors}>
      <form ref={ref} action={formAction} className={className ?? 'flex flex-col gap-3'} noValidate>
        {children}
        {state && !state.ok && state.error ? <p role="alert" className="text-sm text-negative">{state.error}</p> : null}
        <Button type="submit" disabled={pending} className="self-start">{pending ? 'Сохраняем…' : submitLabel}</Button>
      </form>
    </ErrorsContext.Provider>
  );
}
