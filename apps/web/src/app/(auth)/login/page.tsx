import type { Metadata } from 'next';
import { safeNext } from '@/lib/safe-next';
import { AuthForm } from './auth-form';

export const metadata: Metadata = { title: 'Вход' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Семейные финансы</h1>
        <p className="mt-1 text-sm text-text-secondary">Учёт доходов, расходов и долгов вместе с Telegram-ботом.</p>
      </div>
      {error === 'callback' ? (
        <p role="alert" className="rounded-lg border border-negative/40 px-4 py-3 text-sm">
          Ссылка подтверждения недействительна или устарела. Войдите или зарегистрируйтесь ещё раз.
        </p>
      ) : null}
      <AuthForm next={safeNext(next)} />
    </main>
  );
}
