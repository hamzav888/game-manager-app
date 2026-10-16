import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useAuth } from '../auth'
import { ActivityList } from '../components/ActivityList'
import { DivergingColumns, WinLossLegend } from '../components/charts'
import { Icon } from '../components/Icon'
import { Ledger } from '../components/Ledger'
import {
  AmountInput,
  Avatar,
  Badge,
  Button,
  Card,
  Empty,
  ErrorBox,
  Field,
  Figure,
  IconButton,
  Loading,
  Money,
  PercentInput,
  SectionTitle,
  Segmented,
  Sheet,
  Tabs,
  TextInput,
  cx,
  inputCls,
  useAction,
  useFeedback,
} from '../components/ui'
import {
  addPlayerPayment,
  deletePlayer,
  deletePlayerPayment,
  getPlayerLedger,
  getPlayerResults,
  getPlayerTotals,
  listGameTotals,
  listPlayers,
  updatePlayer,
} from '../lib/api'
import { useRecordStamps } from '../lib/actors'
import { formatDate, money, parseAmount, shortDate, signedMoney } from '../lib/format'
import { useLoader, useRealtime } from '../lib/hooks'
import { playerLedger } from '../lib/ledger'
import type { PlayerPayment, PlayerTotals } from '../lib/types'

type DiscountMode = 'house' | 'custom' | 'none'
const discountMode = (pct: number | null): DiscountMode => (pct === null ? 'house' : pct === 0 ? 'none' : 'custom')
const pctLabel = (n: number) => `${Number.isInteger(n) ? n : Number(n.toFixed(2))}%`

/** The player's loss discount: house rate, their own %, or none. */
function DiscountFields({
  mode,
  pct,
  houseRate,
  onMode,
  onPct,
}: {
  mode: DiscountMode
  pct: string
  houseRate: number
  onMode: (m: DiscountMode) => void
  onPct: (v: string) => void
}) {
  return (
    <Field
      label="Loss discount"
      hint={
        mode === 'house'
          ? `Gets the game’s rate (house rule: ${pctLabel(houseRate)} of what they lose).`
          : mode === 'none'
            ? 'Never gets a loss discount, whatever the game’s rate.'
            : 'Gets this % of their loss back at cash-out, in every game. Booked as an expense.'
      }
    >
      <div className="space-y-2">
        <Segmented
          value={mode}
          onChange={onMode}
          options={[
            { value: 'house', label: `House (${pctLabel(houseRate)})` },
            { value: 'custom', label: 'Their own %' },
            { value: 'none', label: 'None' },
          ]}
        />
        {mode === 'custom' && <PercentInput value={pct} onChange={onPct} />}
      </div>
    </Field>
  )
}

