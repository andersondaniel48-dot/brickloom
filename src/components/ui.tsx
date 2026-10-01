// Small, shared interface pieces.
import { Check, Minus, Plus, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { create } from 'zustand';
import type { CatalogColor } from '../lib/catalog.ts';
import { inkOn } from '../lib/color.ts';

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

// ---------------------------------------------------------------- buttons

type ButtonVariant = 'primary' | 'accent' | 'soft' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-bg hover:opacity-90 shadow-soft',
  accent: 'bg-accent text-accent-ink hover:brightness-[1.04] shadow-soft',
  soft: 'bg-surface-2 text-ink border border-line hover:border-line-strong',
  ghost: 'text-ink-2 hover:bg-ink/5 hover:text-ink',
  danger: 'bg-brick-red/10 text-brick-red hover:bg-brick-red/15',
};
const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 text-sm gap-1.5 rounded-xl',
  md: 'h-11 px-5 text-[15px] gap-2 rounded-2xl',
  lg: 'h-14 px-7 text-base gap-2.5 rounded-[20px]',
};

export function Button({
  variant = 'soft',
  size = 'md',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center font-semibold transition-[transform,opacity,filter,background-color,border-color] duration-150 active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100',
        BUTTON_VARIANT[variant],
        BUTTON_SIZE[size],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={cx(
        'inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink-2 transition duration-150 hover:bg-ink/5 hover:text-ink active:scale-90 disabled:opacity-40',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Chip({
  active,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      {...props}
      className={cx(
        'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition duration-150 active:scale-95',
        active ? 'border-ink bg-ink text-bg' : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div role="radiogroup" className={cx('inline-flex rounded-2xl border border-line bg-surface-2 p-1', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={cx(
            'relative flex-1 whitespace-nowrap rounded-xl px-3.5 py-1.5 text-sm font-semibold transition-colors',
            option.value === value ? 'bg-surface text-ink shadow-soft' : 'text-ink-3 hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- quantity

export function Stepper({ value, onChange, min = 0, size = 'md' }: { value: number; onChange: (value: number) => void; min?: number; size?: 'sm' | 'md' }) {
  const button = size === 'sm' ? 'size-7' : 'size-9';
  return (
    <div className={cx('inline-flex items-center rounded-full border border-line bg-surface-2', size === 'sm' ? 'gap-0.5 p-0.5' : 'gap-1 p-1')}>
      <button
        type="button"
        aria-label="Decrease"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        className={cx(button, 'inline-flex items-center justify-center rounded-full text-ink-2 transition hover:bg-ink/5 active:scale-90 disabled:opacity-30')}
      >
        <Minus className="size-4" strokeWidth={2.5} />
      </button>
      <span className={cx('tabular text-center font-display font-semibold', size === 'sm' ? 'min-w-6 text-sm' : 'min-w-8 text-base')}>{value}</span>
      <button
        type="button"
        aria-label="Increase"
        onClick={() => onChange(value + 1)}
        className={cx(button, 'inline-flex items-center justify-center rounded-full bg-surface text-ink shadow-soft transition active:scale-90')}
      >
        <Plus className="size-4" strokeWidth={2.5} />
      </button>
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (checked: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-2.5">
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold">{label}</span>
        {hint && <span className="block text-sm text-ink-3">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="relative h-7 w-12 shrink-0 rounded-full bg-ink/15 transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-6 after:rounded-full after:bg-white after:shadow-soft after:transition-transform peer-checked:bg-brick-green peer-checked:after:translate-x-5 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brick-blue" />
    </label>
  );
}

// ---------------------------------------------------------------- color

/** A stud seen from above, in the given color. */
export function ColorDot({ color, size = 18, selected, className }: { color: CatalogColor; size?: number; selected?: boolean; className?: string }) {
  const hex = `#${color.rgb}`;
  return (
    <span
      title={color.name}
      className={cx('relative inline-flex shrink-0 items-center justify-center rounded-full', className)}
      style={{
        width: size,
        height: size,
        background: color.trans ? `linear-gradient(135deg, ${hex}cc, ${hex}66)` : hex,
        boxShadow: `inset 0 0 0 1px rgba(0,0,0,0.14), inset 0 ${size / 9}px ${size / 6}px rgba(255,255,255,0.35)${selected ? ', 0 0 0 2px var(--surface), 0 0 0 4px var(--ink)' : ''}`,
      }}
    >
      {selected && size >= 24 && <Check style={{ color: inkOn(color.rgb), width: size * 0.5, height: size * 0.5 }} strokeWidth={3} />}
    </span>
  );
}

// ---------------------------------------------------------------- sheet

/** Bottom sheet on phones, centered dialog on larger screens. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
          <motion.div
            className="absolute inset-0 bg-black/45 backdrop-blur-[3px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            className={cx(
              'relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-surface shadow-float sm:rounded-[28px]',
              wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
            )}
            initial={{ y: 48, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 48, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 36 }}
          >
            <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-ink/15 sm:hidden" />
            {title !== undefined && (
              <div className="flex shrink-0 items-center justify-between gap-3 px-5 pb-2 pt-3 sm:px-6 sm:pt-5">
                <h2 className="min-w-0 truncate text-xl font-semibold">{title}</h2>
                <IconButton label="Close" onClick={onClose} className="-mr-2">
                  <X className="size-5" />
                </IconButton>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 sm:px-6">{children}</div>
            {footer && <div className="safe-bottom shrink-0 border-t border-line bg-surface px-5 pt-3 sm:px-6 sm:pb-5">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------- feedback

interface Toast {
  id: number;
  message: string;
  tone: 'ok' | 'error';
}

const useToasts = create<{ toasts: Toast[]; push: (message: string, tone?: Toast['tone']) => void }>((set) => ({
  toasts: [],
  push: (message, tone = 'ok') => {
    const id = Date.now() + Math.random();
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3200);
  },
}));

export const toast = (message: string, tone: Toast['tone'] = 'ok') => useToasts.getState().push(message, tone);

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: -16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className={cx(
              'flex items-center gap-2.5 rounded-full px-4 py-2.5 text-sm font-semibold shadow-float',
              t.tone === 'error' ? 'bg-brick-red text-white' : 'bg-ink text-bg',
            )}
          >
            {t.tone === 'ok' && (
              <span className="flex size-5 items-center justify-center rounded-full bg-accent text-accent-ink">
                <Check className="size-3.5" strokeWidth={3.5} />
              </span>
            )}
            {t.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cx('inline-block size-5 animate-spin rounded-full border-[2.5px] border-current border-r-transparent', className)}
      role="status"
      aria-label="Loading"
    />
  );
}

/** The app mark: a 2x2 brick from above. */
export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      <rect width="512" height="512" rx="128" fill="var(--accent)" />
      <rect x="100" y="100" width="312" height="312" rx="60" fill="#15171c" />
      <g fill="var(--accent)">
        <circle cx="194" cy="194" r="44" />
        <circle cx="318" cy="194" r="44" />
        <circle cx="194" cy="318" r="44" />
        <circle cx="318" cy="318" r="44" />
      </g>
    </svg>
  );
}

export function PageHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-4 pb-5 pt-2">
      <div className="min-w-0">
        <h1 className="text-[32px] font-bold leading-[1.1] sm:text-[40px]">{title}</h1>
        {subtitle && <p className="mt-1.5 text-[15px] text-ink-2">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="card studs flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-5 flex size-16 items-center justify-center rounded-[22px] bg-accent text-accent-ink shadow-card">{icon}</div>
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-ink-2">{body}</p>
      {action && <div className="mt-6 flex flex-wrap justify-center gap-3">{action}</div>}
    </div>
  );
}
