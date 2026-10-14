import { useLayoutEffect, useRef, useState } from 'react'
import { compactMoney, signedMoney } from '../lib/format'
import { cx } from './ui'

// Win/loss marks use colors validated for colorblind separation on the dark
// surface (see --color-win-mark / --color-loss-mark). Polarity is also carried
// by position (above/below or left/right of the zero line) and by the +/− sign.
const WIN = 'var(--color-win-mark)'
const LOSS = 'var(--color-loss-mark)'

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.getBoundingClientRect().width)
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

function niceStep(range: number, count: number): number {
  const raw = range / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const n = raw / mag
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag
}

/** A column with a 4px rounded data-end and a square foot on the baseline. */
function columnPath(x: number, w: number, yBase: number, yEnd: number): string {
  const h = Math.abs(yEnd - yBase)
  if (h < 0.5) return ''
  const r = Math.min(4, h, w / 2)
  return yEnd < yBase
    ? `M${x},${yBase}V${yEnd + r}A${r},${r} 0 0 1 ${x + r},${yEnd}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${yEnd + r}V${yBase}Z`
    : `M${x},${yBase}V${yEnd - r}A${r},${r} 0 0 0 ${x + r},${yEnd}H${x + w - r}A${r},${r} 0 0 0 ${x + w},${yEnd - r}V${yBase}Z`
}

