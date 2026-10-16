// A per-person statement: every amount owed either way and every payment
// either way, with a running balance. Positive balance = we owe them.
import type { RecordStamp } from './actors'
import { formatStamp, money, shortDate, signedMoney } from './format'
import { categoryLabel, methodLabel } from './types'
import type { AccountTx, DealerPayment, DealerRound, Expense, PartnerEntry, PartnerShareWithGame, PlayerPayment } from './types'

export type LedgerSource = 'transaction' | 'player_payment' | 'partner_entry' | 'partner_share' | 'expense' | 'dealer_round' | 'dealer_payment'

export interface LedgerEntry {
  /** id of the underlying record */
  id: string
  source: LedgerSource
  /** when it was recorded */
  at: string
  title: string
  details: string[]
  /** amounts, all ≥ 0 */
  owedToThem: number
  theyOwe: number
  ourPayment: number
  theirPayment: number
  gameId?: string | null
  editedAt?: string | null
  stamp?: RecordStamp
}

export interface LedgerRow extends LedgerEntry {
  /** balance after this entry; positive = we owe them, negative = they owe us */
  balance: number
}

export interface LedgerTotals {
  owedToThem: number
  theyOwe: number
  ourPayments: number
  theirPayments: number
  balance: number
}

const c = (n: number) => Math.round(n * 100)
const effect = (e: LedgerEntry) => c(e.owedToThem) - c(e.theyOwe) + c(e.theirPayment) - c(e.ourPayment)

/** Running balances (computed oldest → newest), returned newest first. */
export function withBalances(entries: LedgerEntry[]): { rows: LedgerRow[]; totals: LedgerTotals } {
  const sorted = [...entries].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
  let bal = 0
  const t = { owedToThem: 0, theyOwe: 0, ourPayments: 0, theirPayments: 0 }
  const rows = sorted.map((e) => {
    bal += effect(e)
    t.owedToThem += c(e.owedToThem)
    t.theyOwe += c(e.theyOwe)
    t.ourPayments += c(e.ourPayment)
    t.theirPayments += c(e.theirPayment)
    return { ...e, balance: bal / 100 }
  })
  return {
    rows: rows.reverse(),
    totals: {
      owedToThem: t.owedToThem / 100,
      theyOwe: t.theyOwe / 100,
      ourPayments: t.ourPayments / 100,
      theirPayments: t.theirPayments / 100,
      balance: bal / 100,
    },
  }
}

const gameLabel = (name: string, date: string) => (name ? `${name}${date ? `, ${shortDate(date)}` : ''}` : '')
const clean = (xs: (string | null | undefined | false)[]) => xs.filter((x): x is string => !!x)

// ---------------------------------------------------------------- players

export function playerLedger(name: string, txs: AccountTx[], payments: PlayerPayment[], stamps?: Map<string, RecordStamp>): LedgerEntry[] {
  const out: LedgerEntry[] = []
  for (const t of txs) {
    const paidNow = t.method !== 'account'
    const how = methodLabel(t.method).toLowerCase()
    const base = { id: t.id, source: 'transaction' as const, at: t.created_at, gameId: t.game_id, editedAt: t.updated_at, stamp: stamps?.get(t.id) }
    const game = gameLabel(t.game_name, t.game_date)
    if (t.kind === 'buy_in') {
      out.push({
        ...base,
        title: paidNow ? 'Buy-in' : 'Buy-in on credit',
        details: clean([game, paidNow ? `${name} paid ${money(t.amount)} by ${how}` : `Put on ${name}’s account — owed to us`, t.note && `Note: ${t.note}`]),
        theyOwe: t.amount,
        theirPayment: paidNow ? t.amount : 0,
        owedToThem: 0,
        ourPayment: 0,
      })
    } else if (t.kind === 'cash_out') {
      out.push({
        ...base,
        title: t.amount === 0 ? 'Busted (cash-out $0)' : 'Cash-out',
        details: clean([
          game,
          t.amount === 0 ? null : paidNow ? `We paid ${money(t.amount)} by ${how}` : `Credited to ${name}’s account — we owe it`,
          t.note && `Note: ${t.note}`,
        ]),
        owedToThem: t.amount,
        ourPayment: paidNow ? t.amount : 0,
        theyOwe: 0,
        theirPayment: 0,
      })
    } else {
      out.push({
        ...base,
        title: 'Loss discount',
        details: clean([game, paidNow ? `We paid ${money(t.amount)} by ${how}` : `Credited to ${name}’s account`, t.note]),
        owedToThem: t.amount,
        ourPayment: paidNow ? t.amount : 0,
        theyOwe: 0,
        theirPayment: 0,
      })
    }
  }
  for (const p of payments) {
    const from = p.direction === 'from_player'
    out.push({
      id: p.id,
      source: 'player_payment',
      at: p.created_at,
      editedAt: p.updated_at,
      stamp: stamps?.get(p.id),
      title: from ? `Payment from ${name}` : `Payment to ${name}`,
      details: clean([`By ${p.method}`, from ? 'Settles what they owe' : 'Settles what we owe', p.note && `Note: ${p.note}`]),
      theirPayment: from ? p.amount : 0,
      ourPayment: from ? 0 : p.amount,
      owedToThem: 0,
      theyOwe: 0,
    })
  }
  return out
}

// ---------------------------------------------------------------- partners

