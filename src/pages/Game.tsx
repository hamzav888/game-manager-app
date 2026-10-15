import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useAuth } from '../auth'
import { ActivityList } from '../components/ActivityList'
import { ResultBars, WinLossLegend } from '../components/charts'
import {
  AddPlayerSheet,
  BuyInSheet,
  CashOutSheet,
  DiscountSheet,
  EditGameSheet,
  ExpenseSheet,
  PlayerGameSheet,
  RoundSheet,
} from '../components/game/sheets'
import { Icon } from '../components/Icon'
import {
  Avatar,
  Button,
  Card,
  Empty,
  ErrorBox,
  Figure,
  IconButton,
  LiveDot,
  Loading,
  Meter,
  Money,
  SectionTitle,
  Tabs,
  cx,
  useAction,
  useFeedback,
} from '../components/ui'
import { discountRateFor, splitProfit, summarizeGame } from '../lib/accounting'
import type { GameSummary, PlayerLine } from '../lib/accounting'
import { getGameData, listGameTotals, listPartnerAccounts, listPlayers, recentDealerNames, updateGame } from '../lib/api'
import type { RecordStamp } from '../lib/actors'
import { useRecordStamps } from '../lib/actors'
import { formatClock, formatDate, money, signedMoney, timeAgo } from '../lib/format'
import { useLoader, useRealtime } from '../lib/hooks'
import { BANK_PAYER, categoryLabel, methodLabel } from '../lib/types'
import type { DealerTip, Expense, Game, GameTotals, PartnerAccount, Transaction } from '../lib/types'

type Tab = 'players' | 'rounds' | 'expenses' | 'summary' | 'activity'

type Modal =
  | { kind: 'add-player' }
  | { kind: 'buy-in'; playerId: string; existing?: Transaction }
  | { kind: 'cash-out'; playerId: string; existing?: Transaction }
  | { kind: 'player'; playerId: string }
  | { kind: 'discount'; playerId: string; existing: Transaction }
  | { kind: 'round'; existing?: DealerTip }
  | { kind: 'expense'; existing?: Expense }
  | { kind: 'edit-game' }

const DEFAULT_QUICK = [200, 500, 1000, 2000]
const TABS: { value: Tab; label: string }[] = [
  { value: 'players', label: 'Players' },
  { value: 'rounds', label: 'Rake & tips' },
  { value: 'expenses', label: 'Expenses' },
  { value: 'summary', label: 'Summary' },
  { value: 'activity', label: 'Activity' },
]

function quickAmountsFor(txs: Transaction[]): number[] {
  const freq = new Map<number, number>()
  for (const t of txs) if (t.kind === 'buy_in') freq.set(t.amount, (freq.get(t.amount) ?? 0) + 1)
  const common = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => a)
  return [...new Set([...DEFAULT_QUICK, ...common])].sort((a, b) => a - b).slice(0, 6)
}

const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
/** |x| ≥ 1 cent */
const nonZero = (n: number) => Math.abs(n) >= 0.005

// ---------------------------------------------------------------- ending a game

/** Confirm, then end (close) the game: locks it and posts the partners' shares. */
function useEndGame(game: Game, s: GameSummary, onChanged: () => void) {
  const { isAdmin } = useAuth()
  const { confirm } = useFeedback()
  const { busy, run } = useAction()
  const seated = s.players.filter((p) => p.status === 'playing')

  const end = async () => {
    const sure = await confirm({
      title: `End “${game.name}”?`,
      message: (
        <>
          {seated.length > 0 && (
            <p className="mb-3 rounded-[10px] border border-warn/30 bg-warn/[0.07] px-3 py-2 text-warn">
              {seated.length === 1 ? `${seated[0].name} hasn’t` : `${plural(seated.length, 'player')} haven’t`} cashed out
              {seated.length > 1 && <> ({seated.map((p) => p.name).join(', ')})</>}. Their chips will count as money the house kept.
            </p>
          )}
          {s.rakeReported && s.allCashedOut && nonZero(s.unaccounted) && (
            <p className="mb-3 text-warn">
              The chips are {money(Math.abs(s.unaccounted))} {s.unaccounted > 0 ? 'over' : 'short'} against the rake the dealers reported.
            </p>
          )}
          <span className="mb-3 grid grid-cols-2 gap-2 text-ink">
            <span className="rounded-[10px] border border-line bg-bg px-3 py-2">
              <span className="block text-xs text-muted">{seated.length ? 'Profit if ended now' : 'Net profit'}</span>
              <Money value={s.netProfit} signed colored className="font-display text-[22px]" />
            </span>
            <span className="rounded-[10px] border border-line bg-bg px-3 py-2">
              <span className="block text-xs text-muted">Rake · {plural(s.rounds, 'round')}</span>
              <Money value={s.totalRake} className="font-display text-[22px]" />
            </span>
          </span>
          Ending locks every buy-in, cash-out, round and expense, and adds the profit to the partners’ accounts.{' '}
          {isAdmin ? 'You can reopen it later.' : 'Only an admin can reopen it.'}
        </>
      ),
      confirmLabel: 'End game',
    })
    if (sure) await run(() => updateGame(game.id, { status: 'closed' }), 'Game ended').then(onChanged)
  }
  return { end, busy }
}

// ---------------------------------------------------------------- page

