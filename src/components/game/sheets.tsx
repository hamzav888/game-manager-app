import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../../auth'
import { lossDiscountDue } from '../../lib/accounting'
import type { PlayerLine } from '../../lib/accounting'
import {
  addExpense,
  addTip,
  addTx,
  createPlayer,
  deleteExpense,
  deleteGame,
  deleteTip,
  deleteTx,
  updateExpense,
  updateGame,
  updateTip,
  updateTx,
} from '../../lib/api'
import type { RecordStamp } from '../../lib/actors'
import { formatClock, formatStamp, money, parseAmount } from '../../lib/format'
import { EXPENSE_CATEGORIES, PAY_METHODS, TIP_METHODS, methodLabel } from '../../lib/types'
import type { Dealer, DealerTip, Expense, ExpenseCategory, Game, PartnerAccount, PayMethod, Player, TipMethod, Transaction } from '../../lib/types'
import { Icon } from '../Icon'
import {
  AmountInput,
  Avatar,
  Button,
  Chip,
  Field,
  Money,
  PercentInput,
  Segmented,
  Sheet,
  TextInput,
  cx,
  inputCls,
  useAction,
  useFeedback,
} from '../ui'
import { ChipCounter } from './ChipCounter'

const amountStr = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2))
const pctStr = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2))))

function QuickAmounts({ amounts, value, onPick }: { amounts: number[]; value: string; onPick: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {amounts.map((a) => (
        <Chip key={a} active={parseAmount(value) === a} onClick={() => onPick(amountStr(a))}>
          {money(a)}
        </Chip>
      ))}
    </div>
  )
}

function MethodField({ label, value, onChange, accountHint }: { label: string; value: PayMethod; onChange: (m: PayMethod) => void; accountHint: string }) {
  return (
    <Field label={label} hint={value === 'account' ? accountHint : undefined}>
      <Segmented value={value === 'other' ? 'cash' : value} options={PAY_METHODS} onChange={onChange} />
    </Field>
  )
}

function DeleteRow({ label, onDelete }: { label: string; onDelete: () => Promise<boolean> }) {
  const { confirm } = useFeedback()
  return (
    <button
      type="button"
      className="mt-6 flex items-center gap-1.5 text-sm text-loss/90 hover:text-loss"
      onClick={async () => {
        if (await confirm({ title: `Delete ${label}?`, message: 'This is recorded in the history log.', confirmLabel: 'Delete', danger: true }))
          await onDelete()
      }}
    >
      <Icon name="trash" className="size-4" /> Delete {label}
    </button>
  )
}

/** Run an action; on success refresh and close. */
function useSave(onSaved: () => void, onClose: () => void) {
  const { busy, run } = useAction()
  const save = async (fn: () => Promise<unknown>, msg: string) => {
    const ok = await run(fn, msg)
    if (ok) {
      onSaved()
      onClose()
    }
    return ok
  }
  return { busy, save }
}

// ---------------------------------------------------------------- Buy-in

export function BuyInSheet({
  game,
  player,
  existing,
  quickAmounts,
  onClose,
  onSaved,
}: {
  game: Game
  player: { id: string; name: string }
  existing?: Transaction
  quickAmounts: number[]
  onClose: () => void
  onSaved: () => void
}) {
  const { busy, save } = useSave(onSaved, onClose)
  const [amount, setAmount] = useState(existing ? amountStr(existing.amount) : '')
  const [method, setMethod] = useState<PayMethod>(existing?.method ?? 'cash')
  const [note, setNote] = useState(existing?.note ?? '')
  const value = parseAmount(amount)
  const valid = value > 0

  const submit = () =>
    save(
      () =>
        existing
          ? updateTx(existing.id, { amount: value, method, note: note.trim() || null })
          : addTx({ game_id: game.id, player_id: player.id, kind: 'buy_in', amount: value, method, note: note.trim() || null }),
      existing ? 'Buy-in updated' : `${player.name} bought in for ${money(value)}`,
    )

  return (
    <Sheet
      open
      onClose={onClose}
      title={existing ? 'Edit buy-in' : 'Buy-in'}
      subtitle={player.name}
      footer={
        <Button variant="primary" size="lg" className="w-full" disabled={!valid} loading={busy} onClick={submit}>
          {existing ? 'Save changes' : valid ? `Record ${money(value)} buy-in` : 'Record buy-in'}
        </Button>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) void submit()
        }}
      >
        <AmountInput value={amount} onChange={setAmount} autoFocus />
        <QuickAmounts amounts={quickAmounts} value={amount} onPick={setAmount} />
        <MethodField label="Paid with" value={method} onChange={setMethod} accountHint="Goes on the player’s account — they owe it until they pay." />
        <Field label="Note (optional)">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </Field>
      </form>
      {existing && <DeleteRow label="this buy-in" onDelete={() => save(() => deleteTx(existing.id), 'Buy-in deleted')} />}
    </Sheet>
  )
}