function EditPlayerSheet({ player, onClose, onSaved }: { player: PlayerTotals; onClose: () => void; onSaved: () => void }) {
  const { isAdmin, org } = useAuth()
  const { confirm } = useFeedback()
  const navigate = useNavigate()
  const { busy, run } = useAction()
  const [name, setName] = useState(player.name)
  const [phone, setPhone] = useState(player.phone ?? '')
  const [notes, setNotes] = useState(player.notes ?? '')
  const [mode, setMode] = useState<DiscountMode>(discountMode(player.loss_discount_pct))
  const [pct, setPct] = useState(player.loss_discount_pct ? String(player.loss_discount_pct) : '')
  const pctN = Number(pct || 0)
  const pctOk = mode !== 'custom' || (pct.trim() !== '' && Number.isFinite(pctN) && pctN > 0 && pctN <= 100)
  const discount = mode === 'house' ? null : mode === 'none' ? 0 : pctN

  const save = async () => {
    const ok = await run(
      () =>
        updatePlayer(player.id, {
          name: name.trim(),
          phone: phone.trim() || null,
          notes: notes.trim() || null,
          loss_discount_pct: discount,
        }),
      'Player updated',
    )
    if (ok) {
      onSaved()
      onClose()
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Edit player"
      footer={
        <Button variant="primary" size="lg" className="w-full" disabled={!name.trim() || !pctOk} loading={busy} onClick={save}>
          Save changes
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </Field>
        <DiscountFields mode={mode} pct={pct} houseRate={org?.loss_discount_pct ?? 0} onMode={setMode} onPct={setPct} />
        <Field label="Phone (optional)">
          <TextInput type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} />
        </Field>
        <Field label="Notes (optional)">
          <textarea className={cx(inputCls, 'h-24 py-2')} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
        </Field>
      </div>
      {isAdmin && player.games_played === 0 && Math.abs(player.balance) < 0.005 && (
        <button
          type="button"
          className="mt-6 flex items-center gap-1.5 text-sm text-loss/90 hover:text-loss"
          onClick={async () => {
            if (await confirm({ title: `Delete ${player.name}?`, confirmLabel: 'Delete', danger: true }))
              if (await run(() => deletePlayer(player.id), 'Player deleted')) navigate('/players')
          }}
        >
          <Icon name="trash" className="size-4" /> Delete player (admin)
        </button>
      )}
    </Sheet>
  )
}

function PaymentSheet({ player, onClose, onSaved }: { player: PlayerTotals; onClose: () => void; onSaved: () => void }) {
  const { busy, run } = useAction()
  const [direction, setDirection] = useState<PlayerPayment['direction']>(player.balance > 0 ? 'to_player' : 'from_player')
  const [amount, setAmount] = useState(Math.abs(player.balance) > 0.004 ? String(Math.abs(player.balance)) : '')
  const [method, setMethod] = useState<PlayerPayment['method']>('cash')
  const [note, setNote] = useState('')
  const value = parseAmount(amount)

  const save = async () => {
    const ok = await run(
      () => addPlayerPayment({ player_id: player.id, direction, amount: value, method, note: note.trim() || null }),
      direction === 'from_player' ? `${player.name} paid ${money(value)}` : `Paid ${player.name} ${money(value)}`,
    )
    if (ok) {
      onSaved()
      onClose()
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Record a payment"
      subtitle={player.name}
      footer={
        <Button variant="primary" size="lg" className="w-full" disabled={!(value > 0)} loading={busy} onClick={save}>
          {direction === 'from_player' ? `${player.name} paid ${value > 0 ? money(value) : ''}` : `We paid ${player.name} ${value > 0 ? money(value) : ''}`}
        </Button>
      }
    >
      <div className="space-y-4">
        <Segmented
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'from_player', label: 'They paid us' },
            { value: 'to_player', label: 'We paid them' },
          ]}
        />
        <AmountInput value={amount} onChange={setAmount} autoFocus />
        <Field label="Method">
          <Segmented
            value={method}
            onChange={setMethod}
            options={[
              { value: 'cash', label: 'Cash' },
              { value: 'transfer', label: 'Transfer' },
            ]}
          />
        </Field>
        <Field label="Note (optional)">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </Field>
      </div>
    </Sheet>
  )
}

type View = 'games' | 'ledger' | 'history'

