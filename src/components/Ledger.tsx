import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { formatClock, formatStamp, money } from '../lib/format'
import { ledgerCsv, withBalances } from '../lib/ledger'
import type { LedgerEntry, LedgerRow } from '../lib/ledger'
import { Icon } from './Icon'
import { Button, Card, Empty, Loading, Sheet, cx, useFeedback } from './ui'

type Filter = 'all' | 'owedToThem' | 'theyOwe' | 'ourPayment' | 'theirPayment'

// The four columns of every person's account.
const COLS: { key: Exclude<Filter, 'all'>; label: string; dot: string; text: string }[] = [
  { key: 'owedToThem', label: 'Owed to them', dot: 'bg-brass', text: 'text-brass' },
  { key: 'theyOwe', label: 'They owe', dot: 'bg-loss', text: 'text-loss' },
  { key: 'ourPayment', label: 'Our payments', dot: 'bg-[#8fb0d6]', text: 'text-[#a9c4e4]' },
  { key: 'theirPayment', label: 'Their payments', dot: 'bg-win', text: 'text-win' },
]

function balancePhrase(b: number, name: string) {
  if (b > 0.004) return { text: `We owe ${name}`, short: `we owe ${money(b)}`, tone: 'text-brass' }
  if (b < -0.004) return { text: `${name} owes us`, short: `owes ${money(-b)}`, tone: 'text-loss' }
  return { text: 'All square', short: 'square', tone: 'text-muted' }
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const y = new Date()
  y.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function Amounts({ row, compact }: { row: LedgerEntry; compact?: boolean }) {
  return (
    <>
      {COLS.filter((col) => row[col.key] > 0).map((col) => (
        <div key={col.key} className={cx('flex items-center justify-end gap-1.5 whitespace-nowrap', compact ? 'text-[13px]' : 'text-sm')}>
          <span className="text-[11px] text-faint">{col.label.replace(/s$/, '')}</span>
          <span className={cx('font-semibold tnum', col.text)}>{money(row[col.key])}</span>
        </div>
      ))}
    </>
  )
}

/** Full detail of one ledger entry: amounts, exact times, who recorded and edited it. */
function EntrySheet({
  row,
  name,
  onClose,
  onDelete,
}: {
  row: LedgerRow
  name: string
  onClose: () => void
  onDelete?: (row: LedgerRow) => Promise<boolean>
}) {
  const { confirm } = useFeedback()
  const bal = balancePhrase(row.balance, name)
  const Line = ({ label, children }: { label: string; children: ReactNode }) => (
    <div className="flex items-start justify-between gap-4 py-2.5 text-sm">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  )
  return (
    <Sheet open onClose={onClose} title={row.title} subtitle={formatStamp(row.at)}>
      <div className="divide-y divide-line rounded-[12px] border border-line bg-bg px-4">
        {COLS.map((col) => (
          <Line key={col.key} label={col.label}>
            <span className={cx('tnum', row[col.key] > 0 ? cx('font-semibold', col.text) : 'text-faint')}>
              {row[col.key] > 0 ? money(row[col.key]) : '—'}
            </span>
          </Line>
        ))}
        <Line label="Balance after">
          <span className={cx('font-semibold', bal.tone)}>{bal.short}</span>
        </Line>
      </div>
      <div className="mt-4 divide-y divide-line">
        {row.details.map((d) => (
          <p key={d} className="py-2 text-sm">
            {d}
          </p>
        ))}
        <Line label="Recorded">
          <span className="tnum">{formatStamp(row.stamp?.createdAt ?? row.at)}</span>
          {row.stamp?.createdBy && <span className="block text-xs text-muted">by {row.stamp.createdBy}</span>}
        </Line>
        {(row.stamp?.editedAt || row.editedAt) && (
          <Line label="Last edited">
            <span className="tnum">{formatStamp((row.stamp?.editedAt ?? row.editedAt)!)}</span>
            {row.stamp?.editedBy && (
              <span className="block text-xs text-muted">
                by {row.stamp.editedBy}
                {row.stamp.edits > 1 && ` · ${row.stamp.edits} edits`}
              </span>
            )}
          </Line>
        )}
        <Line label="Reference">
          <span className="font-mono text-[11px] text-faint">{row.id}</span>
        </Line>
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        {row.gameId && (
          <Link to={`/games/${row.gameId}`} className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line px-4 text-sm hover:bg-surface-2">
            Open game <Icon name="next" className="size-4" />
          </Link>
        )}
        {onDelete && (row.source === 'player_payment' || row.source === 'partner_entry' || row.source === 'dealer_payment') && (
          <Button
            variant="danger"
            icon="trash"
            onClick={async () => {
              if (await confirm({ title: 'Delete this payment?', message: 'The history log keeps a record of it.', confirmLabel: 'Delete', danger: true }))
                if (await onDelete(row)) onClose()
            }}
          >
            Delete
          </Button>
        )}
      </div>
      {row.source === 'transaction' && (
        <p className="mt-4 text-xs text-faint">Buy-ins and cash-outs are corrected from the game they belong to.</p>
      )}
      {row.source === 'dealer_round' && <p className="mt-4 text-xs text-faint">Rounds are corrected from the game they belong to.</p>}
    </Sheet>
  )
}

export function Ledger({
  name,
  entries,
  actions,
  exportName,
  onDelete,
  emptyText,
}: {
  name: string
  entries: LedgerEntry[] | undefined
  actions?: ReactNode
  exportName: string
  onDelete?: (row: LedgerRow) => Promise<boolean>
  emptyText?: string
}) {
  const { toast } = useFeedback()
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<LedgerRow | null>(null)
  const ledger = useMemo(() => (entries ? withBalances(entries) : null), [entries])

  if (!ledger) return <Loading />
  const { rows, totals } = ledger
  const bal = balancePhrase(totals.balance, name)
  const shown = filter === 'all' ? rows : rows.filter((r) => r[filter] > 0)

  const groups: { label: string; rows: LedgerRow[] }[] = []
  for (const r of shown) {
    const label = dayLabel(r.at)
    const g = groups.at(-1)
    if (g?.label === label) g.rows.push(r)
    else groups.push({ label, rows: [r] })
  }

  const exportCsv = () => {
    download(`${exportName}-ledger-${new Date().toISOString().slice(0, 10)}.csv`, ledgerCsv(rows))
    toast('Statement downloaded')
  }

  return (
    <>
      <Card className="overflow-hidden">
        <div className="border-b border-line bg-[linear-gradient(180deg,#1b1a15,#151512)] px-5 pb-4 pt-5">
          <div className="text-[13px] text-muted">{bal.text}</div>
          <div className={cx('font-display text-[52px] leading-none tracking-tight', bal.tone === 'text-muted' ? '' : bal.tone)}>
            {money(Math.abs(totals.balance))}
          </div>
          <div className="mt-1.5 text-xs text-faint">
            {rows.length} entr{rows.length === 1 ? 'y' : 'ies'}
            {rows.length > 0 && ` · last ${formatStamp(rows[0].at)}`}
          </div>
        </div>
        <div className="grid grid-cols-2 divide-x divide-y divide-line">
          {COLS.map((col) => {
            const total = col.key === 'owedToThem' ? totals.owedToThem : col.key === 'theyOwe' ? totals.theyOwe : col.key === 'ourPayment' ? totals.ourPayments : totals.theirPayments
            return (
              <button
                key={col.key}
                type="button"
                onClick={() => setFilter((f) => (f === col.key ? 'all' : col.key))}
                className={cx('px-4 py-3 text-left transition-colors', filter === col.key ? 'bg-surface-2' : 'hover:bg-surface-2/50')}
              >
                <span className="flex items-center gap-1.5 text-[12px] text-muted">
                  <span className={cx('size-1.5 rounded-full', col.dot)} />
                  {col.label}
                </span>
                <span className="mt-0.5 block text-[17px] font-semibold tnum">{money(total)}</span>
              </button>
            )
          })}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-xs text-faint">
          <span className="tnum">
            {money(totals.owedToThem)} − {money(totals.theyOwe)} + {money(totals.theirPayments)} − {money(totals.ourPayments)} ={' '}
            <span className={bal.tone}>{totals.balance >= 0 ? '+' : '−'}{money(Math.abs(totals.balance))}</span>
          </span>
        </div>
        {(actions || rows.length > 0) && (
          <div className="flex flex-wrap gap-2 border-t border-line bg-[#121210] px-4 py-3">
            {actions}
            {rows.length > 0 && (
              <Button size="sm" icon="arrowDown" onClick={exportCsv}>
                Export CSV
              </Button>
            )}
          </div>
        )}
      </Card>

      {filter !== 'all' && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted">
            Showing <span className="text-ink">{COLS.find((c) => c.key === filter)?.label.toLowerCase()}</span> only
          </span>
          <button type="button" className="text-brass underline-offset-2 hover:underline" onClick={() => setFilter('all')}>
            Show all
          </button>
        </div>
      )}

      <div className="mt-5">
        {shown.length === 0 ? (
          <Card>
            <Empty icon="wallet" title="No entries">
              {emptyText}
            </Empty>
          </Card>
        ) : (
          groups.map((g) => (
            <section key={g.label} className="mb-5">
              <h3 className="font-display mb-2 px-0.5 text-[20px]">{g.label}</h3>
              <Card className="divide-y divide-line overflow-hidden">
                {g.rows.map((r) => {
                  const b = balancePhrase(r.balance, name)
                  return (
                    <button
                      key={`${r.source}-${r.id}`}
                      type="button"
                      onClick={() => setOpen(r)}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2/60"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] text-faint tnum">
                          {formatClock(r.at)}
                          {r.stamp?.createdBy && ` · ${r.stamp.createdBy}`}
                          {(r.stamp?.editedAt || r.editedAt) && ' · edited'}
                        </div>
                        <div className="mt-0.5 text-[14px] font-medium leading-snug">{r.title}</div>
                        {r.details.length > 0 && <div className="mt-0.5 text-[12.5px] leading-snug text-muted">{r.details.join(' · ')}</div>}
                      </div>
                      <div className="shrink-0 pt-3 text-right">
                        <Amounts row={r} compact />
                        <div className={cx('mt-1 text-[11px]', b.tone === 'text-muted' ? 'text-faint' : b.tone)}>{b.short}</div>
                      </div>
                    </button>
                  )
                })}
              </Card>
            </section>
          ))
        )}
      </div>

      {open && <EntrySheet row={open} name={name} onClose={() => setOpen(null)} onDelete={onDelete} />}
    </>
  )
}