// ---------------------------------------------------------------- Add player

export function AddPlayerSheet({
  game,
  roster,
  inGame,
  quickAmounts,
  onClose,
  onSaved,
}: {
  game: Game
  roster: Player[]
  inGame: Set<string>
  quickAmounts: number[]
  onClose: () => void
  onSaved: () => void
}) {
  const { busy, save } = useSave(onSaved, onClose)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<{ id: string | null; name: string } | null>(null)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PayMethod>('cash')

  const q = query.trim().toLowerCase()
  const available = useMemo(
    () => roster.filter((p) => !inGame.has(p.id) && (!q || p.name.toLowerCase().includes(q))).slice(0, 60),
    [roster, inGame, q],
  )
  const exact = roster.find((p) => p.name.trim().toLowerCase() === q)
  const value = parseAmount(amount)

  const submit = () =>
    picked &&
    save(async () => {
      const id = picked.id ?? (await createPlayer(picked.name)).id
      await addTx({ game_id: game.id, player_id: id, kind: 'buy_in', amount: value, method, note: null })
    }, `${picked.name} bought in for ${money(value)}`)

  if (!picked) {
    return (
      <Sheet open onClose={onClose} title="Seat a player">
        <div className="relative">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <TextInput
            autoFocus
            placeholder="Search or type a new name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={60}
            className="pl-9"
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              if (available.length === 1) setPicked({ id: available[0].id, name: available[0].name })
              else if (q && !exact) setPicked({ id: null, name: query.trim() })
            }}
          />
        </div>
        <div className="mt-3 space-y-0.5">
          {q && !exact && (
            <button
              type="button"
              onClick={() => setPicked({ id: null, name: query.trim() })}
              className="flex w-full items-center gap-3 rounded-[12px] border border-dashed border-brass/40 px-3 py-2.5 text-left text-brass hover:bg-brass/[0.06]"
            >
              <span className="inline-flex size-9 items-center justify-center rounded-full bg-brass/15">
                <Icon name="plus" className="size-4" />
              </span>
              New player “{query.trim()}”
            </button>
          )}
          {exact && inGame.has(exact.id) && (
            <p className="px-1 py-2 text-sm text-muted">{exact.name} is already seated — use Buy-in on their row.</p>
          )}
          {available.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPicked({ id: p.id, name: p.name })}
              className="flex w-full items-center gap-3 rounded-[12px] px-2 py-2 text-left hover:bg-surface-2"
            >
              <Avatar name={p.name} />
              <span className="truncate">{p.name}</span>
            </button>
          ))}
          {!q && available.length === 0 && <p className="px-1 py-6 text-center text-sm text-muted">Type a name to add your first player.</p>}
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={picked.name}
      subtitle={
        <button type="button" className="underline underline-offset-2" onClick={() => setPicked(null)}>
          {picked.id ? 'Choose someone else' : 'New player · change'}
        </button>
      }
      footer={
        <Button variant="primary" size="lg" className="w-full" disabled={!(value > 0)} loading={busy} onClick={() => void submit()}>
          {value > 0 ? `Seat with ${money(value)}` : 'Enter the buy-in'}
        </Button>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (value > 0) void submit()
        }}
      >
        <AmountInput value={amount} onChange={setAmount} autoFocus />
        <QuickAmounts amounts={quickAmounts} value={amount} onPick={setAmount} />
        <MethodField label="Paid with" value={method} onChange={setMethod} accountHint="Goes on the player’s account — they owe it until they pay." />
      </form>
    </Sheet>
  )
}

// ---------------------------------------------------------------- Cash-out (+ loss discount)