export function PlayerPage() {
  const { id = '' } = useParams()
  const { org, isOwner } = useAuth()
  const navigate = useNavigate()
  const { run } = useAction()
  const [view, setView] = useState<View>('games')
  const [editing, setEditing] = useState(false)
  const [paying, setPaying] = useState(false)

  const totals = useLoader(() => getPlayerTotals(id), [id])
  const results = useLoader(() => getPlayerResults(id), [id])
  const account = useLoader(() => getPlayerLedger(id), [id])
  const stampRows = useMemo(() => (account.data ? [...account.data.txs, ...account.data.payments] : []), [account.data])
  const stamps = useRecordStamps({ playerId: id }, stampRows)
  const roster = useLoader(listPlayers, [])
  const games = useLoader(listGameTotals, [])
  const reloadAll = () => {
    void totals.reload()
    void results.reload()
    void account.reload()
  }
  useRealtime(['players', 'transactions', 'games', 'player_payments'], reloadAll)

  const playersById = useMemo(() => new Map((roster.data ?? []).map((p) => [p.id, p] as const)), [roster.data])
  const gameNames = useMemo(() => new Map((games.data ?? []).map((g) => [g.id, g.name] as const)), [games.data])

  const chart = useMemo(
    () =>
      (results.data ?? [])
        .filter((r) => r.game_status === 'closed')
        .slice(0, 16)
        .reverse()
        .map((r) => ({
          key: r.game_id,
          label: shortDate(r.game_date),
          title: `${r.game_name} · ${shortDate(r.game_date)}`,
          value: r.net,
          onOpen: () => navigate(`/games/${r.game_id}`),
        })),
    [results.data, navigate],
  )

  const best = useMemo(() => {
    const closed = (results.data ?? []).filter((r) => r.game_status === 'closed')
    if (!closed.length) return null
    return {
      win: Math.max(...closed.map((r) => r.net)),
      loss: Math.min(...closed.map((r) => r.net)),
      winning: closed.filter((r) => r.net > 0).length,
      count: closed.length,
    }
  }, [results.data])

  const ledgerEntries = useMemo(
    () => (account.data && totals.data ? playerLedger(totals.data.name, account.data.txs, account.data.payments, stamps) : undefined),
    [account.data, totals.data, stamps],
  )

  if (totals.error) return <ErrorBox error={totals.error} onRetry={totals.reload} />
  if (totals.data === undefined) return <Loading />
  const p = totals.data
  if (!p)
    return (
      <Card>
        <Empty icon="users" title="Player not found">
          <Link to="/players" className="underline">
            Back to players
          </Link>
        </Empty>
      </Card>
    )

  const owes = p.balance < -0.004
  const credit = p.balance > 0.004
  const houseRate = org?.loss_discount_pct ?? 0

  return (
    <>
      <div className="flex items-center gap-3">
        <Link to="/players" className="-ml-2 rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Back to players">
          <Icon name="back" />
        </Link>
        <Avatar name={p.name} size={46} />
        <div className="min-w-0 flex-1">
          <h1 className="font-display truncate text-[32px] leading-none">{p.name}</h1>
          <div className="mt-1 truncate text-[13px] text-muted">
            {p.phone || 'No phone'} · regular since {shortDate(p.created_at)}
          </div>
        </div>
        <IconButton icon="edit" label="Edit player" onClick={() => setEditing(true)} />
      </div>
      {p.notes && <p className="mt-4 border-l-2 border-brass/50 pl-3 text-sm italic text-muted">{p.notes}</p>}

      <section className="table-felt mt-5 px-5 pb-5 pt-6 text-center text-felt-ink">
        <div className="text-[13px] opacity-70">All-time result</div>
        <div
          className={cx(
            'font-display mt-1 text-[60px] leading-none tracking-tight',
            p.net > 0.004 ? 'text-win-felt' : p.net < -0.004 ? 'text-loss-felt' : '',
          )}
        >
          {signedMoney(p.net)}
        </div>
        <div className="mt-2 text-[12px] opacity-55">ended games only · includes loss discounts</div>
        <div className="mt-5 grid grid-cols-3 gap-3 border-t border-white/10 pt-4 text-left">
          <Figure label="Games" value={p.games_played} />
          <Figure label="Bought in" value={money(p.total_buy_ins)} />
          <Figure label="Paid out" value={money(p.total_cash_outs + p.total_discounts)} />
          {best && (
            <>
              <Figure label="Best night" value={signedMoney(best.win)} />
              <Figure label="Worst night" value={signedMoney(best.loss)} />
              <Figure label="Winning nights" value={`${best.winning} of ${best.count}`} />
            </>
          )}
        </div>
      </section>

      <button
        type="button"
        onClick={() => setView('ledger')}
        className={cx(
          'mt-3 flex w-full items-center gap-3 rounded-[14px] border px-4 py-3.5 text-left transition-colors',
          owes ? 'border-loss/30 bg-loss/[0.05]' : credit ? 'border-brass/30 bg-brass/[0.05]' : 'border-line bg-surface',
        )}
      >
        <Icon name="wallet" className={cx('size-5', owes ? 'text-loss' : credit ? 'text-brass' : 'text-muted')} />
        <span className="flex-1">
          <span className="block text-[13px] text-muted">Account</span>
          <span className="block font-medium">{owes ? 'Owes the house' : credit ? 'House owes them' : 'All square'}</span>
        </span>
        <Money value={Math.abs(p.balance)} className={cx('font-display text-[28px] leading-none', owes && 'text-loss', credit && 'text-brass')} />
      </button>

      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-3 flex w-full items-center gap-3 rounded-[14px] border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-[#3a3a33]"
      >
        <Icon name="percent" className={cx('size-5', p.loss_discount_pct === 0 ? 'text-muted' : 'text-brass')} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-muted">
            Loss discount · {p.loss_discount_pct === null ? 'house rate' : p.loss_discount_pct === 0 ? 'turned off' : 'their own rate'}
          </span>
          <span className="block truncate font-medium">
            {p.loss_discount_pct === 0 ? 'None' : `${pctLabel(p.loss_discount_pct ?? houseRate)} back on losses`}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <Money value={p.total_discounts} className="block font-display text-[22px] leading-none text-brass" />
          <span className="text-[11px] text-faint">given so far</span>
        </span>
      </button>

      <div className="mt-5">
        <Tabs
          value={view}
          onChange={setView}
          options={[
            { value: 'games', label: 'Games' },
            { value: 'ledger', label: 'Ledger' },
            // the history is for the app owner only
            ...(isOwner ? [{ value: 'history' as const, label: 'Change history' }] : []),
          ]}
        />
      </div>

      {view === 'games' && (
        <>
          {chart.length > 1 && (
            <>
              <SectionTitle action={<WinLossLegend />}>Result by night</SectionTitle>
              <Card className="px-3 pb-2 pt-3">
                <DivergingColumns data={chart} label={`${p.name}'s result in each ended game`} height={170} />
              </Card>
            </>
          )}
          <SectionTitle>Every game</SectionTitle>
          {results.error ? (
            <ErrorBox error={results.error} onRetry={results.reload} />
          ) : !results.data ? (
            <Loading />
          ) : results.data.length === 0 ? (
            <Card>
              <Empty title="Hasn’t played yet" />
            </Card>
          ) : (
            <Card className="divide-y divide-line overflow-hidden">
              {results.data.map((r) => (
                <Link key={r.game_id} to={`/games/${r.game_id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/60">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{r.game_name}</span>
                      {r.game_status === 'open' && <Badge tone="live">Live</Badge>}
                    </div>
                    <div className="truncate text-[13px] text-muted">
                      {formatDate(r.game_date)} · in <Money value={r.buy_ins} />
                      {r.buy_in_count > 1 && ` (${r.buy_in_count}×)`} · out <Money value={r.cash_outs} />
                      {r.discounts > 0 && (
                        <>
                          {' '}
                          + <Money value={r.discounts} /> disc.
                        </>
                      )}
                    </div>
                  </div>
                  {r.game_status === 'open' ? (
                    <span className="text-sm text-muted">in progress</span>
                  ) : (
                    <Money value={r.net} signed colored className="font-semibold" />
                  )}
                </Link>
              ))}
            </Card>
          )}
        </>
      )}

      {view === 'ledger' && (
        <div className="mt-5">
          <Ledger
            name={p.name}
            entries={ledgerEntries}
            exportName={p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}
            emptyText={`Nothing has been recorded with ${p.name} yet.`}
            actions={
              <Button size="sm" variant="primary" icon="wallet" onClick={() => setPaying(true)}>
                Record a payment
              </Button>
            }
            onDelete={(row) => run(() => deletePlayerPayment(row.id), 'Payment deleted').then((ok) => (reloadAll(), ok))}
          />
          <p className="mt-1 px-1 text-xs leading-relaxed text-faint">
            Every buy-in, cash-out and payment with {p.name}. Cash and transfers settle on the spot; anything “On account” stays on the
            balance until a payment settles it.
          </p>
        </div>
      )}

      {view === 'history' && isOwner && (
        <div className="mt-5">
          <ActivityList filter={{ playerId: p.id }} playersById={playersById} gameNames={gameNames} live />
        </div>
      )}

      {editing && <EditPlayerSheet player={p} onClose={() => setEditing(false)} onSaved={() => void totals.reload()} />}
      {paying && <PaymentSheet player={p} onClose={() => setPaying(false)} onSaved={reloadAll} />}
    </>
  )
}
