'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Landmark, LayoutDashboard, PiggyBank, Receipt, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/', label: 'Обзор', icon: LayoutDashboard },
  { href: '/transactions', label: 'Операции', icon: Receipt },
  { href: '/analytics', label: 'Аналитика', icon: BarChart3 },
  { href: '/debts', label: 'Долги', icon: Landmark },
  { href: '/budgets', label: 'Бюджеты', icon: PiggyBank },
  { href: '/settings', label: 'Настройки', icon: Settings },
];

function active(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

export function SideNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Основная навигация" className="flex flex-col gap-1">
      {ITEMS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={active(pathname, href) ? 'page' : undefined}
          className={cn('flex items-center gap-3 rounded-lg px-3 py-2 text-sm', active(pathname, href) ? 'bg-surface-muted font-medium' : 'text-text-secondary hover:bg-surface-muted')}
        >
          <Icon className="h-4 w-4" aria-hidden />
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Основная навигация" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
      {ITEMS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={active(pathname, href) ? 'page' : undefined}
          className={cn('flex min-h-14 flex-col items-center justify-center gap-0.5 text-[10px]', active(pathname, href) ? 'font-medium text-accent' : 'text-text-muted')}
        >
          <Icon className="h-5 w-5" aria-hidden />
          {label}
        </Link>
      ))}
    </nav>
  );
}