export function CashOutSheet({
  game,
  line,
  discountPct,
  existing,
  onClose,
  onSaved,
}: {
  game: Game
  line: PlayerLine
  /** this player's loss discount % (their own rate, else the game's) */
  discountPct: number
  existing?: Transaction
  onClose: () => void
  onSaved: () => void
}) {
  const { busy, save } = useSave(onSaved, onClose)
  const [amount, setAmount] = useState(existing ? amountStr(existing.amount) : '')
  const [method, setMethod] = useState<PayMethod>(existing?.method ?? 'cash')
  const [note, setNote] = useState(existing?.note ?? '')
  const [counting, setCounting] = useState(false)
  const [giveDiscount, setGiveDiscount] = useState(true)
  const value = parseAmount(amount)
  const valid = value >= 0 && amount.trim() !== ''

  const replacing = existing?.amount ?? 0
  const due = valid ? lossDiscountDue(line, value, discountPct, replacing) : 0
  const ownRate = discountPct !== game.loss_discount_pct
  const discount = giveDiscount ? due : 0
  const otherCashOuts = line.cashOuts - replacing
  const net = (valid ? value : 0) + otherCashOuts + line.discounts + discount - line.buyIns

  const submit = () =>
    save(
      async () => {
        const n = note.trim() || null
        if (existing) await updateTx(existing.id, { amount: value, method, note: n })
        else await addTx({ game_id: game.id, player_id: line.playerId, kind: 'cash_out', amount: value, method, note: n })
        if (discount > 0)
          await addTx({
            game_id: game.id,
            player_id: line.playerId,
            kind: 'discount',
            amount: discount,
            method: method === 'account' ? 'account' : 'cash',
            note: `${discountPct}% loss discount`,
          })
      },
      existing ? 'Cash-out updated' : `${line.name} cashed out ${money(value + discount)}`,
    )

  return (
    <Sheet
      open
      onClose={onClose}
      title={existing ? 'Edit cash-out' : 'Cash out'}
      subtitle={line.name}
      footer={
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-[12px] border border-line bg-bg px-4 py-3">
            <div className="text-[13px] leading-relaxed text-muted">
              In <Money value={line.buyIns} className="text-ink" />
              {otherCashOuts > 0 && (
                <>
                  {' '}
                  · earlier <Money value={otherCashOuts} className="text-ink" />
                </>
              )}
              {discount > 0 && (
                <>
                  <br />+ <Money value={discount} className="text-brass" /> loss discount
                </>
              )}
            </div>
            {valid ? (
              <div className="text-right">
                <div className="text-xs text-muted">{net > 0 ? 'Won' : net < 0 ? 'Lost' : 'Even'}</div>
                <Money value={net} signed colored className="font-display text-[30px] leading-none" />
              </div>
            ) : (
              <span className="text-sm text-faint">Result shows here</span>
            )}
          </div>
          <Button variant="primary" size="lg" className="w-full" disabled={!valid} loading={busy} onClick={submit}>
            {existing ? 'Save changes' : valid ? `Pay out ${money(value + discount)}` : 'Enter their chips'}
          </Button>
        </div>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) void submit()
        }}
      >
        <Field label="Chips to pay out">
          <AmountInput value={amount} onChange={setAmount} autoFocus={!counting} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Chip active={valid && value === 0} onClick={() => setAmount('0')}>
            Busted
          </Chip>
          <Chip active={valid && value === line.buyIns} onClick={() => setAmount(amountStr(line.buyIns))}>
            Even · {money(line.buyIns)}
          </Chip>
          <Chip active={counting} onClick={() => setCounting((c) => !c)}>
            <span className="inline-flex items-center gap-1.5">
              <Icon name="calc" className="size-4" /> Count chips
            </span>
          </Chip>
        </div>
        {counting && <ChipCounter onTotal={(t) => setAmount(amountStr(t))} />}

        {discountPct > 0 && due > 0 && (
          <label className="flex cursor-pointer items-center gap-3 rounded-[12px] border border-brass/30 bg-brass/[0.06] px-3.5 py-3">
            <input type="checkbox" checked={giveDiscount} onChange={(e) => setGiveDiscount(e.target.checked)} className="size-4 accent-[#d6ae62]" />
            <span className="flex-1 text-sm">
              Loss discount{' '}
              <span className="text-muted">
                ({discountPct}% of the loss{ownRate ? ', their own rate' : ''})
              </span>
              <span className="block text-xs text-faint">Booked as an expense of this game.</span>
            </span>
            <Money value={due} className="font-semibold text-brass" />
          </label>
        )}
        {discountPct === 0 && game.loss_discount_pct > 0 && valid && value < line.buyIns && (
          <p className="text-xs text-faint">{line.name} doesn’t get a loss discount (set on their player profile).</p>
        )}

        <MethodField label="Paid out with" value={method} onChange={setMethod} accountHint="Credited to the player’s account instead of paid now." />
        <Field label="Note (optional)">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </Field>
      </form>
      {existing && <DeleteRow label="this cash-out" onDelete={() => save(() => deleteTx(existing.id), 'Cash-out deleted')} />}
    </Sheet>
  )
}

