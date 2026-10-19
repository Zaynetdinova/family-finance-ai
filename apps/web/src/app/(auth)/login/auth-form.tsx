'use client';
import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { signIn, signUp } from '@/lib/actions/auth';

export function AuthForm() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [state, action, pending] = useActionState(mode === 'in' ? signIn : signUp, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Field label="Email" error={errors?.email}>
        <Input name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Пароль" error={errors?.password}>
        <Input name="password" type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} required />
      </Field>
      {state && !state.ok && state.error ? <p role="alert" className="text-sm text-negative">{state.error}</p> : null}
      {state?.ok && state.message ? <p role="status" className="text-sm text-positive">{state.message}</p> : null}
      <Button type="submit" disabled={pending}>{pending ? 'Подождите…' : mode === 'in' ? 'Войти' : 'Создать аккаунт'}</Button>
      <button type="button" className="text-sm text-text-secondary underline" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
        {mode === 'in' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти'}
      </button>
    </form>
  );
}
