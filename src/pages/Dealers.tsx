import { useMemo, useState } from 'react'
import { Link, NavLink, useNavigate, useParams } from 'react-router'
import { useAuth } from '../auth'
import { ActivityList } from '../components/ActivityList'
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
  PageHeader,
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
  addDealerPayment,
  createDealer,
  deleteDealer,
  deleteDealerPayment,
  getDealerAccount,
  getDealerLedger,
  listDealerAccounts,
  listPlayers,
  updateDealer,
} from '../lib/api'
import { useRecordStamps } from '../lib/actors'
import { formatDate, money, parseAmount, shortDate } from '../lib/format'
import { useLoader, useRealtime } from '../lib/hooks'
import { dealerLedger } from '../lib/ledger'
import type { DealerAccount, DealerPayment } from '../lib/types'

/** Players / Dealers switch at the top of the People section. */
export function PeopleTabs() {
  const item = ({ isActive }: { isActive: boolean }) =>
    cx('flex-1 rounded-[9px] px-3 py-1.5 text-center text-sm transition-colors', isActive ? 'bg-surface-2 font-medium text-ink' : 'text-muted hover:text-ink')
  return (
    <div className="mb-5 flex rounded-[12px] border border-line bg-bg p-1">
      <NavLink to="/players" className={item}>
        Players
      </NavLink>
      <NavLink to="/dealers" className={item}>
        Dealers
      </NavLink>
    </div>
  )
}

// ---------------------------------------------------------------- list