/** Adjust or remove a loss discount that was given. */
export function DiscountSheet({
  player,
  existing,
  onClose,
  onSaved,
}: {
  player: string
  existing: Transaction
  onClose: () => void
  onSaved: () => void
}) {
  const { busy, save } = useSave(onSaved, onClose)
  const [amount, setAmount] = useState(amountStr(existing.amount))
  const value = parseAmount(amount)
  return (
    <Sheet
      open
      onClose={onClose}
      title="Loss discount"
      subtitle={player}
      footer={
        <Button variant="primary" size="lg" className="w-full" disabled={!(value > 0)} loading={busy} onClick={() => save(() => updateTx(existing.id, { amount: value }), 'Discount updated')}>
          Save changes
        </Button>
      }
    >
      <AmountInput value={amount} onChange={setAmount} autoFocus />
      <DeleteRow label="this discount" onDelete={() => save(() => deleteTx(existing.id), 'Discount removed')} />
    </Sheet>
  )
}

// ---------------------------------------------------------------- Player in game

const TX_LABEL: Record<Transaction['kind'], string> = { buy_in: 'Buy-in', cash_out: 'Cash-out', discount: 'Loss discount' }

export function PlayerGameSheet({
  line,
  canEdit,
  stamps,
  onClose,
  onBuyIn,
  onCashOut,
  onEditTx,
}: {
  line: PlayerLine
  canEdit: boolean
  stamps?: Map<string, RecordStamp>
  onClose: () => void
  onBuyIn: () => void
  onCashOut: () => void
  onEditTx: (t: Transaction) => void
}) {
  const out = line.status === 'out'
  return (
    <Sheet
      open
      onClose={onClose}
      title={line.name}
      subtitle={out ? 'Cashed out' : 'At the table'}
      footer={
        canEdit ? (
          <div className="flex gap-3">
            <Button className="flex-1" size="lg" icon="plus" onClick={onBuyIn}>
              Buy-in
            </Button>
            <Button className="flex-1" size="lg" variant="felt" icon="cashout" onClick={onCashOut}>
              Cash out
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="grid grid-cols-3 divide-x divide-line rounded-[12px] border border-line bg-bg text-center">
        <div className="p-3">
          <div className="text-xs text-muted">Bought in</div>
          <Money value={line.buyIns} className="font-display text-2xl" />
        </div>
        <div className="p-3">
          <div className="text-xs text-muted">Paid out</div>
          <Money value={line.cashOuts + line.discounts} className="font-display text-2xl" />
        </div>
        <div className="p-3">
          <div className="text-xs text-muted">Net</div>
          {out ? <Money value={line.net} signed colored className="font-display text-2xl" /> : <span className="font-display text-2xl text-faint">—</span>}
        </div>
      </div>

      <div className="mt-4 divide-y divide-line rounded-[12px] border border-line">
        {line.txs.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={!canEdit}
            onClick={() => onEditTx(t)}
            className="flex w-full items-center gap-3 px-3 py-2.5 text-left enabled:hover:bg-surface-2/60"
          >
            <span
              className={cx(
                'inline-flex size-8 shrink-0 items-center justify-center rounded-full border',
                t.kind === 'buy_in' ? 'border-line text-muted' : t.kind === 'discount' ? 'border-brass/40 text-brass' : 'border-felt text-felt-ink',
              )}
            >
              <Icon name={t.kind === 'buy_in' ? 'plus' : t.kind === 'discount' ? 'percent' : 'cashout'} className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm">
                {TX_LABEL[t.kind]}
                <span className="text-muted"> · {methodLabel(t.method)}</span>
                {t.updated_at && (
                  <span className="text-faint">
                    {' '}
                    · edited {formatClock(t.updated_at)}
                    {stamps?.get(t.id)?.editedBy && ` by ${stamps.get(t.id)!.editedBy}`}
                  </span>
                )}
              </span>
              <span className="block truncate text-xs text-faint tnum" title={formatStamp(t.created_at)}>
                {formatClock(t.created_at)}
                {stamps?.get(t.id)?.createdBy && ` · ${stamps.get(t.id)!.createdBy}`}
                {t.note && ` · ${t.note}`}
              </span>
            </span>
            <Money value={t.amount} className="font-medium" />
            {canEdit && <Icon name="edit" className="size-3.5 text-faint" />}
          </button>
        ))}
      </div>

      <Link to={`/players/${line.playerId}`} className="mt-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        Account & history <Icon name="next" className="size-4" />
      </Link>
    </Sheet>
  )
}

