import { useCallback, useMemo, useState } from 'react'
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
  TipSheet,
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
import { splitProfit, summarizeGame } from '../lib/accounting'
import type { GameSummary, PlayerLine } from '../lib/accounting'
import { getGameData, listPartnerAccounts, listPlayers, recentDealerNames, updateGame } from '../lib/api'
import type { RecordStamp } from '../lib/actors'
import { useRecordStamps } from '../lib/actors'
import { formatClock, formatDate, money, signedMoney } from '../lib/format'
import { useLoader, useRealtime } from '../lib/hooks'
import { BANK_PAYER, categoryLabel, methodLabel } from '../lib/types'
import type { DealerTip, Expense, Game, PartnerAccount, Transaction } from '../lib/types'

type Tab = 'players' | 'tips' | 'expenses' | 'summary' | 'activity'

type Modal =
  | { kind: 'add-player' }
  | { kind: 'buy-in'; playerId: string; existing?: Transaction }
  | { kind: 'cash-out'; playerId: string; existing?: Transaction }
  | { kind: 'player'; playerId: string }
  | { kind: 'discount'; playerId: string; existing: Transaction }
  | { kind: 'tip'; existing?: DealerTip }
  | { kind: 'expense'; existing?: Expense }
  | { kind: 'edit-game' }