export function WinLossLegend({ win = 'Won', loss = 'Lost' }: { win?: string; loss?: string }) {
  return (
    <div className="flex items-center gap-3 text-xs text-muted">
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2 rounded-full" style={{ background: WIN }} />
        {win}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2 rounded-full" style={{ background: LOSS }} />
        {loss}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------- columns

export interface ColumnDatum {
  key: string
  /** x-axis label, e.g. "Oct 3" */
  label: string
  /** tooltip title, e.g. the game name */
  title: string
  value: number
  onOpen?: () => void
}

/**
 * Diverging columns over time: up = profit/win, down = loss.
 * Hover (or tap) a column for its value; the extremes are labeled directly.
 */
export function DivergingColumns({ data, height = 190, label }: { data: ColumnDatum[]; height?: number; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const pointerType = useRef('mouse')

  const padL = 46
  const padR = 6
  const padT = 22
  const padB = 26
  const values = data.map((d) => d.value)
  let lo = Math.min(0, ...values)
  let hi = Math.max(0, ...values)
  if (lo === hi) hi = 1
  const step = niceStep(hi - lo, 3)
  lo = Math.floor(lo / step) * step
  hi = Math.ceil(hi / step) * step
  const ticks: number[] = []
  for (let v = lo; v <= hi + step / 1000; v += step) ticks.push(Math.round(v * 100) / 100)

  const plotW = Math.max(0, width - padL - padR)
  const plotH = height - padT - padB
  const y = (v: number) => padT + ((hi - v) / (hi - lo)) * plotH
  const band = data.length ? plotW / data.length : 0
  const barW = Math.max(3, Math.min(24, band * 0.62))
  const xOf = (i: number) => padL + band * i + (band - barW) / 2

  const maxI = values.indexOf(Math.max(...values))
  const minI = values.indexOf(Math.min(...values))
  const labelEvery = Math.max(1, Math.ceil(46 / Math.max(band, 1)))

  const a = active !== null ? data[active] : null
  const tipX = active !== null ? Math.min(Math.max(padL + band * active + band / 2, 70), width - 70) : 0
  const tipY = a ? Math.min(y(a.value), y(0)) - 10 : 0

  return (
    <div ref={ref} className="relative select-none" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label} className="overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#45443c' : '#232320'} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={padL - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-faint text-[10px] tnum">
                {compactMoney(t)}
              </text>
            </g>
          ))}

          {data.map((d, i) => {
            const show = i === data.length - 1 || (data.length - 1 - i) % labelEvery === 0
            return (
              show && (
                <text key={d.key} x={padL + band * i + band / 2} y={height - 6} textAnchor="middle" className="fill-faint text-[10px]">
                  {d.label}
                </text>
              )
            )
          })}

          {data.map((d, i) => (
            <path
              key={d.key}
              d={columnPath(xOf(i), barW, y(0), y(d.value))}
              fill={d.value >= 0 ? WIN : LOSS}
              opacity={active === null || active === i ? 1 : 0.4}
              style={{ transition: 'opacity 120ms' }}
            />
          ))}

          {/* Direct labels on the extremes only. */}
          {values[maxI] > 0 && (
            <text x={xOf(maxI) + barW / 2} y={y(values[maxI]) - 7} textAnchor="middle" className="fill-ink text-[11px] font-semibold">
              {signedMoney(values[maxI])}
            </text>
          )}
          {values[minI] < 0 && y(values[minI]) + 15 < height - padB + 4 && (
            <text x={xOf(minI) + barW / 2} y={y(values[minI]) + 15} textAnchor="middle" className="fill-ink text-[11px] font-semibold">
              {signedMoney(values[minI])}
            </text>
          )}

          {/* Hit targets: the whole band, not just the painted bar. */}
          {data.map((d, i) => (
            <rect
              key={d.key}
              x={padL + band * i}
              y={padT}
              width={band}
              height={plotH}
              fill="transparent"
              tabIndex={0}
              aria-label={`${d.title}: ${signedMoney(d.value)}`}
              className={cx('outline-none', d.onOpen && 'cursor-pointer')}
              onPointerDown={(e) => (pointerType.current = e.pointerType)}
              onPointerEnter={(e) => e.pointerType === 'mouse' && setActive(i)}
              onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              onClick={() => {
                // On touch, the first tap shows the value; a second tap opens it.
                if (pointerType.current !== 'mouse' && active !== i) return setActive(i)
                d.onOpen?.()
              }}
              onKeyDown={(e) => e.key === 'Enter' && d.onOpen?.()}
            />
          ))}
        </svg>
      )}

      {a && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-[10px] border border-line bg-[#20201c] px-3 py-2 text-center shadow-[0_10px_30px_rgba(0,0,0,0.5)]"
          style={{ left: tipX, top: tipY }}
        >
          <div className={cx('font-display text-[22px] leading-tight', a.value > 0 ? 'text-win' : a.value < 0 ? 'text-loss' : 'text-muted')}>
            {signedMoney(a.value)}
          </div>
          <div className="whitespace-nowrap text-xs text-muted">{a.title}</div>
          {a.onOpen && pointerType.current !== 'mouse' && <div className="mt-0.5 text-[10px] text-faint">Tap again to open</div>}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- horizontal result bars

export interface ResultRow {
  key: string
  name: string
  value: number
  hint?: string
  onOpen?: () => void
}

/** Who won, who lost: one row per player, bars grow left (loss) or right (win) from zero. */
export function ResultBars({ rows }: { rows: ResultRow[] }) {
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.value)))
  return (
    <ul className="space-y-0.5">
      {rows.map((r) => {
        const pct = (Math.abs(r.value) / maxAbs) * 100
        const Row = r.onOpen ? 'button' : 'div'
        return (
          <li key={r.key}>
            <Row
              {...(r.onOpen ? { type: 'button' as const, onClick: r.onOpen } : {})}
              title={r.hint}
              className="group grid h-10 w-full grid-cols-[minmax(0,6rem)_1fr_4.75rem] items-center gap-3 rounded-lg px-1 text-left hover:bg-surface-2/60"
            >
              <span className="truncate text-[14px]">{r.name}</span>
              <span className="relative grid h-full grid-cols-2">
                <span className="relative">
                  {r.value < 0 && (
                    <span
                      className="absolute right-0 top-1/2 h-3.5 -translate-y-1/2 rounded-l-[4px] transition-[width] duration-500"
                      style={{ width: `${pct}%`, background: LOSS }}
                    />
                  )}
                </span>
                <span className="relative border-l border-[#45443c]">
                  {r.value > 0 && (
                    <span
                      className="absolute left-0 top-1/2 h-3.5 -translate-y-1/2 rounded-r-[4px] transition-[width] duration-500"
                      style={{ width: `${pct}%`, background: WIN }}
                    />
                  )}
                </span>
              </span>
              <span
                className={cx(
                  'text-right text-sm font-semibold tnum',
                  r.value > 0.004 ? 'text-win' : r.value < -0.004 ? 'text-loss' : 'text-muted',
                )}
              >
                {signedMoney(r.value)}
              </span>
            </Row>
          </li>
        )
      })}
    </ul>
  )
}