// ---------------------------------------------------------------- Dealer round (rake + tips)

export function RoundSheet({
  game,
  existing,
  roundNo,
  dealers,
  dealerNames,
  suggestedDealer,
  onClose,
  onSaved,
}: {
  game: Game
  existing?: DealerTip
  /** the round's number in this game (for the title) */
  roundNo: number
  /** dealer accounts in this organization */
  dealers: Dealer[]
  dealerNames: string[]
  /** likely next dealer in the rotation */
  suggestedDealer?: string
  onClose: () => void
  onSaved: () => void
}) {
  const { busy, save } = useSave(onSaved, onClose)
  const [dealer, setDealer] = useState(existing?.dealer_name ?? suggestedDealer ?? dealerNames[0] ?? '')
  const [rake, setRake] = useState(existing && existing.rake ? amountStr(existing.rake) : '')
  const [tips, setTips] = useState(existing && existing.amount ? amountStr(existing.amount) : '')
  const [note, setNote] = useState(existing?.note ?? '')
  const [method, setMethod] = useState<TipMethod>(existing?.method ?? 'cash')
  const match = dealers.find((d) => d.name.trim().toLowerCase() === dealer.trim().toLowerCase())
  const rakeN = rake.trim() === '' ? 0 : parseAmount(rake)
  const tipsN = tips.trim() === '' ? 0 : parseAmount(tips)
  const valid = rakeN >= 0 && tipsN >= 0 && rakeN + tipsN > 0 && dealer.trim().length > 0
  const tax = valid ? Math.round(tipsN * game.tip_tax_pct) / 100 : 0
  const name = dealer.trim() || 'The dealer'

  const submit = () => {
    const payload = { dealer_id: match?.id ?? null, dealer_name: match?.name ?? dealer.trim(), rake: rakeN, amount: tipsN, method, note: note.trim() || null }
    return save(
      () => (existing ? updateTip(existing.id, payload) : addTip({ ...payload, game_id: game.id })),
      existing ? `Round ${roundNo} updated` : `Round ${roundNo}: ${money(rakeN)} rake, ${money(tipsN)} tips`,
    )
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={existing ? `Edit round ${roundNo}` : `Round ${roundNo}`}
      subtitle="What the dealer reports when they get up."
      footer={
        <div className="space-y-3">
          {valid && (
            <div className="grid grid-cols-2 divide-x divide-line rounded-[12px] border border-line bg-bg text-sm">
              <div className="px-3.5 py-2.5">
                <div className="text-xs text-muted">To the house</div>
                <Money value={rakeN + tax} className="font-display text-[24px] leading-tight text-brass" />
                <div className="text-[11px] text-faint">
                  rake {money(rakeN)}
                  {tax > 0 && ` + ${money(tax)} tip tax`}
                </div>
              </div>
              <div className="px-3.5 py-2.5">
                <div className="truncate text-xs text-muted">{method === 'account' && tipsN > 0 ? `Owed to ${name}` : `${name} takes home`}</div>
                <Money value={tipsN - tax} className="font-display text-[24px] leading-tight" />
                <div className="text-[11px] text-faint">{game.tip_tax_pct > 0 ? `tips − ${game.tip_tax_pct}% tip tax` : 'all their tips'}</div>
              </div>
            </div>
          )}
          <Button variant="primary" size="lg" className="w-full" disabled={!valid} loading={busy} onClick={submit}>
            {existing ? 'Save changes' : 'Record round'}
          </Button>
        </div>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) void submit()
        }}
      >
        <Field
          label="Dealer"
          hint={dealer.trim() && !match ? `New dealer — an account is opened for ${dealer.trim()} when you save.` : undefined}
        >
          <TextInput value={dealer} onChange={(e) => setDealer(e.target.value)} maxLength={60} placeholder="Dealer name" />
        </Field>
        {dealerNames.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {dealerNames.map((n) => (
              <Chip key={n} active={dealer.trim().toLowerCase() === n.toLowerCase()} onClick={() => setDealer(n)}>
                {n}
              </Chip>
            ))}
          </div>
        )}
        <Field label="Rake this round" hint="The chips the dealer took out of the pots for the house.">
          <AmountInput value={rake} onChange={setRake} autoFocus={!!dealer} />
        </Field>
        <Field
          label="Tips this round"
          hint={game.tip_tax_pct > 0 ? `Chips players tipped the dealer. The house keeps ${game.tip_tax_pct}% as tip tax.` : 'Chips players tipped the dealer.'}
        >
          <AmountInput value={tips} onChange={setTips} />
        </Field>
        {tipsN > 0 && (
          <Field
            label="Their tips"
            hint={method === 'account' ? `Goes on ${dealer.trim() || 'the dealer'}’s account until you pay them.` : 'Paid out now, so nothing is owed.'}
          >
            <Segmented value={method} options={TIP_METHODS} onChange={setMethod} />
          </Field>
        )}
        <Field label="Note (optional)">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </Field>
      </form>
      {existing && <DeleteRow label="this round" onDelete={() => save(() => deleteTip(existing.id), `Round ${roundNo} deleted`)} />}
    </Sheet>
  )
}

