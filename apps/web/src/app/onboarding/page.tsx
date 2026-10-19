import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getAppContext } from '@/lib/db/queries';
import { OnboardingForm } from './onboarding-form';

export const metadata: Metadata = { title: 'Первая настройка' };

export default async function OnboardingPage() {
  const ctx = await getAppContext({ allowNoHousehold: true });
  if (ctx) redirect('/');
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Давайте начнём</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Создайте бюджет (личный или семейный) и первый счёт. Участников можно добавить позже.
        </p>
      </div>
      <OnboardingForm />
    </main>
  );
}
