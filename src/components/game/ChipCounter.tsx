import { useEffect, useState } from 'react'
import { compactMoney, money, parseAmount } from '../../lib/format'
import { cx, inputCls } from '../ui'

const STORAGE_KEY = 'poker-ledger:chip-values'
const DEFAULT_VALUES = [1, 5, 25, 100, 500, 1000]

// Classic casino colors by denomination; anything else falls back by position.
const CHIP_COLORS: Record<number, [string, string]> = {
  1: ['#e9e4d8', '#1d1d1b'],
  5: ['#b8312f', '#f3efe6'],
  25: ['#1f7a4d', '#f3efe6'],
  100: ['#1d1d1b', '#f3efe6'],
  500: ['#5b3a8c', '#f3efe6'],
  1000: ['#d6a432', '#1d1d1b'],
  5000: ['#c96a2b', '#f3efe6'],
}
const FALLBACK: [string, string][] = [
  ['#2b5d8a', '#f3efe6'],
  ['#7a2f5c', '#f3efe6'],
  ['#3d6b5e', '#f3efe6'],
]

function chipColors(v: number, i: number): [string, string] {
  return CHIP_COLORS[v] ?? FALLBACK[i % FALLBACK.length]
}

function MiniChip({ fill, spot, label }: { fill: string; spot: string; label: string }) {
  return (
    <svg viewBox="0 0 40 40" className="size-9 shrink-0" aria-hidden="true">
      <circle cx="20" cy="20" r="19" fill={fill} stroke="rgba(0,0,0,0.5)" strokeWidth="1" />
      {Array.from({ length: 6 }, (_, i) => (
        <rect key={i} x="17.2" y="1.5" width="5.6" height="5.5" rx="1.2" fill={spot} opacity="0.9" transform={`rotate(${i * 60} 20 20)`} />
      ))}
      <circle cx="20" cy="20" r="12.5" fill={fill} stroke={spot} strokeOpacity="0.45" strokeWidth="1" strokeDasharray="2 2" />
      <text x="20" y="20" dy="0.35em" textAnchor="middle" fontSize={label.length > 3 ? 7.5 : 9} fontWeight="700" fill={spot}>
        {label}
      </text>
    </svg>
  )
}

function loadValues(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as number[]) : null
    if (Array.isArray(parsed) && parsed.length && parsed.every((n) => typeof n === 'number' && n > 0)) return parsed
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_VALUES
}

function saveValues(v: number[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v))
  } catch {
    /* storage unavailable */
  }
}

/** Count a player's stack by chip denomination; reports the total. */
export function ChipCounter({ onTotal }: { onTotal: (total: number) => void }) {
  const [values, setValues] = useState(loadValues)
  const [counts, setCounts] = useState<Record<number, string>>({})
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(values.join(', '))

  const total = values.reduce((s, v) => s + Math.round(v * 100) * (parseInt(counts[v] || '0', 10) || 0), 0) / 100

  useEffect(() => {
    if (Object.values(counts).some((c) => c !== '')) onTotal(total)
  }, [total])

  const applyDraft = () => {
    const next = [...new Set(draft.split(/[,\s]+/).map(parseAmount).filter((n) => n > 0))].sort((a, b) => a - b)
    if (next.length) {
      setValues(next)
      saveValues(next)
      setCounts({})
    }
    setEditing(false)
  }

  return (
    <div className="rounded-[14px] border border-line bg-bg p-3">
      <div className="mb-2.5 flex items-center justify-between px-0.5">
        <span className="text-[13px] font-medium text-muted">Count the stack</span>
        <button type="button" className="text-xs text-muted underline underline-offset-2" onClick={() => setEditing((e) => !e)}>
          {editing ? 'Cancel' : 'Chip values'}
        </button>
      </div>

      {editing ? (
        <div className="flex gap-2">
          <input className={cx(inputCls, 'h-10 text-base sm:text-sm')} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button type="button" className="rounded-[10px] bg-surface-2 px-3 text-sm" onClick={applyDraft}>
            Save
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {values.map((v, i) => {
            const [fill, spot] = chipColors(v, i)
            return (
              <label key={v} className="flex items-center gap-2 rounded-[12px] border border-line bg-surface py-1.5 pl-1.5 pr-2">
                <MiniChip fill={fill} spot={spot} label={compactMoney(v).replace(/^\D+/, '')} />
                <span className="text-faint">×</span>
                <input
                  inputMode="numeric"
                  placeholder="0"
                  aria-label={`Number of ${money(v)} chips`}
                  value={counts[v] ?? ''}
                  onChange={(e) => setCounts((c) => ({ ...c, [v]: e.target.value.replace(/\D/g, '').slice(0, 5) }))}
                  className="h-8 w-full min-w-0 rounded-lg bg-bg px-2 text-right text-[16px] tnum outline-none focus:ring-1 focus:ring-brass/70"
                />
              </label>
            )
          })}
        </div>
      )}
      <div className="mt-2.5 flex items-center justify-between border-t border-line px-1 pt-2.5 text-sm">
        <span className="text-muted">Stack</span>
        <span className="font-display text-2xl leading-none tnum">{money(total)}</span>
      </div>
    </div>
  )
}
