import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { currencySymbol, initials, money, signedMoney } from '../lib/format'
import { Icon } from './Icon'
import type { IconName } from './Icon'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

// ---------------------------------------------------------------- Button

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'felt'
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brass text-brass-ink font-semibold hover:bg-[#e2bd76] shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_1px_0_rgba(0,0,0,0.4)]',
  secondary: 'bg-surface-2 text-ink border border-line hover:border-[#3a3a33] hover:bg-[#21211c]',
  ghost: 'text-muted hover:text-ink hover:bg-surface-2',
  danger: 'text-loss border border-loss/30 hover:bg-loss/10',
  felt: 'bg-felt text-felt-ink font-semibold hover:bg-[#23705a] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]',
}
const SIZES = { sm: 'h-8 px-3 text-[13px] gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-12 px-5 text-[15px] gap-2' }

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: keyof typeof SIZES
  icon?: IconName
  loading?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cx(
        'inline-flex select-none items-center justify-center whitespace-nowrap rounded-[10px] transition-[background,border-color,color,transform] active:translate-y-px',
        'disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner className="size-4" /> : icon ? <Icon name={icon} className="size-4" /> : null}
      {children}
    </button>
  )
}

export function IconButton({
  icon,
  label,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex size-9 items-center justify-center rounded-[10px] text-muted transition-colors hover:bg-surface-2 hover:text-ink',
        'disabled:pointer-events-none disabled:opacity-40',
        className,
      )}
      {...rest}
    >
      <Icon name={icon} className="size-[18px]" />
    </button>
  )
}

// ---------------------------------------------------------------- Money

export function Money({
  value,
  signed,
  colored,
  className,
}: {
  value: number
  /** show +/− */
  signed?: boolean
  /** green for positive, red for negative */
  colored?: boolean
  className?: string
}) {
  const color = colored ? (value > 0.004 ? 'text-win' : value < -0.004 ? 'text-loss' : 'text-muted') : ''
  return <span className={cx('tnum', color, className)}>{signed ? signedMoney(value) : money(value)}</span>
}

// ---------------------------------------------------------------- Layout bits

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-[14px] border border-line bg-surface', className)}>{children}</div>
}

/** Page heading: a serif title with an optional muted line and action. */
export function PageHeader({ title, sub, action, back }: { title: ReactNode; sub?: ReactNode; action?: ReactNode; back?: ReactNode }) {
  return (
    <div className="flex items-end gap-3">
      {back}
      <div className="min-w-0 flex-1">
        <h1 className="font-display truncate text-[34px] leading-[1.05]">{title}</h1>
        {sub && <div className="mt-1 truncate text-sm text-muted">{sub}</div>}
      </div>
      {action && <div className="shrink-0 pb-0.5">{action}</div>}
    </div>
  )
}

/** A ledger-style section label: text followed by a hairline rule. */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-0.5 pb-2.5 pt-7">
      <h2 className="shrink-0 text-[13px] font-semibold text-muted">{children}</h2>
      <span className="h-px flex-1 bg-line" />
      {action}
    </div>
  )
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'live' | 'win' | 'loss' | 'warn' | 'brass'; children: ReactNode }) {
  const tones = {
    neutral: 'bg-surface-2 text-muted border-line',
    live: 'bg-felt/40 text-felt-ink border-felt',
    win: 'bg-win/10 text-win border-win/25',
    loss: 'bg-loss/10 text-loss border-loss/25',
    warn: 'bg-warn/10 text-warn border-warn/25',
    brass: 'bg-brass/10 text-brass border-brass/30',
  }
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', tones[tone])}>
      {children}
    </span>
  )
}

