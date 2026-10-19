import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { acceptInvite } from '@/lib/actions/settings';

export const metadata: Metadata = { title: 'Приглашение' };

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  async function accept() {
    'use server';
    if (!token) return;
    const r = await acceptInvite(token);
    if (!r.ok) redirect(`/join?token=${encodeURIComponent(token)}&error=1`);
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-5 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Приглашение в семейный бюджет</h1>
      {error ? <p role="alert" className="text-sm text-negative">Приглашение недействительно или истекло. Попросите создать новую ссылку.</p> : null}
      {token && !error ? (
        <>
          <p className="text-sm text-text-secondary">Вы получили доступ к общему бюджету. Нажмите кнопку, чтобы присоединиться.</p>
          <form action={accept}><Button type="submit">Присоединиться</Button></form>
        </>
      ) : !token ? <p role="alert" className="text-sm text-negative">В ссылке нет приглашения.</p> : null}
    </main>
  );
}