export function partnerLedger(
  name: string,
  shares: PartnerShareWithGame[],
  expenses: (Expense & { game_name: string; game_date: string })[],
  entries: PartnerEntry[],
  stamps?: Map<string, RecordStamp>,
): LedgerEntry[] {
  const out: LedgerEntry[] = []
  for (const s of shares) {
    out.push({
      id: s.id,
      source: 'partner_share',
      at: s.created_at,
      gameId: s.game_id,
      stamp: stamps?.get(s.id),
      title: s.amount >= 0 ? 'Profit share' : 'Share of a losing night',
      details: clean([gameLabel(s.game_name, s.game_date), `${s.share_pct}% of ${signedMoney(s.game_profit)} net profit`, 'Posted when the game ended']),
      owedToThem: Math.max(0, s.amount),
      theyOwe: Math.max(0, -s.amount),
      ourPayment: 0,
      theirPayment: 0,
    })
  }
  for (const e of expenses) {
    out.push({
      id: e.id,
      source: 'expense',
      at: e.created_at,
      gameId: e.game_id,
      editedAt: e.updated_at,
      stamp: stamps?.get(e.id),
      title: `Paid an expense: ${categoryLabel(e.category)}`,
      details: clean([gameLabel(e.game_name, e.game_date), e.description, `${name} paid out of pocket — we owe it back`]),
      owedToThem: e.amount,
      theyOwe: 0,
      ourPayment: 0,
      theirPayment: 0,
    })
  }
  for (const e of entries) {
    const payout = e.kind === 'payout'
    out.push({
      id: e.id,
      source: 'partner_entry',
      at: e.created_at,
      editedAt: e.updated_at,
      stamp: stamps?.get(e.id),
      title: payout ? `Payout to ${name}` : `${name} put money in`,
      details: clean([`By ${e.method}`, e.note && `Note: ${e.note}`]),
      ourPayment: payout ? e.amount : 0,
      theirPayment: payout ? 0 : e.amount,
      owedToThem: 0,
      theyOwe: 0,
    })
  }
  return out
}

// ---------------------------------------------------------------- dealers

/**
 * A dealer's statement. Each round, the house owes the dealer their tips minus
 * the tip tax; paid on the spot unless the round says "owed". Dealer pay is
 * owed and paid at once. The rake they collected is shown, but it's the
 * house's money, so it doesn't move the balance.
 */
export function dealerLedger(
  name: string,
  rounds: DealerRound[],
  pay: (Expense & { game_name: string; game_date: string })[],
  payments: DealerPayment[],
  stamps?: Map<string, RecordStamp>,
): LedgerEntry[] {
  const out: LedgerEntry[] = []
  for (const r of rounds) {
    const taxC = Math.round((c(r.amount) * r.tip_tax_pct) / 100)
    const net = (c(r.amount) - taxC) / 100
    const owed = r.method === 'account'
    out.push({
      id: r.id,
      source: 'dealer_round',
      at: r.created_at,
      gameId: r.game_id,
      editedAt: r.updated_at,
      stamp: stamps?.get(r.id),
      title: r.amount ? (owed ? 'Tips owed' : 'Tips') : 'Round (rake only)',
      details: clean([
        gameLabel(r.game_name, r.game_date),
        `Rake ${money(r.rake)} collected for the house`,
        r.amount > 0 && (taxC ? `Tips ${money(r.amount)} − ${money(taxC / 100)} tip tax` : `Tips ${money(r.amount)}`),
        r.amount > 0 && (owed ? `Put on ${name}’s account — we owe it` : `Paid by ${methodLabel(r.method).toLowerCase()}`),
        r.note && `Note: ${r.note}`,
      ]),
      owedToThem: net,
      ourPayment: owed ? 0 : net,
      theyOwe: 0,
      theirPayment: 0,
    })
  }
  for (const e of pay) {
    out.push({
      id: e.id,
      source: 'expense',
      at: e.created_at,
      gameId: e.game_id,
      editedAt: e.updated_at,
      stamp: stamps?.get(e.id),
      title: 'Dealer pay',
      details: clean([gameLabel(e.game_name, e.game_date), e.description, `Paid by ${e.paid_by}`]),
      owedToThem: e.amount,
      ourPayment: e.amount,
      theyOwe: 0,
      theirPayment: 0,
    })
  }
  for (const p of payments) {
    const toThem = p.direction === 'to_dealer'
    out.push({
      id: p.id,
      source: 'dealer_payment',
      at: p.created_at,
      editedAt: p.updated_at,
      stamp: stamps?.get(p.id),
      title: toThem ? `Payment to ${name}` : `Payment from ${name}`,
      details: clean([`By ${p.method}`, toThem ? 'Settles what we owe' : 'Settles what they owe', p.note && `Note: ${p.note}`]),
      ourPayment: toThem ? p.amount : 0,
      theirPayment: toThem ? 0 : p.amount,
      owedToThem: 0,
      theyOwe: 0,
    })
  }
  return out
}

// ---------------------------------------------------------------- export

const csvCell = (v: string | number) => {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function ledgerCsv(rows: LedgerRow[]): string {
  const head = [
    'Timestamp (ISO)', 'Timestamp', 'Entry', 'Details', 'Recorded by', 'Last edited',
    'Owed to them', 'They owe', 'Our payment', 'Their payment', 'Balance (+ we owe them / − they owe us)',
  ]
  const lines = [...rows].reverse().map((r) =>
    [
      r.at,
      formatStamp(r.at),
      r.title,
      r.details.join(' · '),
      r.stamp?.createdBy ?? '',
      r.stamp?.editedAt ? `${formatStamp(r.stamp.editedAt)} by ${r.stamp.editedBy ?? ''}` : r.editedAt ? formatStamp(r.editedAt) : '',
      r.owedToThem || '',
      r.theyOwe || '',
      r.ourPayment || '',
      r.theirPayment || '',
      r.balance,
    ]
      .map(csvCell)
      .join(','),
  )
  return [head.map(csvCell).join(','), ...lines].join('\n')
}