const DEFAULT_QUICK = [200, 500, 1000, 2000]
const TABS: { value: Tab; label: string }[] = [
  { value: 'players', label: 'Players' },
  { value: 'tips', label: 'Tips' },
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

// ---------------------------------------------------------------- page

export function GamePage() {
  const { id = '' } = useParams()
  const { isAdmin } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'players'
  const setTab = (t: Tab) => setParams(t === 'players' ? {} : { tab: t }, { replace: true })

  const game = useLoader(() => getGameData(id), [id])
  const roster = useLoader(listPlayers, [])
  const dealers = useLoader(recentDealerNames, [])
  const partners = useLoader(listPartnerAccounts, [])
  const stamps = useRecordStamps({ gameId: id })
  useRealtime(['games', 'transactions', 'dealer_tips', 'expenses'], game.reload)
  useRealtime(['players'], roster.reload)
  useRealtime(['partners'], partners.reload)

  const [modal, setModal] = useState<Modal | null>(null)
  const close = useCallback(() => setModal(null), [])

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
  }
  const quick = quickAmountsFor(game.data.txs)
  const dealerNames = [
    ...new Set([...summary.tipsByDealer.map((d) => d.name), ...(dealers.data ?? [])].map((n) => n.trim())),
  ].slice(0, 8)
  const activePartners = (partners.data ?? []).filter((p) => p.active)

  return (
    <>
      <GameHeader game={g} summary={summary} isAdmin={isAdmin} onEdit={() => setModal({ kind: 'edit-game' })} onChanged={reload} />

      <div className="mt-5">
        <Tabs value={tab} options={TABS} onChange={setTab} />
      </div>

      {tab === 'players' && <PlayersTab summary={summary} canEdit={canEdit} onModal={setModal} />}
      {tab === 'tips' && <TipsTab game={g} tips={game.data.tips} summary={summary} canEdit={canEdit} onModal={setModal} stamps={stamps} />}
      {tab === 'expenses' && (
        <ExpensesTab expenses={game.data.expenses} summary={summary} canEdit={canEdit} onModal={setModal} stamps={stamps} />
      )}
      {tab === 'summary' && <SummaryTab game={g} summary={summary} partners={activePartners} isAdmin={isAdmin} onChanged={reload} />}
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
        <CashOutSheet game={g} line={lineFor(modal.playerId)!} existing={modal.existing} onClose={close} onSaved={reload} />
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
      {modal?.kind === 'tip' && (
        <TipSheet game={g} existing={modal.existing} dealerNames={dealerNames} onClose={close} onSaved={reload} />
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

function GameHeader({
  game,
  summary: s,
  isAdmin,
  onEdit,
  onChanged,
}: {
  game: Game
  summary: GameSummary
  isAdmin: boolean
  onEdit: () => void
  onChanged: () => void
}) {
  const open = game.status === 'open'
  const final = s.allCashedOut || (!open && s.players.length > 0)
  const { busy, run } = useAction()
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

      <section className={cx('table-felt mt-5 px-5 pb-5 pt-5 text-felt-ink', !open && 'is-closed')}>
        <div className="flex items-center justify-between text-[13px]">
          {open ? (
            <span className="inline-flex items-center gap-2 font-medium">
              <LiveDot /> Live
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 opacity-75">
              <Icon name="lock" className="size-3.5" /> Closed
            </span>
          )}
          {s.players.length > 0 && (
            <span className="opacity-70">
              {s.seatedCount ? `${s.seatedCount} of ${s.players.length} playing` : `${s.players.length} players`}
            </span>
          )}
        </div>

        <div className="mt-4 text-center">
          <div className="text-[13px] opacity-70">{final ? 'Our net profit' : 'Bank'}</div>
          <div className={cx('font-display mt-0.5 text-[64px] leading-none tracking-tight', final && feltTone(s.netProfit))}>
            {final ? signedMoney(s.netProfit) : money(s.bank)}
          </div>
          <div className="mt-2 text-[13px] opacity-60">
            {final
              ? `House take ${money(s.houseTake)} − expenses ${money(s.totalExpenses)}`
              : s.players.length
                ? `${money(s.seatedBuyIns)} still in play`
                : 'Seat the first player when they buy in'}
          </div>
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
          <Figure label="Paid out" value={money(s.totalCashOuts + s.totalDiscounts)} />
          <Figure label="Tips" value={money(s.totalTips)} />
          <Figure label="Expenses" value={money(s.totalExpenses)} />
        </div>
      </section>

      {!open && (
        <div className="mt-3 flex items-center gap-3 rounded-[12px] border border-line bg-surface px-4 py-3 text-sm text-muted">
          <Icon name="lock" className="size-4 shrink-0" />
          <span className="flex-1">This game is closed and locked.{!isAdmin && ' An admin can reopen it.'}</span>
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

// ---------------------------------------------------------------- tips tab

function TipsTab({
  game,
  tips,
  summary: s,
  canEdit,
  onModal,
  stamps,
}: {
  game: Game
  tips: DealerTip[]
  summary: GameSummary
  canEdit: boolean
  onModal: (m: Modal) => void
  stamps: Map<string, RecordStamp>
}) {
  return (
    <>
      {canEdit && (
        <Button variant="primary" size="lg" icon="plus" className="mt-5 w-full" onClick={() => onModal({ kind: 'tip' })}>
          Add dealer tip
        </Button>
      )}

      <Card className="mt-4 grid grid-cols-3 divide-x divide-line">
        <div className="px-4 py-3">
          <div className="text-[12px] text-muted">Tips</div>
          <Money value={s.totalTips} className="font-display text-[26px] leading-tight" />
        </div>
        <div className="px-4 py-3">
          <div className="text-[12px] text-muted">House keeps {pct(game.tip_tax_pct)}</div>
          <Money value={s.tipTax} className="font-display text-[26px] leading-tight text-brass" />
        </div>
        <div className="px-4 py-3">
          <div className="text-[12px] text-muted">Dealers get</div>
          <Money value={s.dealerNet} className="font-display text-[26px] leading-tight" />
        </div>
      </Card>

      {tips.length === 0 ? (
        <Card className="mt-4">
          <Empty title="No tips yet">Chips taken off the table for the dealers. The house keeps the tip tax; the rest is paid out of the bank.</Empty>
        </Card>
      ) : (
        <>
          <SectionTitle>By dealer</SectionTitle>
          <Card className="divide-y divide-line">
            {s.tipsByDealer.map((d) => (
              <div key={d.name} className="flex items-center gap-3 px-3.5 py-3">
                <Avatar name={d.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{d.name}</span>
                  <span className="block text-[13px] text-muted">
                    {d.count} tip{d.count === 1 ? '' : 's'} · <Money value={d.amount} /> − <Money value={d.tax} /> tax
                  </span>
                </span>
                <span className="text-right">
                  <Money value={d.net} className="block text-[15px] font-semibold" />
                  <span className="text-[11px] text-faint">takes home</span>
                </span>
              </div>
            ))}
          </Card>
          <SectionTitle>All tips</SectionTitle>
          <Card className="divide-y divide-line">
            {[...tips].reverse().map((t) => (
              <button
                key={t.id}
                type="button"
                disabled={!canEdit}
                onClick={() => onModal({ kind: 'tip', existing: t })}
                className="flex w-full items-center gap-3 px-4 py-3 text-left enabled:hover:bg-surface-2/60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{t.dealer_name}</span>
                  <span className="block truncate text-xs text-faint tnum">
                    {formatClock(t.created_at)}
                    {stamps.get(t.id)?.createdBy && ` · ${stamps.get(t.id)!.createdBy}`}
                    {t.note && ` · ${t.note}`}
                    {t.updated_at && ` · edited ${formatClock(t.updated_at)}`}
                  </span>
                </span>
                <Money value={t.amount} />
                {canEdit && <Icon name="edit" className="size-3.5 text-faint" />}
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
  return (
    <>
      {canEdit && (
        <Button variant="primary" size="lg" icon="plus" className="mt-5 w-full" onClick={() => onModal({ kind: 'expense' })}>
          Add expense
        </Button>
      )}
      {expenses.length === 0 ? (
        <Card className="mt-4">
          <Empty title="No expenses yet">Food, drinks, venue, dealer pay… charged to a partner’s account or the game bank.</Empty>
        </Card>
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

function Row({ label, value, strong, signed, colored, tone }: { label: string; value: number; strong?: boolean; signed?: boolean; colored?: boolean; tone?: string }) {
  return (
    <div className={cx('flex items-center justify-between px-4 py-2.5', strong && 'bg-surface-2/50')}>
      <span className={strong ? 'font-semibold' : 'text-muted'}>{label}</span>
      <Money value={value} signed={signed} colored={colored} className={cx(strong ? 'font-semibold' : '', tone)} />
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
    `Loss discounts: ${money(s.totalDiscounts)}`,
    `Dealer tips: ${money(s.totalTips)} (house keeps ${money(s.tipTax)})`,
    `Expenses: ${money(s.totalExpenses)}`,
  )
  if (s.allCashedOut) lines.push(`House take: ${money(s.houseTake)}`, `Net profit: ${signedMoney(s.netProfit)}`)
  else lines.push(`Net profit: pending (${s.seatedCount} still playing)`)
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
  isAdmin,
  onChanged,
}: {
  game: Game
  summary: GameSummary
  partners: PartnerAccount[]
  isAdmin: boolean
  onChanged: () => void
}) {
  const { confirm, toast } = useFeedback()
  const navigate = useNavigate()
  const { busy, run } = useAction()
  const open = game.status === 'open'
  const results = [...s.players].sort((a, b) => b.net - a.net)
  const finished = results.filter((p) => p.status === 'out')
  const split = splitProfit(s.netProfit, partners.filter((p) => p.share_pct > 0))

  const closeGame = async () => {
    const sure = await confirm({
      title: 'Close this game?',
      message: (
        <>
          {s.seatedCount > 0 && (
            <p className="mb-2 text-warn">
              {s.seatedCount} player{s.seatedCount === 1 ? ' hasn’t' : 's haven’t'} cashed out yet.
            </p>
          )}
          Closing locks every buy-in, cash-out, tip and expense, and adds the profit to the partners’ accounts.{' '}
          {isAdmin ? 'You can reopen it later.' : 'Only an admin can reopen it.'}
        </>
      ),
      confirmLabel: 'Close game',
    })
    if (sure) await run(() => updateGame(game.id, { status: 'closed' }), 'Game closed').then(onChanged)
  }

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
      {s.allCashedOut && s.rake < 0 && (
        <div className="mt-5 flex items-start gap-3 rounded-[12px] border border-loss/30 bg-loss/[0.07] px-4 py-3 text-sm text-loss">
          <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
          More was paid out than bought in ({money(-s.rake)} short). Double-check the cash-outs and tips.
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
      <Card className="divide-y divide-line overflow-hidden text-sm">
        <Row label="Buy-ins" value={s.totalBuyIns} />
        <Row label="− Paid to players" value={s.totalCashOuts} />
        <Row label={`− Loss discounts (${pct(game.loss_discount_pct)})`} value={s.totalDiscounts} />
        <Row label="− Dealer tips" value={s.totalTips} />
        {s.allCashedOut ? (
          <>
            <Row label="= Rake" value={s.rake} strong />
            <Row label={`+ Tip tax (${pct(game.tip_tax_pct)})`} value={s.tipTax} tone="text-brass" />
            <Row label="= House take" value={s.houseTake} strong />
            <Row label="− Expenses" value={s.totalExpenses} />
            <div className="flex items-center justify-between bg-surface-2/50 px-4 py-4">
              <span className="font-semibold">= Net profit</span>
              <Money value={s.netProfit} signed colored className="font-display text-[32px] leading-none" />
            </div>
          </>
        ) : (
          <>
            <Row label="= Chips held (incl. in play)" value={s.rake} />
            <Row label={`+ Tip tax (${pct(game.tip_tax_pct)})`} value={s.tipTax} tone="text-brass" />
            <Row label="− Expenses" value={s.totalExpenses} />
            <div className="flex items-center justify-between bg-surface-2/50 px-4 py-4">
              <span className="font-semibold">= Net profit</span>
              <span className="text-right">
                <span className="font-display block text-2xl leading-none text-faint">Pending</span>
                {s.seatedCount > 0 && <span className="text-xs text-muted">{s.seatedCount} still playing</span>}
              </span>
            </div>
          </>
        )}
      </Card>

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
          <p className="mt-2 px-1 text-xs text-faint">Added to each partner’s account when the game is closed.</p>
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

      {(s.expensesByCategory.length > 0 || s.buyInsByMethod.length > 0) && (
        <div className="grid gap-x-3 sm:grid-cols-2">
          {s.expensesByCategory.length > 0 && (
            <div>
              <SectionTitle>Expenses by type</SectionTitle>
              <Card className="divide-y divide-line text-sm">
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
          <Button size="lg" variant="primary" icon="lock" className="sm:flex-1" loading={busy} onClick={closeGame}>
            Close game
          </Button>
        )}
      </div>
      {!s.allCashedOut && s.players.length > 0 && partners.length > 0 && (
        <p className="mt-3 text-center text-xs text-faint">The partner split appears once everyone has cashed out.</p>
      )}
    </>
  )
}