export function Spinner({ className = 'size-5' }: { className?: string }) {
  return (
    <svg className={cx('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-muted">
      <Spinner className="size-4" /> {label}
    </div>
  )
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Card className="flex items-start gap-3 border-loss/30 p-4 text-sm">
      <Icon name="alert" className="mt-0.5 size-5 shrink-0 text-loss" />
      <div className="flex-1">
        <p className="text-loss">{error instanceof Error ? error.message : String(error)}</p>
        {onRetry && (
          <button className="mt-2 text-muted underline" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    </Card>
  )
}

export function Empty({ icon, title, children }: { icon?: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      {icon && <Icon name={icon} className="size-7 text-faint" />}
      <p className="font-display text-xl">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
    </div>
  )
}

/** Stable, well-spread hue per name (golden-angle steps), so each regular has "their" chip color. */
function hueFor(name: string): number {
  let h = 0
  for (const ch of name.trim().toLowerCase()) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0
  return Math.round((h % 997) * 137.508) % 360
}

/** A casino chip with the person's initials: their color, edge spots, inlay. */
export function Avatar({ name, className, size = 36 }: { name: string; className?: string; size?: number }) {
  const hue = hueFor(name)
  const body = `hsl(${hue} 46% 34%)`
  const rim = `hsl(${hue} 50% 24%)`
  const inlay = `hsl(${hue} 30% 16%)`
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} className={cx('shrink-0', className)} aria-hidden="true">
      <circle cx="20" cy="20" r="19.5" fill={rim} />
      <circle cx="20" cy="20" r="18" fill={body} />
      {Array.from({ length: 6 }, (_, i) => (
        <rect key={i} x="17.4" y="2" width="5.2" height="5" rx="1.2" fill="#f3efe6" opacity="0.92" transform={`rotate(${i * 60} 20 20)`} />
      ))}
      <circle cx="20" cy="20" r="12.6" fill={inlay} />
      <circle cx="20" cy="20" r="12.6" fill="none" stroke="#f3efe6" strokeOpacity="0.28" strokeWidth="0.8" strokeDasharray="1.6 1.6" />
      <text
        x="20"
        y="20"
        dy="0.36em"
        textAnchor="middle"
        fontSize={initials(name).length > 1 ? 9.5 : 11}
        fontWeight="600"
        fill="#f3efe6"
        style={{ fontFamily: 'var(--font-sans)' }}
      >
        {initials(name) || '?'}
      </text>
    </svg>
  )
}

/** Fill = felt green, track = a darker step of the same hue. */
export function Meter({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div
      className={cx('h-1.5 overflow-hidden rounded-full bg-black/35', className)}
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div className="h-full rounded-full bg-brass transition-[width] duration-500" style={{ width: `${pct}%` }} />
    </div>
  )
}

export function LiveDot() {
  return (
    <span className="relative inline-flex size-2">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#5fd39a] opacity-50" />
      <span className="relative inline-flex size-2 rounded-full bg-[#5fd39a]" />
    </span>
  )
}

/** A small key–value pair used in hero tables and summaries. */
export function Figure({ label, value, className }: { label: ReactNode; value: ReactNode; className?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      <div className="truncate text-[12px] text-current opacity-60">{label}</div>
      <div className="mt-0.5 truncate text-[15px] font-semibold tnum">{value}</div>
    </div>
  )
}

// ---------------------------------------------------------------- Form fields

export const inputCls =
  'w-full h-11 rounded-[10px] border border-line bg-bg px-3 text-[15px] text-ink placeholder:text-faint outline-none transition-colors focus:border-brass/70 focus:bg-[#11110f]'

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-relaxed text-faint">{hint}</span>}
    </label>
  )
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />
}

export function AmountInput({
  value,
  onChange,
  autoFocus,
  placeholder = '0',
}: {
  value: string
  onChange: (v: string) => void
  autoFocus?: boolean
  placeholder?: string
}) {
  return (
    <div className="relative">
      <span className="font-display pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-3xl text-faint">
        {currencySymbol}
      </span>
      <input
        inputMode="decimal"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))}
        className={cx(inputCls, 'font-display h-16 pl-11 text-[40px] leading-none tnum')}
      />
    </div>
  )
}

/** Percent input: 0–100 with a % suffix. */
export function PercentInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <input
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, '').slice(0, 6))}
        className={cx(inputCls, 'pr-9 tnum')}
      />
      <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted">%</span>
    </div>
  )
}

export function Chip({
  active,
  children,
  onClick,
}: {
  active?: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'h-9 rounded-full border px-3.5 text-sm transition-colors tnum',
        active ? 'border-brass/70 bg-brass/12 text-brass' : 'border-line bg-surface-2 text-ink hover:border-[#3a3a33]',
      )}
    >
      {children}
    </button>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex rounded-[12px] border border-line bg-bg p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            'h-9 min-w-0 flex-1 truncate rounded-[9px] px-2 text-sm transition-colors',
            o.value === value ? 'bg-surface-2 font-medium text-ink shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Underlined tab strip (used inside pages). */
