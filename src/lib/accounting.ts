import { BANK_PAYER } from './types'
import type { DealerTip, Expense, ExpenseCategory, PayMethod, Player, Transaction } from './types'

// All sums are done in integer cents to avoid floating point drift.
const cents = (n: number | string) => Math.round(Number(n) * 100)
const dollars = (c: number) => c / 100
const pctOf = (c: number, pct: number) => Math.round((c * pct) / 100)

export interface Rates {
  /** % of dealer tips the house keeps */
  tipTaxPct: number
  /** % of a losing player's loss given back */
  lossDiscountPct: number
}

export interface PlayerLine {
  playerId: string
  name: string
  buyIns: number
  buyInCount: number
  cashOuts: number
  /** loss discounts given back to this player */
  discounts: number
  /** cash-outs + discounts − buy-ins (final once the player has cashed out) */
  net: number
  status: 'playing' | 'out'
  txs: Transaction[]
  lastActivity: string
}

export interface NamedTotal {
  name: string
  amount: number
  count: number
}

export interface DealerTotal extends NamedTotal {
  /** rounds dealt (= count) */
  rounds: number
  /** rake this dealer reported for the house */
  rake: number
  /** the house's cut of this dealer's tips */
  tax: number
  /** what the dealer takes home */
  net: number
}

export interface DiscountLine {
  playerId: string
  name: string
  amount: number
}

export interface GameSummary {
  players: PlayerLine[]
  seatedCount: number
  allCashedOut: boolean
  totalBuyIns: number
  totalCashOuts: number
  /** loss discounts given back — booked as an expense */
  totalDiscounts: number
  /** gross dealer tips */
  totalTips: number
  /** the house's cut of the tips */
  tipTax: number
  /** what the dealers actually take home */
  dealerNet: number
  /** rake the dealers reported, round by round */
  totalRake: number
  /** true once any dealer round has reported rake */
  rakeReported: boolean
  /** dealer rounds recorded */
  rounds: number
  lastRoundAt: string | null
  /**
   * buy-ins − cash-outs − tips − reported rake. While people are playing these
   * are the chips that should be on the table; once everyone has cashed out
   * it's the over (+) / short (−).
   */
  unaccounted: number
  /** buy-ins − cash-outs − tips: every chip the house kept (rake + over/short) */
  houseChips: number
  /** house chips + tip tax: what the house earned before costs */
  houseTake: number
  /** expenses entered for the game (food, venue…) */
  totalExpenses: number
  /** expenses + loss discounts */
  totalCosts: number
  /** Money held by the house right now (includes chips still in play). */
  bank: number
  /** house take − expenses − loss discounts: what the organizers made */
  netProfit: number
  /** reported rake + tip tax − costs: made so far, ignoring chips still in play */
  profitSoFar: number
  /** Chips players are still sitting with (their buy-ins, as an upper bound). */
  seatedBuyIns: number
  totalWon: number
  totalLost: number
  dealers: DealerTotal[]
  expensesByPayer: NamedTotal[]
  expensesByCategory: { category: ExpenseCategory; amount: number }[]
  discountsByPlayer: DiscountLine[]
  buyInsByMethod: { method: PayMethod; amount: number }[]
  /** Expenses paid out of pocket that the bank owes back. */
  reimbursements: NamedTotal[]
}

function groupByName(items: { name: string; amount: number }[]): NamedTotal[] {
  const map = new Map<string, { name: string; c: number; count: number }>()
  for (const it of items) {
    const key = it.name.trim().toLowerCase()
    const cur = map.get(key) ?? { name: it.name.trim(), c: 0, count: 0 }
    cur.c += cents(it.amount)
    cur.count += 1
    map.set(key, cur)
  }
  return [...map.values()]
    .map((v) => ({ name: v.name, amount: dollars(v.c), count: v.count }))
    .sort((a, b) => b.amount - a.amount)
}

export function summarizePlayer(playerId: string, name: string, txs: Transaction[]): PlayerLine {
  const sorted = [...txs].sort((a, b) => a.created_at.localeCompare(b.created_at))
  let buyC = 0
  let outC = 0
  let discC = 0
  let buyInCount = 0
  let lastBuyIn = ''
  let lastCashOut = ''
  for (const t of sorted) {
    if (t.kind === 'buy_in') {
      buyC += cents(t.amount)
      buyInCount += 1
      lastBuyIn = t.created_at
    } else if (t.kind === 'cash_out') {
      outC += cents(t.amount)
      lastCashOut = t.created_at
    } else {
      discC += cents(t.amount)
    }
  }
  // A player is seated until they have a cash-out after their latest buy-in.
  const status: PlayerLine['status'] = lastCashOut && lastCashOut >= lastBuyIn ? 'out' : 'playing'
  return {
    playerId,
    name,
    buyIns: dollars(buyC),
    buyInCount,
    cashOuts: dollars(outC),
    discounts: dollars(discC),
    net: dollars(outC + discC - buyC),
    status,
    txs: sorted,
    lastActivity: sorted.at(-1)?.created_at ?? '',
  }
}

/**
 * Loss discount still owed to a player if they cash out `cashOut` now
 * (replacing `replacing`, when editing an existing cash-out).
 */
export function lossDiscountDue(line: PlayerLine, cashOut: number, pct: number, replacing = 0): number {
  if (pct <= 0) return 0
  const lossC = cents(line.buyIns) - (cents(line.cashOuts) - cents(replacing) + cents(cashOut))
  if (lossC <= 0) return 0
  return dollars(Math.max(0, pctOf(lossC, pct) - cents(line.discounts)))
}