export function GamePage() {
  const { id = '' } = useParams()
  const { isAdmin } = useAuth()
  const [params, setParams] = useSearchParams()
  const rawTab = params.get('tab')
  const tab: Tab = rawTab === 'tips' ? 'rounds' : TABS.some((t) => t.value === rawTab) ? (rawTab as Tab) : 'players'
  const setTab = (t: Tab) => setParams(t === 'players' ? {} : { tab: t }, { replace: true })

  const game = useLoader(() => getGameData(id), [id])
  const roster = useLoader(listPlayers, [])
  const dealers = useLoader(recentDealerNames, [])
  const partners = useLoader(listPartnerAccounts, [])
  const tables = useLoader(listGameTotals, [])
  const stamps = useRecordStamps({ gameId: id })
  useRealtime(['games', 'transactions', 'dealer_tips', 'expenses'], game.reload)
  useRealtime(['games', 'transactions'], tables.reload)
  useRealtime(['players'], roster.reload)
  useRealtime(['partners'], partners.reload)

  const [modal, setModal] = useState<Modal | null>(null)
  const close = useCallback(() => setModal(null), [])
  useEffect(() => setModal(null), [id])

  const playersById = useMemo(() => new Map((roster.data ?? []).map((p) => [p.id, p] as const)), [roster.data])
  const g0 = game.data?.game
  const summary = useMemo(
    () =>
      game.data && g0
        ? summarizeGame(game.data.txs, game.data.tips, game.data.expenses, playersById, {
            tipTaxPct: g0.tip_tax_pct,
            lossDiscountPct: g0.loss_discount_pct,
          })
        : null,
    [game.data, g0, playersById],
  )

  if (game.error) return <ErrorBox error={game.error} onRetry={game.reload} />
  if (!game.data || !roster.data) return <Loading />
  const g = game.data.game
  if (!g || !summary)
    return (
      <Card>
        <Empty icon="games" title="Game not found">
          It may have been deleted.{' '}
          <Link to="/" className="underline">
            Back to games
          </Link>
        </Empty>
      </Card>
    )

  const canEdit = g.status === 'open'
  const lineFor = (pid: string) => summary.players.find((p) => p.playerId === pid)
  const reload = () => {
    void game.reload()
    void roster.reload()
    void partners.reload()
    void tables.reload()
  }
  const quick = quickAmountsFor(game.data.txs)
  const dealerNames = [
    ...new Set([...[...game.data.tips].reverse().map((t) => t.dealer_name), ...(dealers.data ?? [])].map((n) => n.trim())),
  ].slice(0, 8)
  const activePartners = (partners.data ?? []).filter((p) => p.active)
  // Dealers rotate: suggest whoever has gone longest without reporting a round.
  const lastSeen = new Map<string, string>()
  for (const t of game.data.tips) {
    const k = t.dealer_name.trim().toLowerCase()
    lastSeen.delete(k)
    lastSeen.set(k, t.dealer_name.trim())
  }
  const rotation = [...lastSeen.values()]
  const nextDealer =
    rotation.length >= 2
      ? rotation[0]
      : ((dealers.data ?? []).find((n) => n.toLowerCase() !== rotation[0]?.toLowerCase()) ?? rotation[0] ?? '')
  const otherTables = (tables.data ?? []).filter((t) => t.status === 'open' && t.id !== g.id)
  const roundNo = (t?: DealerTip) => (t ? game.data!.tips.findIndex((x) => x.id === t.id) + 1 : game.data!.tips.length + 1)

  return (
    <>
      <GameHeader
        game={g}
        summary={summary}
        otherTables={otherTables}
        isAdmin={isAdmin}
        onEdit={() => setModal({ kind: 'edit-game' })}
        onRound={() => setModal({ kind: 'round' })}
        onChanged={reload}
      />

      <div className="mt-5">
        <Tabs value={tab} options={TABS} onChange={setTab} />
      </div>

      {tab === 'players' && <PlayersTab summary={summary} canEdit={canEdit} onModal={setModal} />}
      {tab === 'rounds' && <RoundsTab game={g} rounds={game.data.tips} summary={summary} canEdit={canEdit} onModal={setModal} stamps={stamps} />}
      {tab === 'expenses' && (
        <ExpensesTab expenses={game.data.expenses} summary={summary} canEdit={canEdit} onModal={setModal} stamps={stamps} />
      )}
      {tab === 'summary' && <SummaryTab game={g} summary={summary} partners={activePartners} onChanged={reload} />}
      {tab === 'activity' && (
        <div className="mt-5">
          <ActivityList filter={{ gameId: g.id }} playersById={playersById} live />
        </div>
      )}

      {modal?.kind === 'add-player' && (
        <AddPlayerSheet
          game={g}
          roster={roster.data}
          inGame={new Set(summary.players.map((p) => p.playerId))}
          quickAmounts={quick}
          onClose={close}
          onSaved={reload}
        />
      )}
      {modal?.kind === 'buy-in' && (
        <BuyInSheet
          game={g}
          player={{ id: modal.playerId, name: playersById.get(modal.playerId)?.name ?? 'Player' }}
          existing={modal.existing}
          quickAmounts={quick}
          onClose={close}
          onSaved={reload}
        />
      )}
      {modal?.kind === 'cash-out' && lineFor(modal.playerId) && (
        <CashOutSheet
          game={g}
          line={lineFor(modal.playerId)!}
          discountPct={discountRateFor(playersById.get(modal.playerId), g.loss_discount_pct)}
          existing={modal.existing}
          onClose={close}
          onSaved={reload}
        />
      )}
      {modal?.kind === 'player' && lineFor(modal.playerId) && (
        <PlayerGameSheet
          line={lineFor(modal.playerId)!}
          canEdit={canEdit}
          stamps={stamps}
          onClose={close}
          onBuyIn={() => setModal({ kind: 'buy-in', playerId: modal.playerId })}
          onCashOut={() => setModal({ kind: 'cash-out', playerId: modal.playerId })}
          onEditTx={(t) =>
            setModal(
              t.kind === 'discount'
                ? { kind: 'discount', playerId: modal.playerId, existing: t }
                : { kind: t.kind === 'buy_in' ? 'buy-in' : 'cash-out', playerId: modal.playerId, existing: t },
            )
          }
        />
      )}
      {modal?.kind === 'discount' && (
        <DiscountSheet
          player={playersById.get(modal.playerId)?.name ?? 'Player'}
          existing={modal.existing}
          onClose={close}
          onSaved={reload}
        />
      )}
      {modal?.kind === 'round' && (
        <RoundSheet
          game={g}
          existing={modal.existing}
          roundNo={roundNo(modal.existing)}
          dealerNames={dealerNames}
          suggestedDealer={nextDealer}
          onClose={close}
          onSaved={reload}
        />
      )}
      {modal?.kind === 'expense' && (
        <ExpenseSheet game={g} existing={modal.existing} partners={activePartners} onClose={close} onSaved={reload} />
      )}
      {modal?.kind === 'edit-game' && <EditGameSheet game={g} onClose={close} onSaved={reload} />}
    </>
  )
}

