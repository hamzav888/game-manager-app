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
  /** the house's cut of this dealer's tips */
  tax: number
  /** what the dealer takes home */
  net: number
}

export interface GameSummary {
  players: PlayerLine[]
  seatedCount: number
  allCashedOut: boolean
  totalBuyIns: number
  totalCashOuts: number
  totalDiscounts: number
  /** gross dealer tips */
  totalTips: number
  /** the house's cut of the tips */
  tipTax: number
  /** what the dealers actually take home */
  dealerNet: number
  totalExpenses: number
  /** buy-ins − cash-outs − discounts − gross tips: chips the house kept */
  rake: number
  /** rake + tip tax: what the house earned before expenses */
  houseTake: number
  /** Money held by the house right now (includes chips still in play). */
  bank: number
  /** house take − expenses: what the organizers made */
  netProfit: number
  /** Chips players are still sitting with (their buy-ins, as an upper bound). */
  seatedBuyIns: number
  totalWon: number
  totalLost: number
  tipsByDealer: DealerTotal[]
  expensesByPayer: NamedTotal[]
  expensesByCategory: { category: ExpenseCategory; amount: number }[]
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
  const taxC = pctOf(tipC, rates.tipTaxPct)
  const expC = sum(expenses.map((e) => e.amount))
  const rakeC = buyC - outC - discC - tipC
  const houseC = rakeC + taxC

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
    totalExpenses: dollars(expC),
    rake: dollars(rakeC),
    houseTake: dollars(houseC),
    bank: dollars(houseC),
    netProfit: dollars(houseC - expC),
    seatedBuyIns: dollars(sum(seated.map((p) => p.buyIns))),
    totalWon: dollars(sum(out.filter((p) => p.net > 0).map((p) => p.net))),
    totalLost: dollars(-sum(out.filter((p) => p.net < 0).map((p) => p.net))),
    tipsByDealer: groupByName(tips.map((t) => ({ name: t.dealer_name, amount: t.amount }))).map((d) => {
      const taxD = pctOf(cents(d.amount), rates.tipTaxPct)
      return { ...d, tax: dollars(taxD), net: dollars(cents(d.amount) - taxD) }
    }),
    expensesByPayer,
    expensesByCategory: [...catTotals.entries()]
      .map(([category, c]) => ({ category, amount: dollars(c) }))
      .sort((a, b) => b.amount - a.amount),
    buyInsByMethod: [...methodTotals.entries()]
      .map(([method, c]) => ({ method, amount: dollars(c) }))
      .sort((a, b) => b.amount - a.amount),
    reimbursements: expensesByPayer.filter((p) => p.name.toLowerCase() !== BANK_PAYER.toLowerCase()),
  }
}

/** Split a profit (can be negative) by partner share %, rounding to cents. */
export function splitProfit<T extends { share_pct: number }>(profit: number, partners: T[]): (T & { amount: number })[] {
  return partners.map((p) => ({ ...p, amount: dollars(pctOf(cents(profit), p.share_pct)) }))
}
