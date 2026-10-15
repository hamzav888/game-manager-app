import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { DivergingColumns, WinLossLegend } from '../components/charts'
import { Icon } from '../components/Icon'
import {
  Button,
  Card,
  Empty,
  ErrorBox,
  Field,
  Figure,
  LiveDot,
  Loading,
  Money,
  PageHeader,
  SectionTitle,
  Segmented,
  Sheet,
  TextInput,
  cx,
  useAction,
} from '../components/ui'
import { createGame, listGameTotals } from '../lib/api'
import { shortDate, signedMoney, timeAgo, todayISO } from '../lib/format'
import { useLoader, useRealtime } from '../lib/hooks'
import type { GameTotals } from '../lib/types'

const weekdayOf = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long' })
}

function daysBefore(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d - n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function NewGameSheet({ openToday, onClose }: { openToday: number; onClose: () => void }) {
  const navigate = useNavigate()
  const { busy, run } = useAction()
  const today = todayISO()
  const [when, setWhen] = useState<'now' | 'past'>('now')
  const [date, setDate] = useState(today)
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)

  const gameDate = when === 'now' ? today : date
  const suggested =
    when === 'now' && openToday > 0 ? `${weekdayOf(today)} game · table ${openToday + 1}` : `${weekdayOf(gameDate || today)} game`
  const finalName = nameTouched ? name : suggested
  const pastOk = when === 'now' || (!!date && date < today)

  const submit = () =>
    run(async () => {
      const g = await createGame({ name: finalName.trim(), game_date: gameDate })
      navigate(`/games/${g.id}`)
    }, when === 'now' ? 'Game started' : 'Past game opened — enter that night, then end it')

  return (
    <Sheet
      open
      onClose={onClose}
      title={when === 'now' ? 'Open a table' : 'Record a past game'}
      subtitle={
        when === 'now'
          ? openToday > 0
            ? `${openToday === 1 ? 'Another table is' : `${openToday} tables are`} already running — this one runs alongside.`
            : 'Tip tax and loss discount come from your organization’s house rules.'
          : 'For a night that wasn’t recorded live.'
      }
      footer={
        <Button variant="primary" size="lg" className="w-full" loading={busy} disabled={!finalName.trim() || !pastOk} onClick={submit}>
          {when === 'now' ? 'Start game' : 'Open past game'}
        </Button>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (finalName.trim() && pastOk) void submit()
        }}
      >
        <Segmented
          value={when}
          onChange={(w) => {
            setWhen(w)
            if (w === 'past' && date >= today) setDate(daysBefore(today, 1))
          }}
          options={[
            { value: 'now', label: 'Running now' },
            { value: 'past', label: 'A past game' },
          ]}
        />
        <Field label="Name">
          <TextInput
            value={finalName}
            onChange={(e) => {
              setNameTouched(true)
              setName(e.target.value)
            }}
            maxLength={80}
            autoFocus
          />
        </Field>
        {when === 'past' && (
          <>
            <Field label="Date it was played">
              <TextInput type="date" value={date} max={daysBefore(today, 1)} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <p className="rounded-[12px] border border-line bg-bg px-3.5 py-3 text-[13px] leading-relaxed text-muted">
              Enter the buy-ins, cash-outs, dealer rounds and expenses from that night, then tap <span className="text-ink">End game</span>.
              It’s filed under its date; every entry still gets today’s time stamp in the history.
            </p>
          </>
        )}
      </form>
    </Sheet>
  )
}

const sumOf = (xs: GameTotals[], k: keyof GameTotals) => xs.reduce((s, g) => s + Math.round(Number(g[k]) * 100), 0) / 100
const feltTone = (n: number) => (n > 0.004 ? 'text-win-felt' : n < -0.004 ? 'text-loss-felt' : 'text-felt-ink')
/** Rake + tip tax − loss discounts − expenses: what a running game has made so far. */
const profitSoFar = (g: GameTotals) =>
  (Math.round(g.total_rake * 100) + Math.round(g.tip_tax * 100) - Math.round(g.total_discounts * 100) - Math.round(g.total_expenses * 100)) / 100