export function summarizeGame(
  txs: Transaction[],
  tips: DealerTip[],
  expenses: Expense[],
  playersById: Map<string, Player>,
  rates: Rates = { tipTaxPct: 0, lossDiscountPct: 0 },
): GameSummary {
  const byPlayer = new Map<string, Transaction[]>()
  for (const t of txs) {
    const list = byPlayer.get(t.player_id) ?? []
    list.push(t)
    byPlayer.set(t.player_id, list)
  }

  const players = [...byPlayer.entries()]
    .map(([pid, list]) => summarizePlayer(pid, playersById.get(pid)?.name ?? 'Unknown player', list))
    .sort((a, b) => a.name.localeCompare(b.name))

  const sum = (xs: number[]) => xs.reduce((s, x) => s + cents(x), 0)
  const of = (kind: Transaction['kind']) => sum(txs.filter((t) => t.kind === kind).map((t) => t.amount))
  const buyC = of('buy_in')
  const outC = of('cash_out')
  const discC = of('discount')
  const tipC = sum(tips.map((t) => t.amount))
  const rakeC = sum(tips.map((t) => t.rake ?? 0))
  const taxC = pctOf(tipC, rates.tipTaxPct)
  const expC = sum(expenses.map((e) => e.amount))
  const chipsC = buyC - outC - tipC
  const houseC = chipsC + taxC
  const costC = expC + discC

  const seated = players.filter((p) => p.status === 'playing')
  const out = players.filter((p) => p.status === 'out')

  const methodTotals = new Map<PayMethod, number>()
  for (const t of txs) {
    if (t.kind !== 'buy_in') continue
    methodTotals.set(t.method, (methodTotals.get(t.method) ?? 0) + cents(t.amount))
  }

  const catTotals = new Map<ExpenseCategory, number>()
  for (const e of expenses) catTotals.set(e.category, (catTotals.get(e.category) ?? 0) + cents(e.amount))

  const expensesByPayer = groupByName(expenses.map((e) => ({ name: e.paid_by, amount: e.amount })))

  const byDealer = new Map<string, { name: string; tipC: number; rakeC: number; rounds: number }>()
  for (const t of tips) {
    const key = t.dealer_name.trim().toLowerCase()
    const cur = byDealer.get(key) ?? { name: t.dealer_name.trim(), tipC: 0, rakeC: 0, rounds: 0 }
    cur.tipC += cents(t.amount)
    cur.rakeC += cents(t.rake ?? 0)
    cur.rounds += 1
    byDealer.set(key, cur)
  }

  const discounts = new Map<string, number>()
  for (const t of txs) if (t.kind === 'discount') discounts.set(t.player_id, (discounts.get(t.player_id) ?? 0) + cents(t.amount))

  return {
    players,
    seatedCount: seated.length,
    allCashedOut: players.length > 0 && seated.length === 0,
    totalBuyIns: dollars(buyC),
    totalCashOuts: dollars(outC),
    totalDiscounts: dollars(discC),
    totalTips: dollars(tipC),
    tipTax: dollars(taxC),
    dealerNet: dollars(tipC - taxC),
    totalRake: dollars(rakeC),
    rakeReported: rakeC > 0,
    rounds: tips.length,
    lastRoundAt: tips.reduce<string | null>((m, t) => (!m || t.created_at > m ? t.created_at : m), null),
    unaccounted: dollars(chipsC - rakeC),
    houseChips: dollars(chipsC),
    houseTake: dollars(houseC),
    totalExpenses: dollars(expC),
    totalCosts: dollars(costC),
    bank: dollars(houseC - discC),
    netProfit: dollars(houseC - costC),
    profitSoFar: dollars(rakeC + taxC - costC),
    seatedBuyIns: dollars(sum(seated.map((p) => p.buyIns))),
    totalWon: dollars(sum(out.filter((p) => p.net > 0).map((p) => p.net))),
    totalLost: dollars(-sum(out.filter((p) => p.net < 0).map((p) => p.net))),
    dealers: [...byDealer.values()]
      .map((d) => {
        const taxD = pctOf(d.tipC, rates.tipTaxPct)
        return {
          name: d.name,
          amount: dollars(d.tipC),
          count: d.rounds,
          rounds: d.rounds,
          rake: dollars(d.rakeC),
          tax: dollars(taxD),
          net: dollars(d.tipC - taxD),
        }
      })
      .sort((a, b) => b.rake + b.amount - (a.rake + a.amount)),
    expensesByPayer,
    expensesByCategory: [...catTotals.entries()]
      .map(([category, c]) => ({ category, amount: dollars(c) }))
      .sort((a, b) => b.amount - a.amount),
    discountsByPlayer: [...discounts.entries()]
      .map(([playerId, c]) => ({ playerId, name: playersById.get(playerId)?.name ?? 'Unknown player', amount: dollars(c) }))
      .sort((a, b) => b.amount - a.amount),
    buyInsByMethod: [...methodTotals.entries()]
      .map(([method, c]) => ({ method, amount: dollars(c) }))
      .sort((a, b) => b.amount - a.amount),
    reimbursements: expensesByPayer.filter((p) => p.name.toLowerCase() !== BANK_PAYER.toLowerCase()),
  }
}

/** The loss discount % that applies to a player: their own rate, else the game's. */
export function discountRateFor(player: Pick<Player, 'loss_discount_pct'> | undefined, gamePct: number): number {
  return player?.loss_discount_pct ?? gamePct
}

/** Split a profit (can be negative) by partner share %, rounding to cents. */
export function splitProfit<T extends { share_pct: number }>(profit: number, partners: T[]): (T & { amount: number })[] {
  return partners.map((p) => ({ ...p, amount: dollars(pctOf(cents(profit), p.share_pct)) }))
}