// ---------------------------------------------------------------- header + the table

const feltTone = (n: number) => (n > 0.004 ? 'text-win-felt' : n < -0.004 ? 'text-loss-felt' : '')

function OtherTables({ tables }: { tables: GameTotals[] }) {
  if (tables.length === 0) return null
  return (
    <div className="no-scrollbar -mx-4 mt-4 flex items-center gap-2 overflow-x-auto px-4">
      <span className="shrink-0 text-xs text-muted">Also running</span>
      {tables.map((t) => (
        <Link
          key={t.id}
          to={`/games/${t.id}`}
          className="inline-flex shrink-0 items-center gap-2 rounded-full border border-felt/70 bg-felt/15 px-3 py-1.5 text-[13px] text-felt-ink transition-colors hover:border-felt"
        >
          <Icon name="table" className="size-4 opacity-80" />
          <span className="max-w-[11rem] truncate">{t.name}</span>
          <span className="opacity-60">{t.seated_count} playing</span>
        </Link>
      ))}
    </div>
  )
}

function GameHeader({
  game,
  summary: s,
  otherTables,
  isAdmin,
  onEdit,
  onRound,
  onChanged,
}: {
  game: Game
  summary: GameSummary
  otherTables: GameTotals[]
  isAdmin: boolean
  onEdit: () => void
  onRound: () => void
  onChanged: () => void
}) {
  const open = game.status === 'open'
  const final = s.allCashedOut || (!open && s.players.length > 0)
  const { busy, run } = useAction()
  const ending = useEndGame(game, s, onChanged)
  const lastRound = s.lastRoundAt

  let label: string
  let hero: ReactNode
  let sub: ReactNode
  if (final) {
    label = open ? 'Everyone’s out · our net profit' : 'Our net profit'
    hero = <span className={feltTone(s.netProfit)}>{signedMoney(s.netProfit)}</span>
    sub = (
      <>
        House take {money(s.houseTake)} − costs {money(s.totalCosts)}
        {s.rakeReported && nonZero(s.unaccounted) && (
          <span className="ml-1.5 rounded-full bg-black/30 px-2 py-px text-warn">
            {money(Math.abs(s.unaccounted))} {s.unaccounted > 0 ? 'over' : 'short'}
          </span>
        )}
      </>
    )
  } else if (s.rakeReported) {
    label = 'Profit so far'
    hero = <span className={feltTone(s.profitSoFar)}>{signedMoney(s.profitSoFar)}</span>
    sub = `Rake ${money(s.totalRake)} + tip tax ${money(s.tipTax)} − costs ${money(s.totalCosts)}`
  } else {
    label = 'Bank'
    hero = money(s.bank)
    sub = s.players.length ? `${money(s.seatedBuyIns)} still in play · record the rake each dealer round` : 'Seat the first player when they buy in'
  }

  return (
    <>
      <div className="flex items-start gap-2">
        <Link to="/" className="-ml-2 mt-1 rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Back to games">
          <Icon name="back" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="font-display truncate text-[32px] leading-[1.1]">{game.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
            <span>{new Date(`${game.game_date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
            <span className="rounded-full border border-line px-2 py-px text-[11px]">Tip tax {pct(game.tip_tax_pct)}</span>
            <span className="rounded-full border border-line px-2 py-px text-[11px]">Loss discount {pct(game.loss_discount_pct)}</span>
          </div>
        </div>
        {(open || isAdmin) && <IconButton icon="sliders" label="Game settings" onClick={onEdit} className="mt-1" />}
      </div>

      {open && <OtherTables tables={otherTables} />}

      <section className={cx('table-felt mt-5 px-5 pb-5 pt-5 text-felt-ink', !open && 'is-closed')}>
        <div className="flex items-center justify-between text-[13px]">
          {open ? (
            <span className="inline-flex items-center gap-2 font-medium">
              <LiveDot /> Live
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 opacity-75">
              <Icon name="lock" className="size-3.5" /> Ended
            </span>
          )}
          {s.players.length > 0 && (
            <span className="opacity-70">
              {s.seatedCount ? `${s.seatedCount} of ${s.players.length} playing` : `${s.players.length} players`}
            </span>
          )}
        </div>

        <div className="mt-4 text-center">
          <div className="text-[13px] opacity-70">{label}</div>
          <div className="font-display mt-0.5 text-[64px] leading-none tracking-tight">{hero}</div>
          <div className="mt-2 text-[13px] opacity-60">{sub}</div>
        </div>

        {!final && s.players.length > 0 && (
          <div className="mx-auto mt-4 max-w-xs">
            <Meter value={s.players.length - s.seatedCount} max={s.players.length} />
            <div className="mt-1.5 text-center text-[11px] opacity-55">
              {s.players.length - s.seatedCount} of {s.players.length} cashed out
            </div>
          </div>
        )}

        <div className="mt-5 grid grid-cols-4 gap-2 border-t border-white/10 pt-4">
          <Figure label="Buy-ins" value={money(s.totalBuyIns)} />
          <Figure label="Paid out" value={money(s.totalCashOuts)} />
          {s.rakeReported || open ? (
            <Figure label={`Rake · ${s.rounds}`} value={money(s.totalRake)} />
          ) : (
            <Figure label="House kept" value={money(s.houseChips)} />
          )}
          <Figure label="Costs" value={money(s.totalCosts)} />
        </div>
      </section>

      {open ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Button size="lg" variant="felt" icon="chip" onClick={onRound}>
              Dealer round
            </Button>
            <Button size="lg" icon="flag" loading={ending.busy} onClick={() => void ending.end()}>
              End game
            </Button>
          </div>
          {lastRound && (
            <p className="mt-2 text-center text-xs text-faint">
              Last round reported {timeAgo(lastRound)} · round {s.rounds}
            </p>
          )}
        </>
      ) : (
        <div className="mt-3 flex items-center gap-3 rounded-[12px] border border-line bg-surface px-4 py-3 text-sm text-muted">
          <Icon name="lock" className="size-4 shrink-0" />
          <span className="flex-1">This game has ended and is locked.{!isAdmin && ' An admin can reopen it.'}</span>
          {isAdmin && (
            <Button
              size="sm"
              icon="unlock"
              loading={busy}
              onClick={() => run(() => updateGame(game.id, { status: 'open' }), 'Game reopened').then(onChanged)}
            >
              Reopen
            </Button>
          )}
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------- players tab

function PlayerRow({ line, canEdit, onModal }: { line: PlayerLine; canEdit: boolean; onModal: (m: Modal) => void }) {
  const out = line.status === 'out'
  const onAccount = line.txs.some((t) => t.method === 'account')
  return (
    <div className="flex items-center gap-3 px-3.5 py-3">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        onClick={() => onModal({ kind: 'player', playerId: line.playerId })}
      >
        <Avatar name={line.name} />
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{line.name}</span>
            {onAccount && <span className="shrink-0 rounded border border-brass/30 px-1 text-[10px] font-medium text-brass">ACCT</span>}
          </span>
          <span className="block truncate text-[13px] text-muted">
            In <Money value={line.buyIns} />
            {line.buyInCount > 1 && ` · ${line.buyInCount} buy-ins`}
            {out && (
              <>
                {' '}
                · out <Money value={line.cashOuts} />
              </>
            )}
            {line.discounts > 0 && (
              <>
                {' '}
                · disc. <Money value={line.discounts} />
              </>
            )}
          </span>
        </span>
      </button>
      {out ? (
        <div className="flex items-center gap-1">
          <Money value={line.net} signed colored className="text-[15px] font-semibold" />
          {canEdit && (
            <IconButton icon="plus" label={`Buy-in for ${line.name}`} onClick={() => onModal({ kind: 'buy-in', playerId: line.playerId })} />
          )}
        </div>
      ) : (
        canEdit && (
          <div className="flex shrink-0 gap-1.5">
            <Button size="sm" icon="plus" onClick={() => onModal({ kind: 'buy-in', playerId: line.playerId })} aria-label={`Buy-in for ${line.name}`}>
              <span className="hidden min-[400px]:inline">Buy-in</span>
            </Button>
            <Button size="sm" variant="felt" onClick={() => onModal({ kind: 'cash-out', playerId: line.playerId })}>
              Cash out
            </Button>
          </div>
        )
      )}
    </div>
  )
}

function PlayersTab({ summary, canEdit, onModal }: { summary: GameSummary; canEdit: boolean; onModal: (m: Modal) => void }) {
  const seated = summary.players.filter((p) => p.status === 'playing')
  const out = summary.players.filter((p) => p.status === 'out').sort((a, b) => b.net - a.net)

  return (
    <>
      {canEdit && (
        <Button variant="primary" size="lg" icon="plus" className="mt-5 w-full" onClick={() => onModal({ kind: 'add-player' })}>
          Seat a player
        </Button>
      )}
      {summary.players.length === 0 ? (
        <Card className="mt-4">
          <Empty icon="users" title="Empty table">
            {canEdit ? 'Seat the first player when they buy in.' : 'Nobody played in this game.'}
          </Empty>
        </Card>
      ) : (
        <>
          {seated.length > 0 && (
            <>
              <SectionTitle action={<span className="text-[13px] text-muted tnum">{money(summary.seatedBuyIns)} in</span>}>
                At the table · {seated.length}
              </SectionTitle>
              <Card className="divide-y divide-line">
                {seated.map((l) => (
                  <PlayerRow key={l.playerId} line={l} canEdit={canEdit} onModal={onModal} />
                ))}
              </Card>
            </>
          )}
          {out.length > 0 && (
            <>
              <SectionTitle>Cashed out · {out.length}</SectionTitle>
              <Card className="divide-y divide-line">
                {out.map((l) => (
                  <PlayerRow key={l.playerId} line={l} canEdit={canEdit} onModal={onModal} />
                ))}
              </Card>
            </>
          )}
        </>
      )}
    </>
  )
}

// ---------------------------------------------------------------- rake & tips tab

/** Stacked columns, one per round: rake (brass) under tips (grey). */
function RoundColumns({ rounds, onOpen }: { rounds: DealerTip[]; onOpen?: (t: DealerTip) => void }) {
  const max = Math.max(1, ...rounds.map((r) => r.rake + r.amount))
  return (
    <div>
      <div className="flex h-36 items-end gap-1.5" role="img" aria-label={`Rake and tips for each of ${rounds.length} rounds`}>
        {rounds.map((r, i) => (
          <button
            key={r.id}
            type="button"
            disabled={!onOpen}
            onClick={() => onOpen?.(r)}
            title={`Round ${i + 1} · ${r.dealer_name}: rake ${money(r.rake)}, tips ${money(r.amount)}`}
            className="group flex h-full min-w-0 max-w-14 flex-1 flex-col items-center justify-end"
          >
            <span className="mb-1 text-[10px] text-muted tnum">{r.rake ? money(r.rake) : ''}</span>
            <span
              className="flex w-full flex-col overflow-hidden rounded-t-[5px] transition-opacity group-enabled:group-hover:opacity-80"
              style={{ height: `calc(${((r.rake + r.amount) / max) * 100}% - 16px)`, minHeight: 3 }}
            >
              <span className="bg-[#5d5a4f]" style={{ flex: `${r.amount} 1 0` }} />
              <span className="bg-brass" style={{ flex: `${r.rake} 1 0` }} />
            </span>
          </button>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5 border-t border-line pt-1.5">
        {rounds.map((r, i) => (
          <span key={r.id} className="min-w-0 max-w-14 flex-1 truncate text-center text-[10px] text-faint" title={r.dealer_name}>
            {i + 1}
          </span>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-center gap-4 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-brass" /> Rake
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-[#5d5a4f]" /> Tips
        </span>
        <span className="text-faint">by round</span>
      </div>
    </div>
  )
}

function RoundsTab({
  game,
  rounds,
  summary: s,
  canEdit,
  onModal,
  stamps,
}: {
  game: Game
  rounds: DealerTip[]
  summary: GameSummary
  canEdit: boolean
  onModal: (m: Modal) => void
  stamps: Map<string, RecordStamp>
}) {
  return (
    <>
      {canEdit && (
        <Button variant="primary" size="lg" icon="chip" className="mt-5 w-full" onClick={() => onModal({ kind: 'round' })}>
          Record round {rounds.length + 1}
        </Button>
      )}

      <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-line bg-line sm:grid-cols-4">
        <div className="bg-surface px-4 py-3">
          <div className="text-[12px] text-muted">Rake · {plural(s.rounds, 'round')}</div>
          <Money value={s.totalRake} className="font-display text-[26px] leading-tight text-brass" />
        </div>
        <div className="bg-surface px-4 py-3">
          <div className="text-[12px] text-muted">Tips</div>
          <Money value={s.totalTips} className="font-display text-[26px] leading-tight" />
        </div>
        <div className="bg-surface px-4 py-3">
          <div className="text-[12px] text-muted">Tip tax {pct(game.tip_tax_pct)}</div>
          <Money value={s.tipTax} className="font-display text-[26px] leading-tight text-brass" />
        </div>
        <div className="bg-surface px-4 py-3">
          <div className="text-[12px] text-muted">Dealers take home</div>
          <Money value={s.dealerNet} className="font-display text-[26px] leading-tight" />
        </div>
      </div>

      {rounds.length === 0 ? (
        <Card className="mt-4">
          <Empty icon="chip" title="No rounds yet">
            When a dealer gets up, record the rake they took and the tips they made. The rake can be different every round.
          </Empty>
        </Card>
      ) : (
        <>
          {rounds.length > 1 && (
            <Card className="mt-4 px-4 pb-3 pt-4">
              <RoundColumns rounds={rounds} onOpen={canEdit ? (t) => onModal({ kind: 'round', existing: t }) : undefined} />
            </Card>
          )}

          <SectionTitle>By dealer</SectionTitle>
          <Card className="divide-y divide-line">
            {s.dealers.map((d) => (
              <div key={d.name} className="flex items-center gap-3 px-3.5 py-3">
                <Avatar name={d.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{d.name}</span>
                  <span className="block truncate text-[13px] text-muted">
                    {plural(d.rounds, 'round')} · rake <Money value={d.rake} className="text-brass" />
                  </span>
                </span>
                <span className="text-right">
                  <Money value={d.net} className="block text-[15px] font-semibold" />
                  <span className="text-[11px] text-faint">
                    {d.tax > 0 ? (
                      <>
                        tips <Money value={d.amount} /> − tax
                      </>
                    ) : (
                      'tips, takes home'
                    )}
                  </span>
                </span>
              </div>
            ))}
          </Card>

          <SectionTitle>Every round</SectionTitle>
          <Card className="divide-y divide-line">
            {rounds
              .map((t, i) => ({ t, n: i + 1 }))
              .reverse()
              .map(({ t, n }) => (
                <button
                  key={t.id}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => onModal({ kind: 'round', existing: t })}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left enabled:hover:bg-surface-2/60"
                >
                  <span className="font-display w-7 shrink-0 text-center text-[22px] leading-none text-faint">{n}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{t.dealer_name}</span>
                    <span className="block truncate text-xs text-faint tnum">
                      {formatClock(t.created_at)}
                      {stamps.get(t.id)?.createdBy && ` · ${stamps.get(t.id)!.createdBy}`}
                      {t.note && ` · ${t.note}`}
                      {t.updated_at && ` · edited ${formatClock(t.updated_at)}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-sm leading-tight">
                    <Money value={t.rake} className="block font-semibold text-brass" />
                    <span className="text-xs text-muted">
                      + <Money value={t.amount} /> tips
                    </span>
                  </span>
                  {canEdit && <Icon name="edit" className="size-3.5 shrink-0 text-faint" />}
                </button>
              ))}
          </Card>
        </>
      )}
    </>
  )
}

