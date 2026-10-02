import { Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  Bell,
  ChartColumn,
  ClipboardList,
  CircleHelp,
  ClockArrowDown,
  Contact,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  ReceiptText,
  Truck,
  KeyRound,
  Receipt,
  ScrollText,
  Settings,
  ShoppingCart,
  Users,
  Wallet,
  Warehouse,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ROLE_LABEL } from '../lib/format';
import type { Permission } from '../lib/types';
import { Logo } from './Logo';
import { Spinner } from './ui';
import { ErrorBoundary } from './ErrorBoundary';
import { ChangePasswordModal } from './ChangePassword';
import { HelpPanel } from './help/HelpPanel';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  permission?: Permission;
  badge?: number;
  end?: boolean;
}

export function Layout() {
  const { session, logout, can } = useAuth();
  const [open, setOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const closeHelp = useCallback(() => setHelpOpen(false), []);

  // F1 abre a ajuda em qualquer tela.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'F1') return;
      event.preventDefault();
      setHelpOpen((current) => !current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const location = useLocation();
  const [lastPath, setLastPath] = useState(location.pathname);

  // Fecha o menu móvel ao navegar.
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname);
    setOpen(false);
  }

  const { data: alerts } = useQuery({
    queryKey: ['alerts', 'summary'],
    queryFn: () => api.get<{ open: number; unacknowledged: number }>('/alerts/summary'),
    refetchInterval: 30_000,
  });

  const sections: Array<{ title?: string; items: NavItem[] }> = [
    {
      items: [
        { to: '/', label: 'Dashboard', icon: <LayoutDashboard />, end: true },
        { to: '/alerts', label: 'Alertas', icon: <Bell />, badge: alerts?.open },
      ],
    },
    {
      title: 'Vendas',
      items: [
        { to: '/sales/new', label: 'Nova venda', icon: <ShoppingCart />, permission: 'sales:create' },
        { to: '/sales', label: 'Vendas', icon: <Receipt />, end: true },
        { to: '/cash', label: 'Caixa', icon: <Wallet /> },
        { to: '/customers', label: 'Clientes', icon: <Contact /> },
      ],
    },
    {
      title: 'Operação',
      items: [
        { to: '/movements/new', label: 'Nova movimentação', icon: <ArrowLeftRight />, permission: 'stock:move' },
        { to: '/movements/nfe', label: 'Entrada por NF-e', icon: <ReceiptText />, permission: 'stock:move' },
        { to: '/movements', label: 'Histórico', icon: <ClockArrowDown />, end: true },
        { to: '/inventories', label: 'Inventário', icon: <ClipboardList /> },
      ],
    },
    {
      title: 'Cadastros',
      items: [
        { to: '/products', label: 'Produtos', icon: <Package /> },
        { to: '/suppliers', label: 'Fornecedores', icon: <Truck /> },
        { to: '/warehouses', label: 'Estoques', icon: <Warehouse /> },
      ],
    },
    {
      title: 'Gestão',
      items: [
        { to: '/reports', label: 'Relatórios', icon: <ChartColumn />, permission: 'reports:read' },
        { to: '/audit', label: 'Alterações', icon: <ScrollText />, permission: 'audit:read' },
        { to: '/settings', label: 'Configurações', icon: <Settings />, permission: 'settings:manage' },
        { to: '/users', label: 'Usuários', icon: <Users />, permission: 'users:manage' },
      ],
    },
  ];

  const sidebar = (
    <nav className="flex h-full flex-col bg-slate-900 text-slate-300">
      <div className="flex h-16 items-center justify-between px-5">
        <Logo className="text-white" />
        <button className="text-slate-400 lg:hidden" onClick={() => setOpen(false)} aria-label="Fechar menu">
          <X className="size-5" />
        </button>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {sections.map((section, index) => {
          const items = section.items.filter((item) => !item.permission || can(item.permission));
          if (items.length === 0) return null;
          return (
            <div key={index}>
              {section.title && (
                <p className="mb-2 px-3 text-xs font-medium tracking-wider text-slate-500 uppercase">{section.title}</p>
              )}
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        clsx(
                          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors [&>svg]:size-4',
                          isActive ? 'bg-slate-800 text-white' : 'hover:bg-slate-800/60 hover:text-white',
                        )
                      }
                    >
                      {item.icon}
                      <span className="flex-1">{item.label}</span>
                      {item.badge ? (
                        <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-semibold text-white tabular-nums">
                          {item.badge}
                        </span>
                      ) : null}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          className="flex w-full items-center gap-3 rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 hover:text-white [&>svg]:size-4"
        >
          <CircleHelp />
          <span className="flex-1 text-left">Ajuda e dúvidas</span>
          <kbd className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">F1</kbd>
        </button>
      </div>

      <div className="border-t border-slate-800 p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-full bg-brand-700 text-sm font-semibold text-white">
            {session?.user.name.charAt(0)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{session?.user.name}</p>
            <p className="text-xs text-slate-400">{session && ROLE_LABEL[session.user.role]}</p>
          </div>
          <button
            onClick={() => setChangingPassword(true)}
            className="rounded-md p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="Alterar minha senha"
            title="Alterar minha senha"
          >
            <KeyRound className="size-4" />
          </button>
          <button
            onClick={logout}
            className="rounded-md p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="Sair"
            title="Sair"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{sidebar}</aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} aria-hidden />
          <aside className="relative h-full w-72 max-w-[85vw]">{sidebar}</aside>
        </div>
      )}

      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 lg:hidden">
        <button
          onClick={() => setOpen(true)}
          className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100"
          aria-label="Abrir menu"
        >
          <Menu className="size-5" />
        </button>
        <Logo />
        <button
          onClick={() => setHelpOpen(true)}
          className="ml-auto rounded-md p-1.5 text-slate-600 hover:bg-slate-100"
          aria-label="Abrir ajuda"
        >
          <CircleHelp className="size-5" />
        </button>
      </header>

      {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
      <HelpPanel open={helpOpen} onClose={closeHelp} />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <ErrorBoundary key={location.pathname}>
          <Suspense fallback={<Spinner />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}