function LiveGameCard({ g }: { g: GameTotals }) {
  const today = todayISO()
  const stale = g.game_date < today
  const rake = g.total_rake > 0
  return (
    <Link
      to={`/games/${g.id}`}
      className={cx(
        'group block rounded-[14px] border p-4 transition-colors',
        stale ? 'border-warn/30 bg-surface hover:border-warn/50' : 'border-felt/70 bg-[linear-gradient(180deg,#14241d,#121a16)] hover:border-felt',
      )}
    >
      <div className={cx('flex items-center gap-2 text-[13px] font-medium', stale ? 'text-warn' : 'text-felt-ink')}>
        {stale ? (
          <>
            <Icon name="alert" className="size-3.5" /> Not ended yet
          </>
        ) : (
          <>
            <LiveDot /> Live now
          </>
        )}
        <span className="ml-auto text-xs font-normal opacity-60">{shortDate(g.game_date)}</span>
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="font-display truncate text-[28px] leading-tight">{g.name}</div>
          <div className="truncate text-sm text-muted">
            {g.seated_count ? `${g.seated_count} playing` : g.player_count ? 'everyone cashed out' : 'no players yet'} ·{' '}
            <Money value={g.total_buy_ins} /> in
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xs text-muted">{rake ? 'Profit so far' : 'Bank'}</div>
          {rake ? (
            <Money value={profitSoFar(g)} signed colored className="font-display text-[28px] leading-tight" />
          ) : (
            <Money value={g.house_take - g.total_discounts} className="font-display text-[28px] leading-tight" />
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3 border-t border-white/[0.06] pt-3 text-[13px]">
        <span className="text-muted">
          Rake <Money value={g.total_rake} className="text-brass" />
          {g.last_round_at && <span className="text-faint"> · last round {timeAgo(g.last_round_at)}</span>}
        </span>
        <span className={cx('ml-auto inline-flex items-center gap-1 font-medium', stale ? 'text-warn' : 'text-felt-ink')}>
          {stale ? 'Finish & end it' : 'Go to the table'}
          <Icon name="next" className="size-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  )
}

function GameRow({ g }: { g: GameTotals }) {
  const [y, m, d] = g.game_date.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return (
    <Link to={`/games/${g.id}`} className="group flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-surface-2/60">
      <div className="w-10 shrink-0 text-center leading-none">
        <div className="font-display text-[26px]">{d}</div>
        <div className="mt-0.5 text-[11px] text-faint">{date.toLocaleDateString(undefined, { weekday: 'short' })}</div>
      </div>
      <div className="min-w-0 flex-1 border-l border-line pl-4">
        <div className="truncate font-medium">{g.name}</div>
        <div className="truncate text-[13px] text-muted">
          {g.player_count} players · <Money value={g.total_buy_ins} /> in
        </div>
      </div>
      <div className="shrink-0 text-right">
        <Money value={g.net_profit} signed colored className="block text-[15px] font-semibold" />
        {g.total_rake > 0 && (
          <span className="text-[11px] text-faint">
            rake <Money value={g.total_rake} />
          </span>
        )}
      </div>
    </Link>
  )
}

const PAGE = 24

export function GamesPage() {
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(PAGE)
  const { data, error, reload } = useLoader(listGameTotals, [])
  useRealtime(['games', 'transactions', 'dealer_tips', 'expenses'], reload)

  const open = (data ?? []).filter((g) => g.status === 'open')
  const closed = (data ?? []).filter((g) => g.status === 'closed')
  const today = todayISO()

  const stats = useMemo(() => {
    const month = todayISO().slice(0, 7)
    const thisMonth = closed.filter((g) => g.game_date.startsWith(month))
    const best = closed.reduce<GameTotals | null>((b, g) => (!b || g.net_profit > b.net_profit ? g : b), null)
    return {
      month: sumOf(thisMonth, 'net_profit'),
      monthGames: thisMonth.length,
      monthRake: sumOf(thisMonth, 'total_rake'),
      monthDiscounts: sumOf(thisMonth, 'total_discounts'),
      allTime: sumOf(closed, 'net_profit'),
      avg: closed.length ? Math.round(sumOf(closed, 'net_profit') / closed.length) : 0,
      best,
    }
  }, [closed])

  const chart = useMemo(
    () =>
      [...closed]
        .slice(0, 12)
        .reverse()
        .map((g) => ({
          key: g.id,
          label: shortDate(g.game_date),
          title: `${g.name} · ${shortDate(g.game_date)}`,
          value: g.net_profit,
          onOpen: () => navigate(`/games/${g.id}`),
        })),
    [closed, navigate],
  )

  const months = useMemo(() => {
    const term = q.trim().toLowerCase()
    const list = closed.filter((g) => !term || g.name.toLowerCase().includes(term) || shortDate(g.game_date).toLowerCase().includes(term))
    const groups: { key: string; label: string; games: GameTotals[]; profit: number }[] = []
    for (const g of list.slice(0, shown)) {
      const key = g.game_date.slice(0, 7)
      let grp = groups.at(-1)
      if (!grp || grp.key !== key) {
        const [y, m] = key.split('-').map(Number)
        grp = {
          key,
          label: new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
          games: [],
          profit: 0,
        }
        groups.push(grp)
      }
      grp.games.push(g)
    }
    for (const grp of groups) grp.profit = sumOf(list.filter((g) => g.game_date.startsWith(grp.key)), 'net_profit')
    return { groups, total: list.length }
  }, [closed, q, shown])

  const monthName = new Date().toLocaleDateString(undefined, { month: 'long' })
  const todayLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <>
      <PageHeader
        title="Games"
        sub={todayLabel}
        action={
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            New game
          </Button>
        }
      />

      {error ? (
        <div className="mt-5">
          <ErrorBox error={error} onRetry={reload} />
        </div>
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <section className="table-felt mt-5 px-6 pb-6 pt-7 text-center text-felt-ink">
            <div className="text-[13px] opacity-70">Our profit in {monthName}</div>
            <div className={cx('font-display mt-1 text-[64px] leading-none tracking-tight', feltTone(stats.month))}>
              {signedMoney(stats.month)}
            </div>
            <div className="mt-2 text-[13px] opacity-60">
              {stats.monthGames} game{stats.monthGames === 1 ? '' : 's'} ended · {signedMoney(stats.allTime)} all-time
            </div>
            <div className="mx-auto mt-6 grid max-w-md grid-cols-3 gap-3 border-t border-white/10 pt-4 text-left">
              <Figure label={`Rake in ${monthName.slice(0, 3)}`} value={<Money value={stats.monthRake} />} />
              <Figure label="Avg per game" value={signedMoney(stats.avg)} />
              <Figure label="Loss discounts" value={<Money value={stats.monthDiscounts} />} />
            </div>
          </section>

          {open.length > 0 && (
            <>
              <SectionTitle
                action={
                  <button type="button" onClick={() => setCreating(true)} className="text-[13px] text-brass hover:underline">
                    + Another table
                  </button>
                }
              >
                Running now · {open.length}
              </SectionTitle>
              <div className={cx('grid gap-3', open.length > 1 && 'sm:grid-cols-2')}>
                {open.map((g) => (
                  <LiveGameCard key={g.id} g={g} />
                ))}
              </div>
            </>
          )}

          {chart.length > 1 && (
            <>
              <SectionTitle action={<WinLossLegend win="Profit" loss="Loss" />}>Profit by game</SectionTitle>
              <Card className="px-3 pb-2 pt-3">
                <DivergingColumns data={chart} label="Organizer profit for each of the last ended games" />
              </Card>
              {stats.best && (
                <p className="mt-2 px-1 text-[13px] text-muted">
                  Best night: <span className="text-ink">{stats.best.name}</span>, {shortDate(stats.best.game_date)},{' '}
                  <Money value={stats.best.net_profit} signed colored />.
                </p>
              )}
            </>
          )}

          <SectionTitle action={closed.length > 0 && <span className="text-[13px] text-muted">{closed.length} ended</span>}>Past games</SectionTitle>
          {closed.length === 0 ? (
            <Card>
              <Empty icon="games" title="No past games yet">
                Start a game, record buy-ins, cash-outs and each dealer round as the night goes, then end it to lock the numbers. You can also
                record a game that already happened from <span className="text-ink">New game</span>.
              </Empty>
            </Card>
          ) : (
            <>
              {closed.length > 8 && (
                <div className="relative mb-3">
                  <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
                  <TextInput placeholder="Find a game by name or date" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
                </div>
              )}
              {months.groups.length === 0 ? (
                <Card>
                  <Empty title="No games match" />
                </Card>
              ) : (
                <div className="space-y-4">
                  {months.groups.map((grp) => (
                    <div key={grp.key}>
                      <div className="mb-1.5 flex items-baseline justify-between px-1">
                        <span className="font-display text-[20px]">{grp.label}</span>
                        <span className="text-[13px] text-muted">
                          {grp.games.length} game{grp.games.length === 1 ? '' : 's'} · <Money value={grp.profit} signed colored />
                        </span>
                      </div>
                      <Card className="divide-y divide-line overflow-hidden">
                        {grp.games.map((g) => (
                          <GameRow key={g.id} g={g} />
                        ))}
                      </Card>
                    </div>
                  ))}
                </div>
              )}
              {months.total > shown && (
                <Button className="mt-4 w-full" onClick={() => setShown((n) => n + PAGE)}>
                  Show older games
                </Button>
              )}
            </>
          )}
        </>
      )}

      {creating && <NewGameSheet openToday={open.filter((g) => g.game_date === today).length} onClose={() => setCreating(false)} />}
    </>
  )
}
