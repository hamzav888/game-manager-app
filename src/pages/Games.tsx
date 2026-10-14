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
  Sheet,
  TextInput,
  cx,
  useAction,
} from '../components/ui'
import { createGame, listGameTotals } from '../lib/api'
import { shortDate, signedMoney, todayISO } from '../lib/format'
import { useLoader, useRealtime } from '../lib/hooks'
import type { GameTotals } from '../lib/types'

function defaultGameName() {
  return `${new Date().toLocaleDateString(undefined, { weekday: 'long' })} game`
}

function NewGameSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const { busy, run } = useAction()
  const [name, setName] = useState(defaultGameName)
  const [date, setDate] = useState(todayISO)

  const submit = () =>
    run(async () => {
      const g = await createGame({ name: name.trim(), game_date: date })
      navigate(`/games/${g.id}`)
    }, 'Game started')

  return (
    <Sheet
      open
      onClose={onClose}
      title="Open a table"
      subtitle="Tip tax and loss discount come from your organization’s house rules."
      footer={
        <Button variant="primary" size="lg" className="w-full" loading={busy} disabled={!name.trim() || !date} onClick={submit}>
          Start game
        </Button>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
        </Field>
        <Field label="Date">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </form>
    </Sheet>
  )
}

const sumOf = (xs: GameTotals[], k: keyof GameTotals) => xs.reduce((s, g) => s + Math.round(Number(g[k]) * 100), 0) / 100
const feltTone = (n: number) => (n > 0.004 ? 'text-win-felt' : n < -0.004 ? 'text-loss-felt' : 'text-felt-ink')

function LiveGameCard({ g }: { g: GameTotals }) {
  const bank = g.house_take
  return (
    <Link
      to={`/games/${g.id}`}
      className="group block rounded-[14px] border border-felt/70 bg-[linear-gradient(180deg,#14241d,#121a16)] p-4 transition-colors hover:border-felt"
    >
      <div className="flex items-center gap-2 text-[13px] font-medium text-felt-ink">
        <LiveDot /> Live now
        <span className="ml-auto text-xs font-normal text-felt-ink/60">{shortDate(g.game_date)}</span>
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="font-display truncate text-[28px] leading-tight">{g.name}</div>
          <div className="text-sm text-muted">
            {g.player_count} at the table · <Money value={g.total_buy_ins} /> bought in
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xs text-muted">Bank</div>
          <Money value={bank} className="font-display text-[28px] leading-tight" />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-3 text-sm font-medium text-felt-ink">
        Go to the table
        <Icon name="next" className="size-4 transition-transform group-hover:translate-x-0.5" />
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
        <div className="mt-0.5 text-[11px] text-faint">{date.toLocaleDateString(undefined, { month: 'short' })}</div>
      </div>
      <div className="min-w-0 flex-1 border-l border-line pl-4">
        <div className="truncate font-medium">{g.name}</div>
        <div className="truncate text-[13px] text-muted">
          {g.player_count} players · <Money value={g.total_buy_ins} /> in
        </div>
      </div>
      <Money value={g.net_profit} signed colored className="text-[15px] font-semibold" />
    </Link>
  )
}

export function GamesPage() {
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const { data, error, reload } = useLoader(listGameTotals, [])
  useRealtime(['games', 'transactions', 'dealer_tips', 'expenses'], reload)

  const open = (data ?? []).filter((g) => g.status === 'open')
  const closed = (data ?? []).filter((g) => g.status === 'closed')

  const stats = useMemo(() => {
    const month = todayISO().slice(0, 7)
    const thisMonth = closed.filter((g) => g.game_date.startsWith(month))
    const best = closed.reduce<GameTotals | null>((b, g) => (!b || g.net_profit > b.net_profit ? g : b), null)
    return {
      month: sumOf(thisMonth, 'net_profit'),
      monthGames: thisMonth.length,
      monthRake: sumOf(thisMonth, 'house_take'),
      allTime: sumOf(closed, 'net_profit'),
      avg: closed.length ? Math.round(sumOf(closed, 'net_profit') / closed.length) : 0,
      tipTax: sumOf(closed, 'tip_tax'),
      discounts: sumOf(closed, 'total_discounts'),
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

  const monthName = new Date().toLocaleDateString(undefined, { month: 'long' })
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <>
      <PageHeader
        title="Games"
        sub={today}
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
              {stats.monthGames} game{stats.monthGames === 1 ? '' : 's'} closed · {signedMoney(stats.allTime)} all-time
            </div>
            <div className="mx-auto mt-6 grid max-w-md grid-cols-3 gap-3 border-t border-white/10 pt-4 text-left">
              <Figure label="Avg per game" value={signedMoney(stats.avg)} />
              <Figure label="Tip tax kept" value={<Money value={stats.tipTax} />} />
              <Figure label="Loss discounts" value={<Money value={stats.discounts} />} />
            </div>
          </section>

          {open.length > 0 && (
            <div className="mt-4 space-y-3">
              {open.map((g) => (
                <LiveGameCard key={g.id} g={g} />
              ))}
            </div>
          )}

          {chart.length > 1 && (
            <>
              <SectionTitle action={<WinLossLegend win="Profit" loss="Loss" />}>Profit by game</SectionTitle>
              <Card className="px-3 pb-2 pt-3">
                <DivergingColumns data={chart} label="Organizer profit for each of the last closed games" />
              </Card>
              {stats.best && (
                <p className="mt-2 px-1 text-[13px] text-muted">
                  Best night: <span className="text-ink">{stats.best.name}</span>, {shortDate(stats.best.game_date)},{' '}
                  <Money value={stats.best.net_profit} signed colored />.
                </p>
              )}
            </>
          )}

          <SectionTitle>Past games</SectionTitle>
          {closed.length === 0 ? (
            <Card>
              <Empty icon="games" title="No closed games yet">
                Start a game, record buy-ins and cash-outs as the night goes, then close it to lock the numbers.
              </Empty>
            </Card>
          ) : (
            <Card className="divide-y divide-line overflow-hidden">
              {closed.map((g) => (
                <GameRow key={g.id} g={g} />
              ))}
            </Card>
          )}
        </>
      )}

      {creating && <NewGameSheet onClose={() => setCreating(false)} />}
    </>
  )
}