// ---------------------------------------------------------------- expenses tab

function ExpensesTab({
  expenses,
  summary,
  canEdit,
  onModal,
  stamps,
}: {
  expenses: Expense[]
  summary: GameSummary
  canEdit: boolean
  onModal: (m: Modal) => void
  stamps: Map<string, RecordStamp>
}) {
  const discounts = summary.discountsByPlayer
  return (
    <>
      {canEdit && (
        <Button variant="primary" size="lg" icon="plus" className="mt-5 w-full" onClick={() => onModal({ kind: 'expense' })}>
          Add expense
        </Button>
      )}

      <Card className="mt-4 grid grid-cols-3 divide-x divide-line">
        <div className="px-4 py-3">
          <div className="text-[12px] text-muted">Total costs</div>
          <Money value={summary.totalCosts} className="font-display text-[26px] leading-tight" />
        </div>
        <div className="px-4 py-3">
          <div className="text-[12px] text-muted">Expenses</div>
          <Money value={summary.totalExpenses} className="font-display text-[26px] leading-tight" />
        </div>
        <div className="px-4 py-3">
          <div className="text-[12px] text-muted">Loss discounts</div>
          <Money value={summary.totalDiscounts} className="font-display text-[26px] leading-tight text-brass" />
        </div>
      </Card>

      {discounts.length > 0 && (
        <>
          <SectionTitle action={<Money value={summary.totalDiscounts} className="text-[13px] text-muted" />}>Loss discounts</SectionTitle>
          <Card className="divide-y divide-line">
            {discounts.map((d) => (
              <button
                key={d.playerId}
                type="button"
                onClick={() => onModal({ kind: 'player', playerId: d.playerId })}
                className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-surface-2/60"
              >
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-brass/40 text-brass">
                  <Icon name="percent" className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{d.name}</span>
                  <span className="block text-[13px] text-muted">Given back on their loss</span>
                </span>
                <Money value={d.amount} className="font-semibold" />
              </button>
            ))}
          </Card>
          <p className="mt-2 px-1 text-xs text-faint">Added automatically at cash-out and counted as an expense of this game.</p>
        </>
      )}

      {expenses.length === 0 ? (
        discounts.length === 0 && (
          <Card className="mt-4">
            <Empty title="No expenses yet">Food, drinks, venue, dealer pay… charged to a partner’s account or the game bank. Loss discounts show up here too.</Empty>
          </Card>
        )
      ) : (
        <>
          <SectionTitle action={<Money value={summary.totalExpenses} className="text-[13px] text-muted" />}>Who paid</SectionTitle>
          <Card className="divide-y divide-line">
            {summary.expensesByPayer.map((p) => {
              const bank = p.name.toLowerCase() === BANK_PAYER.toLowerCase()
              return (
                <div key={p.name} className="flex items-center gap-3 px-3.5 py-3">
                  {bank ? (
                    <span className="inline-flex size-9 items-center justify-center rounded-full border border-line bg-bg text-muted">
                      <Icon name="wallet" className="size-4" />
                    </span>
                  ) : (
                    <Avatar name={p.name} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="block text-[13px] text-muted">{bank ? 'Paid from game cash' : 'Credited to their partner account'}</span>
                  </span>
                  <Money value={p.amount} className="font-semibold" />
                </div>
              )
            })}
          </Card>
          <SectionTitle>All expenses</SectionTitle>
          <Card className="divide-y divide-line">
            {[...expenses].reverse().map((e) => (
              <button
                key={e.id}
                type="button"
                disabled={!canEdit}
                onClick={() => onModal({ kind: 'expense', existing: e })}
                className="flex w-full items-center gap-3 px-4 py-3 text-left enabled:hover:bg-surface-2/60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {categoryLabel(e.category)}
                    {e.description && <span className="text-muted"> · {e.description}</span>}
                  </span>
                  <span className="block truncate text-xs text-faint tnum">
                    Paid by {e.paid_by} · {formatClock(e.created_at)}
                    {stamps.get(e.id)?.createdBy && ` · recorded by ${stamps.get(e.id)!.createdBy}`}
                    {e.updated_at && ` · edited ${formatClock(e.updated_at)}`}
                  </span>
                </span>
                <Money value={e.amount} />
                {canEdit && <Icon name="edit" className="size-3.5 text-faint" />}
              </button>
            ))}
          </Card>
        </>
      )}
    </>
  )
}

// ---------------------------------------------------------------- summary tab

function Row({
  label,
  value,
  strong,
  signed,
  colored,
  tone,
  indent,
}: {
  label: ReactNode
  value: number
  strong?: boolean
  signed?: boolean
  colored?: boolean
  tone?: string
  indent?: boolean
}) {
  return (
    <div className={cx('flex items-center justify-between gap-3 px-4 py-2.5', strong && 'bg-surface-2/50', indent && 'pl-8 text-[13px]')}>
      <span className={strong ? 'font-semibold' : 'text-muted'}>{label}</span>
      <Money value={value} signed={signed} colored={colored} className={cx('shrink-0', strong ? 'font-semibold' : '', tone)} />
    </div>
  )
}

function buildShareText(game: Game, s: GameSummary): string {
  const lines = [`${game.name} — ${formatDate(game.game_date)}`, '']
  for (const p of [...s.players].sort((a, b) => b.net - a.net)) {
    lines.push(p.status === 'out' ? `${signedMoney(p.net)}  ${p.name}` : `(playing, in ${money(p.buyIns)})  ${p.name}`)
  }
  lines.push(
    '',
    `Buy-ins: ${money(s.totalBuyIns)}`,
    `Cash-outs: ${money(s.totalCashOuts)}`,
    `Rake: ${money(s.totalRake)} over ${plural(s.rounds, 'round')}`,
    `Dealer tips: ${money(s.totalTips)} (house keeps ${money(s.tipTax)})`,
    `Expenses: ${money(s.totalExpenses)}`,
    `Loss discounts: ${money(s.totalDiscounts)}`,
  )
  if (s.allCashedOut) {
    if (s.rakeReported && nonZero(s.unaccounted)) lines.push(`Over / short: ${signedMoney(s.unaccounted)}`)
    lines.push(`House take: ${money(s.houseTake)}`, `Net profit: ${signedMoney(s.netProfit)}`)
  } else lines.push(`Profit so far: ${signedMoney(s.profitSoFar)} (${s.seatedCount} still playing)`)
  if (s.reimbursements.length) {
    lines.push('', 'Charged to partner accounts:')
    for (const r of s.reimbursements) lines.push(`  ${r.name}: ${money(r.amount)}`)
  }
  return lines.join('\n')
}

function SummaryTab({
  game,
  summary: s,
  partners,
  onChanged,
}: {
  game: Game
  summary: GameSummary
  partners: PartnerAccount[]
  onChanged: () => void
}) {
  const { toast } = useFeedback()
  const navigate = useNavigate()
  const ending = useEndGame(game, s, onChanged)
  const open = game.status === 'open'
  const final = s.allCashedOut || (!open && s.players.length > 0)
  const results = [...s.players].sort((a, b) => b.net - a.net)
  const finished = results.filter((p) => p.status === 'out')
  const split = splitProfit(s.netProfit, partners.filter((p) => p.share_pct > 0))
  const offBy = s.rakeReported && final && nonZero(s.unaccounted)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildShareText(game, s))
      toast('Summary copied')
    } catch {
      toast('Could not copy to clipboard', 'error')
    }
  }

  return (
    <>
      {s.seatedCount > 0 && (
        <div className="mt-5 flex items-start gap-3 rounded-[12px] border border-warn/25 bg-warn/[0.07] px-4 py-3 text-sm text-warn">
          <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
          {s.seatedCount} player{s.seatedCount === 1 ? ' is' : 's are'} still playing. Final numbers appear once everyone cashes out.
        </div>
      )}
      {final && s.houseChips < 0 && (
        <div className="mt-5 flex items-start gap-3 rounded-[12px] border border-loss/30 bg-loss/[0.07] px-4 py-3 text-sm text-loss">
          <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
          More was paid out than bought in ({money(-s.houseChips)} short). Double-check the cash-outs and tips.
        </div>
      )}
      {offBy && s.houseChips >= 0 && (
        <div className="mt-5 flex items-start gap-3 rounded-[12px] border border-warn/25 bg-warn/[0.07] px-4 py-3 text-sm text-warn">
          <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
          <span>
            The chips are <strong>{money(Math.abs(s.unaccounted))} {s.unaccounted > 0 ? 'over' : 'short'}</strong> against the rake the dealers reported.
            Check the cash-outs, tips and each round’s rake. It’s included in the profit either way.
          </span>
        </div>
      )}

      {finished.length > 0 && (
        <>
          <SectionTitle action={<WinLossLegend />}>Who won, who lost</SectionTitle>
          <Card className="px-3 py-2.5">
            <ResultBars
              rows={finished.map((p) => ({
                key: p.playerId,
                name: p.name,
                value: p.net,
                hint: `${p.name}: in ${money(p.buyIns)}, out ${money(p.cashOuts)}${p.discounts ? `, discount ${money(p.discounts)}` : ''}`,
                onOpen: () => navigate(`/players/${p.playerId}`),
              }))}
            />
          </Card>
        </>
      )}

      <SectionTitle>The ledger</SectionTitle>
      {results.length === 0 ? (
        <Card>
          <Empty title="No players yet" />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-[minmax(0,1fr)_3.75rem_3.75rem_4.75rem] gap-x-2 border-b border-line px-4 py-2 text-[11px] text-faint">
            <span>Player</span>
            <span className="text-right">In</span>
            <span className="text-right">Out</span>
            <span className="text-right">Net</span>
          </div>
          <div className="divide-y divide-line">
            {results.map((p) => (
              <Link
                key={p.playerId}
                to={`/players/${p.playerId}`}
                className="grid grid-cols-[minmax(0,1fr)_3.75rem_3.75rem_4.75rem] items-center gap-x-2 px-4 py-2.5 text-sm hover:bg-surface-2/60"
              >
                <span className="min-w-0">
                  <span className="block truncate">{p.name}</span>
                  {p.discounts > 0 && (
                    <span className="block text-[11px] text-brass">
                      +<Money value={p.discounts} /> discount
                    </span>
                  )}
                </span>
                <Money value={p.buyIns} className="text-right text-muted" />
                {p.status === 'out' ? (
                  <Money value={p.cashOuts} className="text-right text-muted" />
                ) : (
                  <span className="text-right text-xs text-faint">playing</span>
                )}
                <span className="text-right">
                  {p.status === 'out' ? <Money value={p.net} signed colored className="font-semibold" /> : <span className="text-faint">—</span>}
                </span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      <SectionTitle>Where the money went</SectionTitle>
      {final ? (
        <Card className="divide-y divide-line overflow-hidden text-sm">
          <Row label="Buy-ins" value={s.totalBuyIns} />
          <Row label="− Cashed out to players" value={s.totalCashOuts} />
          <Row label="− Dealer tips" value={s.totalTips} />
          <Row label="= Chips the house kept" value={s.houseChips} strong />
          {s.rakeReported && (
            <>
              <Row label={`Rake reported · ${plural(s.rounds, 'round')}`} value={s.totalRake} indent tone="text-brass" />
              <Row
                label={nonZero(s.unaccounted) ? (s.unaccounted > 0 ? 'Over (unreported chips)' : 'Short (missing chips)') : 'Over / short'}
                value={s.unaccounted}
                signed
                indent
                tone={nonZero(s.unaccounted) ? 'text-warn' : undefined}
              />
            </>
          )}
          <Row label={`+ Tip tax (${pct(game.tip_tax_pct)})`} value={s.tipTax} tone="text-brass" />
          <Row label="= House take" value={s.houseTake} strong />
          <Row label="− Loss discounts" value={s.totalDiscounts} />
          <Row label="− Expenses" value={s.totalExpenses} />
          <div className="flex items-center justify-between bg-surface-2/50 px-4 py-4">
            <span className="font-semibold">= Net profit</span>
            <Money value={s.netProfit} signed colored className="font-display text-[32px] leading-none" />
          </div>
        </Card>
      ) : (
        <Card className="divide-y divide-line overflow-hidden text-sm">
          <Row label={`Rake so far · ${plural(s.rounds, 'round')}`} value={s.totalRake} tone="text-brass" />
          <Row label={`+ Tip tax (${pct(game.tip_tax_pct)})`} value={s.tipTax} tone="text-brass" />
          <Row label="− Loss discounts" value={s.totalDiscounts} />
          <Row label="− Expenses" value={s.totalExpenses} />
          <div className="flex items-center justify-between bg-surface-2/50 px-4 py-4">
            <span className="font-semibold">= Profit so far</span>
            {s.rakeReported ? (
              <Money value={s.profitSoFar} signed colored className="font-display text-[32px] leading-none" />
            ) : (
              <span className="text-right">
                <span className="font-display block text-2xl leading-none text-faint">Pending</span>
                <span className="text-xs text-muted">no rake reported yet</span>
              </span>
            )}
          </div>
          <Row label="Chips that should be on the table" value={s.unaccounted} />
        </Card>
      )}
      {!final && (
        <p className="mt-2 px-1 text-xs leading-relaxed text-faint">
          “Should be on the table” is buy-ins − cash-outs − tips − rake. Count the chips in play to check it; once everyone cashes out, any
          difference shows as over / short.
        </p>
      )}

      {s.allCashedOut && split.length > 0 && (
        <>
          <SectionTitle>Partner split</SectionTitle>
          <Card className="divide-y divide-line">
            {split.map((p) => (
              <Link key={p.id} to={`/partners/${p.id}`} className="flex items-center gap-3 px-3.5 py-3 hover:bg-surface-2/60">
                <Avatar name={p.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="text-[13px] text-muted">{pct(p.share_pct)} share</span>
                </span>
                <Money value={p.amount} signed colored className="font-semibold" />
              </Link>
            ))}
          </Card>
          <p className="mt-2 px-1 text-xs text-faint">Added to each partner’s account when the game ends.</p>
        </>
      )}

      {s.reimbursements.length > 0 && (
        <>
          <SectionTitle>Charged to partner accounts</SectionTitle>
          <Card className="divide-y divide-line">
            {s.reimbursements.map((r) => (
              <div key={r.name} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span>{r.name}</span>
                <Money value={r.amount} className="font-semibold" />
              </div>
            ))}
          </Card>
        </>
      )}

      {(s.expensesByCategory.length > 0 || s.totalDiscounts > 0 || s.buyInsByMethod.length > 0) && (
        <div className="grid gap-x-3 sm:grid-cols-2">
          {(s.expensesByCategory.length > 0 || s.totalDiscounts > 0) && (
            <div>
              <SectionTitle>Costs by type</SectionTitle>
              <Card className="divide-y divide-line text-sm">
                {s.totalDiscounts > 0 && (
                  <div className="flex justify-between px-4 py-2.5">
                    <span>Loss discounts</span>
                    <Money value={s.totalDiscounts} />
                  </div>
                )}
                {s.expensesByCategory.map((c) => (
                  <div key={c.category} className="flex justify-between px-4 py-2.5">
                    <span>{categoryLabel(c.category)}</span>
                    <Money value={c.amount} />
                  </div>
                ))}
              </Card>
            </div>
          )}
          {s.buyInsByMethod.length > 0 && (
            <div>
              <SectionTitle>Buy-ins by payment</SectionTitle>
              <Card className="divide-y divide-line text-sm">
                {s.buyInsByMethod.map((m) => (
                  <div key={m.method} className="flex justify-between px-4 py-2.5">
                    <span>{methodLabel(m.method)}</span>
                    <Money value={m.amount} />
                  </div>
                ))}
              </Card>
            </div>
          )}
        </div>
      )}

      <div className="mt-7 flex flex-col gap-3 sm:flex-row">
        <Button size="lg" icon="copy" className="sm:flex-1" onClick={copy}>
          Copy summary
        </Button>
        {open && (
          <Button size="lg" variant="primary" icon="flag" className="sm:flex-1" loading={ending.busy} onClick={() => void ending.end()}>
            End game
          </Button>
        )}
      </div>
      {!s.allCashedOut && s.players.length > 0 && partners.length > 0 && (
        <p className="mt-3 text-center text-xs text-faint">The partner split appears once everyone has cashed out.</p>
      )}
    </>
  )
}
