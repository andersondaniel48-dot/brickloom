import { Blocks, Home, LayoutGrid, ScanLine, Settings, Sparkles, type LucideIcon } from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useCatalog } from '../lib/catalog.ts';
import { useInventory, useStats } from '../lib/inventory.ts';
import { AccountChip } from './Account.tsx';
import { DesignChip } from './DesignChip.tsx';
import { Logo, cx } from './ui.tsx';

const NAV: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/collection', label: 'Collection', icon: LayoutGrid },
  { to: '/scan', label: 'Scan', icon: ScanLine },
  { to: '/create', label: 'Create', icon: Sparkles },
  { to: '/builds', label: 'Builds', icon: Blocks },
];

export function Shell() {
  const catalog = useCatalog();
  const stats = useStats(useInventory(), catalog);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const immersive = pathname === '/scan';

  return (
    <div className="min-h-dvh short:rail-space lg:pl-64">
      {/* Sidebar: large screens */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface px-4 py-6 lg:flex">
        <NavLink to="/" className="mb-8 flex items-center gap-3 px-2">
          <Logo size={38} />
          <span className="font-display text-[22px] font-bold tracking-tight">Brickloom</span>
        </NavLink>
        <nav className="flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-3 rounded-2xl px-3.5 py-3 text-[15px] font-semibold transition-colors',
                  isActive ? 'bg-ink text-bg' : 'text-ink-2 hover:bg-ink/5 hover:text-ink',
                )
              }
            >
              <Icon className="size-5" strokeWidth={2.2} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-3">
          <div className="studs rounded-2xl bg-surface-2 px-4 py-3.5">
            <div className="tabular font-display text-2xl font-bold">{stats.pieces.toLocaleString()}</div>
            <div className="text-sm text-ink-2">
              pieces in {stats.colors} color{stats.colors === 1 ? '' : 's'}
            </div>
          </div>
          <AccountChip onOpen={() => navigate('/settings')} />
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              cx('flex items-center gap-3 rounded-2xl px-3.5 py-3 text-[15px] font-semibold transition-colors', isActive ? 'bg-ink/8 text-ink' : 'text-ink-2 hover:bg-ink/5 hover:text-ink')
            }
          >
            <Settings className="size-5" strokeWidth={2.2} />
            Settings
          </NavLink>
        </div>
      </aside>

      <main className={cx('mx-auto w-full', immersive ? 'max-w-none' : 'max-w-6xl px-4 pb-32 pt-5 short:pb-8 sm:px-8 sm:pt-8 lg:pb-12')}>
        <Outlet />
      </main>

      <DesignChip />

      {/* Tab bar: phones and tablets. On a phone held sideways it stands on the left instead, where it costs no height. */}
      <nav className="safe-bottom pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 short:inset-y-0 short:right-auto short:items-center short:px-0 short:pb-0 short:pl-[max(env(safe-area-inset-left),0.5rem)] lg:hidden">
        <div className="pointer-events-auto flex w-full max-w-md items-center justify-between rounded-[28px] border border-line bg-surface/85 px-2 py-1.5 shadow-float backdrop-blur-xl short:w-auto short:flex-col short:gap-1 short:px-1.5 short:py-2">
          {NAV.map(({ to, label, icon: Icon, end }) =>
            to === '/scan' ? (
              <NavLink
                key={to}
                to={to}
                aria-label={label}
                className={({ isActive }) =>
                  cx(
                    '-mt-7 flex size-[60px] shrink-0 items-center justify-center rounded-full border-4 border-bg bg-accent text-accent-ink shadow-card transition-transform active:scale-90 short:mt-0 short:size-12 short:border-0',
                    isActive && 'ring-2 ring-ink',
                  )
                }
              >
                <Icon className="size-7" strokeWidth={2.4} />
              </NavLink>
            ) : (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cx('flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-2xl py-1.5 text-[11px] font-semibold transition-colors short:flex-none short:py-1', isActive ? 'text-ink' : 'text-ink-3')
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={cx('flex h-7 w-12 items-center justify-center rounded-full transition-colors', isActive && 'bg-accent text-accent-ink')}>
                      <Icon className="size-[20px]" strokeWidth={2.3} />
                    </span>
                    <span className="short:sr-only">{label}</span>
                  </>
                )}
              </NavLink>
            ),
          )}
        </div>
      </nav>
    </div>
  );
}