export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="no-scrollbar -mx-4 flex gap-5 overflow-x-auto border-b border-line px-4">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            'relative h-11 shrink-0 text-[14px] transition-colors',
            o.value === value ? 'font-semibold text-ink' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
          {o.value === value && <span className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-brass" />}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- Sheet (modal)

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" onClick={onClose} />
      <div className="animate-sheet relative flex max-h-[92dvh] w-full flex-col rounded-t-[22px] border border-line bg-surface shadow-[0_-20px_60px_rgba(0,0,0,0.5)] sm:max-w-md sm:rounded-[22px]">
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-line sm:hidden" />
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-3 sm:pt-5">
          <div className="min-w-0">
            <h3 className="font-display truncate text-[26px] leading-tight">{title}</h3>
            {subtitle && <div className="mt-0.5 text-sm text-muted">{subtitle}</div>}
          </div>
          <IconButton icon="x" label="Close" onClick={onClose} className="-mr-2" />
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer && <div className="pb-safe border-t border-line bg-[#121210] px-5 py-4 sm:rounded-b-[22px]">{footer}</div>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Toasts + confirm

interface ToastItem {
  id: number
  kind: 'ok' | 'error'
  text: string
}
interface ConfirmOpts {
  title: string
  message?: ReactNode
  confirmLabel?: string
  danger?: boolean
}
interface FeedbackApi {
  toast: (text: string, kind?: 'ok' | 'error') => void
  confirm: (o: ConfirmOpts) => Promise<boolean>
}

const FeedbackCtx = createContext<FeedbackApi | null>(null)

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [confirmState, setConfirmState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null)
  const seq = useRef(0)

  const toast = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    const id = ++seq.current
    setToasts((t) => [...t, { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 2500)
  }, [])

  const confirm = useCallback(
    (o: ConfirmOpts) => new Promise<boolean>((resolve) => setConfirmState({ ...o, resolve })),
    [],
  )

  const close = (v: boolean) => {
    confirmState?.resolve(v)
    setConfirmState(null)
  }

  return (
    <FeedbackCtx.Provider value={{ toast, confirm }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cx(
              'animate-toast pointer-events-auto flex max-w-md items-center gap-2.5 rounded-full border py-2 pl-3 pr-4 text-sm shadow-[0_10px_30px_rgba(0,0,0,0.5)]',
              t.kind === 'ok' ? 'border-line bg-[#1f1f1b] text-ink' : 'border-loss/40 bg-[#2a1513] text-[#ffd9d4]',
            )}
          >
            <span className={cx('inline-flex size-5 items-center justify-center rounded-full', t.kind === 'ok' ? 'bg-brass text-brass-ink' : 'bg-loss text-black')}>
              <Icon name={t.kind === 'ok' ? 'check' : 'alert'} className="size-3" />
            </span>
            {t.text}
          </div>
        ))}
      </div>
      <Sheet
        open={!!confirmState}
        onClose={() => close(false)}
        title={confirmState?.title ?? ''}
        footer={
          <div className="flex gap-3">
            <Button className="flex-1" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button className="flex-1" variant={confirmState?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
              {confirmState?.confirmLabel ?? 'Confirm'}
            </Button>
          </div>
        }
      >
        {confirmState?.message && <div className="text-sm leading-relaxed text-muted">{confirmState.message}</div>}
      </Sheet>
    </FeedbackCtx.Provider>
  )
}

export function useFeedback() {
  const ctx = useContext(FeedbackCtx)
  if (!ctx) throw new Error('useFeedback outside provider')
  return ctx
}

/** Wrap an async action: shows a spinner flag, toasts errors. */
export function useAction() {
  const { toast } = useFeedback()
  const [busy, setBusy] = useState(false)
  const run = useCallback(
    async (fn: () => Promise<unknown>, okMessage?: string): Promise<boolean> => {
      setBusy(true)
      try {
        await fn()
        if (okMessage) toast(okMessage)
        return true
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error')
        return false
      } finally {
        setBusy(false)
      }
    },
    [toast],
  )
  return { busy, run }
}