export function DealersPage() {
  const navigate = useNavigate()
  const { data, error, reload } = useLoader(listDealerAccounts, [])
  useRealtime(['dealers', 'dealer_tips', 'dealer_payments', 'expenses', 'games'], reload)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const { busy, run } = useAction()

  const owed = (data ?? []).reduce((s, d) => s + (d.balance > 0 ? Math.round(d.balance * 100) : 0), 0) / 100
  const rake = (data ?? []).reduce((s, d) => s + Math.round(d.total_rake * 100), 0) / 100
  const sorted = useMemo(
    () => [...(data ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || (b.last_dealt ?? '').localeCompare(a.last_dealt ?? '') || a.name.localeCompare(b.name)),
    [data],
  )

  const add = async () => {
    let id = ''
    const ok = await run(async () => {
      id = (await createDealer(name)).id
    }, 'Dealer added')
    if (ok) navigate(`/dealers/${id}`)
  }

  return (
    <>
      <PeopleTabs />
      <PageHeader
        title="Dealers"
        sub={data ? `${data.length} dealer${data.length === 1 ? '' : 's'}` : undefined}
        action={
          <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
            Add
          </Button>
        }
      />

      {data && data.length > 0 && (
        <Card className="mt-5 grid grid-cols-2 divide-x divide-line">
          <div className="px-4 py-3.5">
            <div className="text-[12px] text-muted">Owed to dealers</div>
            <Money value={owed} className={cx('font-display text-[30px] leading-tight', owed > 0 && 'text-brass')} />
          </div>
          <div className="px-4 py-3.5">
            <div className="text-[12px] text-muted">Rake they’ve collected</div>
            <Money value={rake} className="font-display text-[30px] leading-tight" />
          </div>
        </Card>
      )}

      <div className="mt-4">
        {error ? (
          <ErrorBox error={error} onRetry={reload} />
        ) : !data ? (
          <Loading />
        ) : sorted.length === 0 ? (
          <Card>
            <Empty icon="chip" title="No dealers yet">
              A dealer gets an account the first time they report a round, or add them here.
            </Empty>
          </Card>
        ) : (
          <Card className="divide-y divide-line overflow-hidden">
            {sorted.map((d) => (
              <Link key={d.id} to={`/dealers/${d.id}`} className={cx('flex items-center gap-3 px-4 py-3 hover:bg-surface-2/60', !d.active && 'opacity-60')}>
                <Avatar name={d.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{d.name}</span>
                    {!d.active && <Badge>Inactive</Badge>}
                  </div>
                  <div className="truncate text-[13px] text-muted">
                    {d.rounds} round{d.rounds === 1 ? '' : 's'}
                    {d.last_dealt && ` · last ${shortDate(d.last_dealt)}`}
                    {d.balance > 0.004 && (
                      <>
                        {' · '}
                        <span className="text-brass">
                          owed <Money value={d.balance} />
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <Money value={d.total_rake} className="text-[15px] font-semibold" />
                  <div className="text-[11px] text-faint">rake collected</div>
                </div>
              </Link>
            ))}
          </Card>
        )}
      </div>

      <Sheet
        open={adding}
        onClose={() => setAdding(false)}
        title="Add dealer"
        footer={
          <Button variant="primary" size="lg" className="w-full" disabled={!name.trim()} loading={busy} onClick={add}>
            Add dealer
          </Button>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) void add()
          }}
        >
          <Field label="Name">
            <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </Field>
        </form>
      </Sheet>
    </>
  )
}

// ---------------------------------------------------------------- sheets

function EditDealerSheet({ dealer, onClose, onSaved }: { dealer: DealerAccount; onClose: () => void; onSaved: () => void }) {
  const { isAdmin } = useAuth()
  const { confirm } = useFeedback()
  const navigate = useNavigate()
  const { busy, run } = useAction()
  const [name, setName] = useState(dealer.name)
  const [phone, setPhone] = useState(dealer.phone ?? '')
  const [notes, setNotes] = useState(dealer.notes ?? '')
  const [active, setActive] = useState(dealer.active ? 'yes' : 'no')

  const save = async () => {
    const ok = await run(
      () => updateDealer(dealer.id, { name: name.trim(), phone: phone.trim() || null, notes: notes.trim() || null, active: active === 'yes' }),
      'Dealer updated',
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
      title="Edit dealer"
      footer={
        <Button variant="primary" size="lg" className="w-full" disabled={!name.trim()} loading={busy} onClick={save}>
          Save changes
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </Field>
        <Field label="Phone (optional)">
          <TextInput type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} />
        </Field>
        <Field label="Notes (optional)">
          <textarea className={cx(inputCls, 'h-24 py-2')} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
        </Field>
        <Field label="Status" hint="Inactive dealers stay on record but aren’t suggested for new rounds.">
          <Segmented
            value={active}
            onChange={setActive}
            options={[
              { value: 'yes', label: 'Active' },
              { value: 'no', label: 'Inactive' },
            ]}
          />
        </Field>
      </div>
      {isAdmin && dealer.rounds === 0 && Math.abs(dealer.balance) < 0.005 && dealer.dealer_pay === 0 && (
        <button
          type="button"
          className="mt-6 flex items-center gap-1.5 text-sm text-loss/90 hover:text-loss"
          onClick={async () => {
            if (await confirm({ title: `Delete ${dealer.name}?`, confirmLabel: 'Delete', danger: true }))
              if (await run(() => deleteDealer(dealer.id), 'Dealer deleted')) navigate('/dealers')
          }}
        >
          <Icon name="trash" className="size-4" /> Delete dealer (admin)
        </button>
      )}
    </Sheet>
  )
}

function DealerPaymentSheet({ dealer, onClose, onSaved }: { dealer: DealerAccount; onClose: () => void; onSaved: () => void }) {
  const { busy, run } = useAction()
  const [direction, setDirection] = useState<DealerPayment['direction']>(dealer.balance < -0.004 ? 'from_dealer' : 'to_dealer')
  const [amount, setAmount] = useState(Math.abs(dealer.balance) > 0.004 ? String(Math.abs(dealer.balance)) : '')
  const [method, setMethod] = useState<DealerPayment['method']>('cash')
  const [note, setNote] = useState('')
  const value = parseAmount(amount)

  const save = async () => {
    const ok = await run(
      () => addDealerPayment({ dealer_id: dealer.id, direction, amount: value, method, note: note.trim() || null }),
      direction === 'to_dealer' ? `Paid ${dealer.name} ${money(value)}` : `${dealer.name} paid ${money(value)}`,
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
      subtitle={dealer.name}
      footer={
        <Button variant="primary" size="lg" className="w-full" disabled={!(value > 0)} loading={busy} onClick={save}>
          {direction === 'to_dealer' ? `We paid ${dealer.name} ${value > 0 ? money(value) : ''}` : `${dealer.name} paid ${value > 0 ? money(value) : ''}`}
        </Button>
      }
    >
      <div className="space-y-4">
        <Segmented
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'to_dealer', label: 'We paid them' },
            { value: 'from_dealer', label: 'They paid us' },
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

// ---------------------------------------------------------------- one dealer

type View = 'rounds' | 'ledger' | 'history'

export function DealerPage() {
  const { id = '' } = useParams()
  const { isOwner } = useAuth()
  const { run } = useAction()
  const [view, setView] = useState<View>('rounds')
  const [editing, setEditing] = useState(false)
  const [paying, setPaying] = useState(false)

  const account = useLoader(() => getDealerAccount(id), [id])
  const ledger = useLoader(() => getDealerLedger(id), [id])
  const roster = useLoader(listPlayers, [])
  const reloadAll = () => {
    void account.reload()
    void ledger.reload()
  }
  useRealtime(['dealers', 'dealer_tips', 'dealer_payments', 'expenses', 'games'], reloadAll)

  const stampRows = useMemo(() => (ledger.data ? [...ledger.data.rounds, ...ledger.data.pay, ...ledger.data.payments] : []), [ledger.data])
  const stamps = useRecordStamps({ dealerId: id }, stampRows)
  const playersById = useMemo(() => new Map((roster.data ?? []).map((p) => [p.id, p] as const)), [roster.data])
  const d = account.data

  const byGame = useMemo(() => {
    const games = new Map<string, { id: string; name: string; date: string; rounds: number; rake: number; tips: number }>()
    for (const r of ledger.data?.rounds ?? []) {
      const g = games.get(r.game_id) ?? { id: r.game_id, name: r.game_name, date: r.game_date, rounds: 0, rake: 0, tips: 0 }
      g.rounds += 1
      g.rake = Math.round((g.rake + r.rake) * 100) / 100
      g.tips = Math.round((g.tips + r.amount) * 100) / 100
      games.set(r.game_id, g)
    }
    return [...games.values()].sort((a, b) => b.date.localeCompare(a.date))
  }, [ledger.data])

  const entries = useMemo(
    () => (d && ledger.data ? dealerLedger(d.name, ledger.data.rounds, ledger.data.pay, ledger.data.payments, stamps) : undefined),
    [d, ledger.data, stamps],
  )

  if (account.error) return <ErrorBox error={account.error} onRetry={account.reload} />
  if (account.data === undefined) return <Loading />
  if (!d)
    return (
      <Card>
        <Empty icon="chip" title="Dealer not found">
          <Link to="/dealers" className="underline">
            Back to dealers
          </Link>
        </Empty>
      </Card>
    )

  const owedToThem = d.balance > 0.004
  const theyOwe = d.balance < -0.004

  return (
    <>
      <div className="flex items-center gap-3">
        <Link to="/dealers" className="-ml-2 rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Back to dealers">
          <Icon name="back" />
        </Link>
        <Avatar name={d.name} size={46} />
        <div className="min-w-0 flex-1">
          <h1 className="font-display truncate text-[32px] leading-none">{d.name}</h1>
          <div className="mt-1 truncate text-[13px] text-muted">
            Dealer · {d.phone || 'No phone'}
            {!d.active && ' · inactive'}
          </div>
        </div>
        <IconButton icon="edit" label="Edit dealer" onClick={() => setEditing(true)} />
      </div>
      {d.notes && <p className="mt-4 border-l-2 border-brass/50 pl-3 text-sm italic text-muted">{d.notes}</p>}

      <section className="table-felt mt-5 px-5 pb-5 pt-6 text-center text-felt-ink">
        <div className="text-[13px] opacity-70">Rake collected for the house</div>
        <div className="font-display mt-1 text-[60px] leading-none tracking-tight">{money(d.total_rake)}</div>
        <div className="mt-2 text-[12px] opacity-55">
          {d.rounds} round{d.rounds === 1 ? '' : 's'} over {d.games} game{d.games === 1 ? '' : 's'}
          {d.last_dealt && ` · last dealt ${shortDate(d.last_dealt)}`}
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3 border-t border-white/10 pt-4 text-left">
          <Figure label="Tips" value={money(d.total_tips)} />
          <Figure label="Tip tax kept" value={money(d.tip_tax)} />
          <Figure label="Earned (after tax)" value={money(d.net_tips + d.dealer_pay)} />
        </div>
      </section>

      <button
        type="button"
        onClick={() => setView('ledger')}
        className={cx(
          'mt-3 flex w-full items-center gap-3 rounded-[14px] border px-4 py-3.5 text-left transition-colors',
          owedToThem ? 'border-brass/30 bg-brass/[0.05]' : theyOwe ? 'border-loss/30 bg-loss/[0.05]' : 'border-line bg-surface',
        )}
      >
        <Icon name="wallet" className={cx('size-5', owedToThem ? 'text-brass' : theyOwe ? 'text-loss' : 'text-muted')} />
        <span className="flex-1">
          <span className="block text-[13px] text-muted">Account</span>
          <span className="block font-medium">{owedToThem ? 'House owes them' : theyOwe ? 'Owes the house' : 'All square'}</span>
        </span>
        <Money value={Math.abs(d.balance)} className={cx('font-display text-[28px] leading-none', owedToThem && 'text-brass', theyOwe && 'text-loss')} />
      </button>

      <div className="mt-5">
        <Tabs
          value={view}
          onChange={setView}
          options={[
            { value: 'rounds', label: 'Games' },
            { value: 'ledger', label: 'Ledger' },
            // the history is for the app owner only
            ...(isOwner ? [{ value: 'history' as const, label: 'Change history' }] : []),
          ]}
        />
      </div>

      {view === 'rounds' &&
        (ledger.error ? (
          <div className="mt-5">
            <ErrorBox error={ledger.error} onRetry={ledger.reload} />
          </div>
        ) : !ledger.data ? (
          <Loading />
        ) : byGame.length === 0 ? (
          <Card className="mt-5">
            <Empty title="No rounds yet">Rounds show up here once {d.name} reports one in a game.</Empty>
          </Card>
        ) : (
          <>
            <SectionTitle>Every game</SectionTitle>
            <Card className="divide-y divide-line overflow-hidden">
              {byGame.map((g) => (
                <Link key={g.id} to={`/games/${g.id}?tab=rounds`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/60">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{g.name}</div>
                    <div className="truncate text-[13px] text-muted">
                      {formatDate(g.date)} · {g.rounds} round{g.rounds === 1 ? '' : 's'} · tips <Money value={g.tips} />
                    </div>
                  </div>
                  <span className="text-right">
                    <Money value={g.rake} className="block font-semibold text-brass" />
                    <span className="text-[11px] text-faint">rake</span>
                  </span>
                </Link>
              ))}
            </Card>
          </>
        ))}

      {view === 'ledger' && (
        <div className="mt-5">
          <Ledger
            name={d.name}
            entries={entries}
            exportName={`dealer-${d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
            emptyText={`Nothing has been recorded with ${d.name} yet.`}
            actions={
              <Button size="sm" variant="primary" icon="wallet" onClick={() => setPaying(true)}>
                Record a payment
              </Button>
            }
            onDelete={(row) => run(() => deleteDealerPayment(row.id), 'Payment deleted').then((ok) => (reloadAll(), ok))}
          />
          <p className="mt-1 px-1 text-xs leading-relaxed text-faint">
            Each round owes {d.name} their tips minus the tip tax; it’s settled on the spot unless the round says the tips are owed. Dealer pay
            and payments either way are here too. The rake they collect is the house’s, so it doesn’t change the balance.
          </p>
        </div>
      )}

      {view === 'history' && isOwner && (
        <div className="mt-5">
          <ActivityList filter={{ dealerId: d.id }} playersById={playersById} dealerNames={new Map([[d.id, d.name]])} live />
        </div>
      )}

      {editing && <EditDealerSheet dealer={d} onClose={() => setEditing(false)} onSaved={reloadAll} />}
      {paying && <DealerPaymentSheet dealer={d} onClose={() => setPaying(false)} onSaved={reloadAll} />}
    </>
  )
}
