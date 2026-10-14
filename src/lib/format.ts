const currency = (import.meta.env.VITE_CURRENCY as string | undefined) || 'USD'

const wholeFmt = new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 })
const centsFmt = new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Whole amounts without decimals ($1,500); anything with cents gets both digits ($218.50). */
function fmt(n: number): string {
  const c = Math.round(n * 100)
  return (c % 100 === 0 ? wholeFmt : centsFmt).format(c / 100)
}

/** $1,500 — no sign. */
export function money(n: number): string {
  return fmt(Math.abs(n) < 0.005 ? 0 : n).replace('-', '−')
}

const compactFmt = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency,
  notation: 'compact',
  maximumFractionDigits: 1,
})

/** $1.2K — for axis ticks. */
export function compactMoney(n: number): string {
  return compactFmt.format(n).replace('-', '−')
}

/** Oct 3 */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** +$500 / −$300 / $0 */
export function signedMoney(n: number): string {
  if (Math.abs(n) < 0.005) return fmt(0)
  return (n > 0 ? '+' : '−') + fmt(Math.abs(n))
}

export const currencySymbol = (() => {
  const part = wholeFmt.formatToParts(0).find((p) => p.type === 'currency')
  return part?.value ?? '$'
})()

/** Parse user input like "1,000" or "1000.50". Returns NaN when invalid. */
export function parseAmount(s: string): number {
  const cleaned = s.replace(/[,\s]/g, '').replace(currencySymbol, '')
  if (!/^\d*\.?\d{0,2}$/.test(cleaned) || cleaned === '' || cleaned === '.') return NaN
  return Math.round(Number(cleaned) * 100) / 100
}

export function formatDate(iso: string): string {
  // game_date is a plain date (YYYY-MM-DD); avoid timezone shifting.
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** 9:42:13 PM */
export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })
}

/** Mon, Oct 12, 2026 · 9:42:13 PM — the full stamp shown for every recorded action. */
export function formatStamp(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · ${formatClock(iso)}`
}

export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return formatDateTime(iso)
}

export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}