// ---------------------------------------------------------------- Expense

export function ExpenseSheet({
  game,
  existing,
  partners,
  dealers,
  onClose,
  onSaved,
}: {
  game: Game
  existing?: Expense
  partners: PartnerAccount[]
  /** dealer accounts, for dealer pay */
  dealers: Dealer[]
  onClose: () => void
  onSaved: () => void
}) {
  const { busy, save } = useSave(onSaved, onClose)
  const [category, setCategory] = useState<ExpenseCategory>(existing?.category ?? 'food')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [amount, setAmount] = useState(existing ? amountStr(existing.amount) : '')
  // '' = game bank
  const [payer, setPayer] = useState<string>(existing ? (existing.partner_id ?? '') : (partners[0]?.id ?? ''))
  // '' = not tied to a dealer
  const [dealerId, setDealerId] = useState<string>(existing?.dealer_id ?? '')
  const value = parseAmount(amount)
  const valid = value > 0

  const submit = () => {
    const payload = {
      category,
      description: description.trim() || null,
      amount: value,
      partner_id: payer || null,
      dealer_id: category === 'dealer_pay' ? dealerId || null : null,
    }
    return save(
      () => (existing ? updateExpense(existing.id, payload) : addExpense({ ...payload, game_id: game.id })),
      existing ? 'Expense updated' : 'Expense recorded',
    )
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={existing ? 'Edit expense' : 'Add expense'}
      footer={
        <Button variant="primary" size="lg" className="w-full" disabled={!valid} loading={busy} onClick={submit}>
          {existing ? 'Save changes' : 'Record expense'}
        </Button>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) void submit()
        }}
      >
        <Field label="Amount">
          <AmountInput value={amount} onChange={setAmount} autoFocus />
        </Field>
        <Field label="Who paid?" hint={payer ? 'Credited to this partner’s account — the business owes it back.' : 'Paid out of the game’s cash.'}>
          <div className="grid grid-cols-2 gap-2">
            {partners.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPayer(p.id)}
                className={cx(
                  'flex items-center gap-2.5 rounded-[12px] border px-2.5 py-2 text-left text-sm transition-colors',
                  payer === p.id ? 'border-brass/70 bg-brass/[0.08]' : 'border-line bg-surface-2 hover:border-[#3a3a33]',
                )}
              >
                <Avatar name={p.name} size={28} />
                <span className="truncate">{p.name}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPayer('')}
              className={cx(
                'flex items-center gap-2.5 rounded-[12px] border px-2.5 py-2 text-left text-sm transition-colors',
                payer === '' ? 'border-brass/70 bg-brass/[0.08]' : 'border-line bg-surface-2 hover:border-[#3a3a33]',
              )}
            >
              <span className="inline-flex size-7 items-center justify-center rounded-full border border-line bg-bg text-muted">
                <Icon name="wallet" className="size-3.5" />
              </span>
              Game bank
            </button>
          </div>
          {partners.length === 0 && (
            <span className="mt-2 block text-xs text-faint">
              No partner accounts yet — add them on the{' '}
              <Link to="/partners" className="underline">
                Partners
              </Link>{' '}
              page.
            </span>
          )}
        </Field>
        <Field label="Category">
          <div className="flex flex-wrap gap-2">
            {EXPENSE_CATEGORIES.map((c) => (
              <Chip key={c.value} active={category === c.value} onClick={() => setCategory(c.value)}>
                {c.label}
              </Chip>
            ))}
          </div>
        </Field>
        {category === 'dealer_pay' && dealers.length > 0 && (
          <Field label="Which dealer? (optional)" hint="Shows on that dealer’s account and ledger.">
            <div className="flex flex-wrap gap-2">
              {dealers
                .filter((d) => d.active || d.id === dealerId)
                .map((d) => (
                  <Chip key={d.id} active={dealerId === d.id} onClick={() => setDealerId(dealerId === d.id ? '' : d.id)}>
                    {d.name}
                  </Chip>
                ))}
            </div>
          </Field>
        )}
        <Field label="Description (optional)">
          <TextInput value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder="e.g. Pizza x4" />
        </Field>
      </form>
      {existing && <DeleteRow label="this expense" onDelete={() => save(() => deleteExpense(existing.id), 'Expense deleted')} />}
    </Sheet>
  )
}

