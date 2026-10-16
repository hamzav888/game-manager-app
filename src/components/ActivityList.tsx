import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth'
import { listAudit } from '../lib/api'
import { describeAudit } from '../lib/audit'
import { formatStamp, timeAgo } from '../lib/format'
import { useLoader, useRealtime } from '../lib/hooks'
import type { AuditEntry, AuditFilter, NameBook, Player } from '../lib/types'
import { Button, Card, Empty, ErrorBox, Loading, cx } from './ui'

const PAGE = 50

const TONE = {
  add: 'border-felt bg-felt',
  edit: 'border-brass bg-brass',
  delete: 'border-loss bg-loss',
}

/** Group label for a timestamp: Today, Yesterday, or the date. */
function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const y = new Date()
  y.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

const ACCOUNT_TABLES = new Set(['profiles', 'passwords', 'sign_ins', 'app_admins'])

export function ActivityList({
  filter,
  playersById,
  gameNames,
  partnerNames,
  dealerNames,
  book,
  live,
}: {
  filter: Omit<AuditFilter, 'beforeId' | 'limit'>
  playersById: Map<string, Player>
  gameNames?: Map<string, string>
  partnerNames?: Map<string, string>
  dealerNames?: Map<string, string>
  /** owner's all-organizations view: names for everything, plus the organization of each entry */
  book?: NameBook
  live?: boolean
}) {
  const { actorName: memberActor, memberName: teamName } = useAuth()
  // Older pages loaded via "Load older"; `null` = not loaded yet.
  const [older, setOlder] = useState<{ rows: AuditEntry[]; more: boolean } | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const key = JSON.stringify(filter)

  useEffect(() => setOlder(null), [key])
  const first = useLoader(() => listAudit({ ...filter, limit: PAGE }), [key])
  useRealtime(live ? ['audit_log'] : [], first.reload)

  const entries = useMemo(() => {
    const seen = new Set<number>()
    return [...(first.data ?? []), ...(older?.rows ?? [])].filter((e) => !seen.has(e.id) && !!seen.add(e.id))
  }, [first.data, older])
  const more = older ? older.more : (first.data?.length ?? 0) === PAGE

  const loadMore = useCallback(async () => {
    const last = entries.at(-1)
    if (!last) return
    setLoadingMore(true)
    try {
      const rows = await listAudit({ ...filter, beforeId: last.id, limit: PAGE })
      setOlder((o) => ({ rows: [...(o?.rows ?? []), ...rows], more: rows.length === PAGE }))
    } finally {
      setLoadingMore(false)
    }
  }, [entries, key])

  const ctx = useMemo(() => {
    const look = (m?: Map<string, string>) => (id: string | null | undefined) => (id ? (m?.get(id) ?? null) : null)
    return {
      playerName: (id: string | null | undefined) => (id ? (playersById.get(id)?.name ?? book?.player.get(id) ?? null) : null),
      gameName: gameNames || book ? (id: string | null | undefined) => (id ? (gameNames?.get(id) ?? book?.game.get(id) ?? null) : null) : undefined,
      partnerName: (id: string | null | undefined) => (id ? (partnerNames?.get(id) ?? book?.partner.get(id) ?? null) : null),
      dealerName: (id: string | null | undefined) => (id ? (dealerNames?.get(id) ?? book?.dealer.get(id) ?? null) : null),
      orgName: book ? look(book.org) : undefined,
      memberName: (id: string | null | undefined) => teamName(id) ?? (id ? (book?.account.get(id) ?? null) : null),
      actorName: memberActor,
    }
  }, [playersById, gameNames, partnerNames, dealerNames, book, memberActor, teamName])
  const actorOf = (e: AuditEntry) => (e.actor_id && book?.account.get(e.actor_id)) || ctx.actorName(e.actor_email)

  if (first.error) return <ErrorBox error={first.error} onRetry={first.reload} />
  if (!first.data) return <Loading />
  if (entries.length === 0)
    return (
      <Card>
        <Empty icon="history" title="Nothing yet">
          Every buy-in, cash-out, payment, edit and delete shows up here with who did it.
        </Empty>
      </Card>
    )

  const groups: { label: string; rows: AuditEntry[] }[] = []
  for (const e of entries) {
    const label = dayLabel(e.occurred_at)
    const g = groups.at(-1)
    if (g?.label === label) g.rows.push(e)
    else groups.push({ label, rows: [e] })
  }

  return (
    <>
      {groups.map((g) => (
        <section key={g.label} className="mb-5">
          <h3 className="font-display mb-2 px-0.5 text-[20px]">{g.label}</h3>
          <Card className="px-4 py-1">
            <ol>
              {g.rows.map((e, i) => {
                const d = describeAudit(e, ctx)
                const gameLink = gameNames && e.game_id && e.table_name !== 'games' && gameNames.has(e.game_id)
                const account = ACCOUNT_TABLES.has(e.table_name)
                return (
                  <li key={e.id} className="relative flex gap-3.5 py-3">
                    {/* timeline */}
                    <span className="relative flex w-2.5 shrink-0 justify-center">
                      {i < g.rows.length - 1 && <span className="absolute bottom-[-14px] top-5 w-px bg-line" />}
                      <span className={cx('mt-1.5 size-2.5 rounded-full border-2', TONE[d.tone])} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 text-[11.5px] text-faint tnum">
                        <time dateTime={e.occurred_at} className="text-muted">
                          {formatStamp(e.occurred_at)}
                        </time>
                        <span>· {timeAgo(e.occurred_at)}</span>
                      </div>
                      <p className="mt-0.5 text-[14px] leading-snug">{d.summary}</p>
                      {d.changes.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5 border-l-2 border-brass/40 pl-2.5 text-xs text-muted">
                          {d.changes.map((c) => (
                            <li key={c} className="tnum">
                              {c}
                            </li>
                          ))}
                        </ul>
                      )}
                      {d.details.length > 0 && (
                        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-[8px] bg-bg/60 px-2.5 py-1.5 text-xs">
                          {d.details.map((x) => (
                            <div key={x.label} className="contents">
                              <dt className="text-faint">{x.label}</dt>
                              <dd className="min-w-0 truncate text-muted tnum">{x.value}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      <p className="mt-1.5 text-xs text-faint">
                        {e.table_name === 'sign_ins' ? 'Account' : account ? 'Done by' : e.action === 'INSERT' ? 'Recorded by' : e.action === 'UPDATE' ? 'Changed by' : 'Deleted by'}{' '}
                        <span className="text-muted">{e.actor_id || e.actor_email ? actorOf(e) : d.actor}</span>
                        {gameLink && (
                          <>
                            {' · '}
                            <Link to={`/games/${e.game_id}`} className="underline underline-offset-2 hover:text-ink">
                              open game
                            </Link>
                          </>
                        )}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ol>
          </Card>
        </section>
      ))}
      {more && (
        <Button className="w-full" loading={loadingMore} onClick={loadMore}>
          Load older
        </Button>
      )}
    </>
  )
}
