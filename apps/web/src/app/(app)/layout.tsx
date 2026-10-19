import { LogOut } from 'lucide-react';
import { BottomNav, SideNav } from '@/components/layout/nav';
import { Button } from '@/components/ui/button';
import { signOut } from '@/lib/actions/auth';
import { requireContext } from '@/lib/db/queries';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px]">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col justify-between border-r border-border p-4 lg:flex">
        <div className="flex flex-col gap-6">
          <div>
            <p className="text-base font-semibold tracking-tight">Семейные финансы</p>
            <p className="mt-0.5 truncate text-xs text-text-muted">{ctx.household.name}</p>
          </div>
          <SideNav />
        </div>
        <form action={signOut} className="flex flex-col gap-2">
          <p className="truncate text-xs text-text-muted" title={ctx.email ?? undefined}>{ctx.email}</p>
          <Button variant="ghost" size="sm" type="submit" className="justify-start"><LogOut className="h-4 w-4" aria-hidden /> Выйти</Button>
        </form>
      </aside>
      <div className="min-w-0 flex-1 px-4 pb-24 pt-4 lg:px-8 lg:pb-10 lg:pt-8">
        <header className="mb-4 flex items-center justify-between lg:hidden">
          <p className="font-semibold">{ctx.household.name}</p>
          <form action={signOut}><Button variant="ghost" size="icon" type="submit" aria-label="Выйти"><LogOut className="h-4 w-4" /></Button></form>
        </header>
        {children}
      </div>
      <BottomNav />
    </div>
  );
}