// ---------------------------------------------------------------- Edit game

export function EditGameSheet({ game, onClose, onSaved }: { game: Game; onClose: () => void; onSaved: () => void }) {
  const { isAdmin } = useAuth()
  const { confirm } = useFeedback()
  const navigate = useNavigate()
  const { busy, save } = useSave(onSaved, onClose)
  const { run } = useAction()
  const [name, setName] = useState(game.name)
  const [date, setDate] = useState(game.game_date)
  const [notes, setNotes] = useState(game.notes ?? '')
  const [tipTax, setTipTax] = useState(pctStr(game.tip_tax_pct))
  const [discount, setDiscount] = useState(pctStr(game.loss_discount_pct))
  const tipTaxN = Number(tipTax || 0)
  const discountN = Number(discount || 0)
  const pctOk = (n: number) => Number.isFinite(n) && n >= 0 && n <= 100
  const valid = name.trim() && date && pctOk(tipTaxN) && pctOk(discountN)
  const editable = game.status === 'open'

  return (
    <Sheet
      open
      onClose={onClose}
      title="Game settings"
      footer={
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          disabled={!valid}
          loading={busy}
          onClick={() =>
            save(
              () =>
                updateGame(game.id, {
                  name: name.trim(),
                  game_date: date,
                  notes: notes.trim() || null,
                  ...(editable ? { tip_tax_pct: tipTaxN, loss_discount_pct: discountN } : {}),
                }),
              'Game updated',
            )
          }
        >
          Save changes
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <Field label="Date">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tip tax">
            <PercentInput value={tipTax} onChange={setTipTax} />
          </Field>
          <Field label="Loss discount">
            <PercentInput value={discount} onChange={setDiscount} />
          </Field>
        </div>
        <p className="-mt-1 text-xs leading-relaxed text-faint">
          Tip tax is the house’s cut of dealer tips. Loss discount gives losing players that % of their loss back when they cash out.
          {!editable && ' Reopen the game to change these.'}
        </p>
        <Field label="Notes">
          <textarea className={cx(inputCls, 'h-24 py-2')} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
        </Field>
      </div>
      {isAdmin && (
        <button
          type="button"
          className="mt-6 flex items-center gap-1.5 text-sm text-loss/90 hover:text-loss"
          onClick={async () => {
            const sure = await confirm({
              title: `Delete “${game.name}”?`,
              message: 'All buy-ins, cash-outs, tips and expenses in this game will be deleted. The history log keeps a record.',
              confirmLabel: 'Delete game',
              danger: true,
            })
            if (sure && (await run(() => deleteGame(game.id), 'Game deleted'))) navigate('/')
          }}
        >
          <Icon name="trash" className="size-4" /> Delete game (admin)
        </button>
      )}
    </Sheet>
  )
}
