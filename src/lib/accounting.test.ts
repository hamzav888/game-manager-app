import { describe, expect, it } from 'vitest'
import { discountRateFor, lossDiscountDue, splitProfit, summarizeGame, summarizePlayer } from './accounting'
import type { DealerTip, Expense, Player, Transaction } from './types'

let seq = 0
const at = () => new Date(Date.UTC(2026, 9, 8, 20, seq++)).toISOString()

const tx = (player_id: string, kind: Transaction['kind'], amount: number, method: Transaction['method'] = 'cash'): Transaction => ({
  id: `t${seq}`,
  game_id: 'g',
  player_id,
  kind,
  amount,
  method,
  note: null,
  created_at: at(),
  updated_at: null,
})
const tip = (dealer_name: string, amount: number, rake = 0): DealerTip => ({
  id: `d${seq}`, game_id: 'g', dealer_id: dealer_name.trim().toLowerCase(), dealer_name, amount, rake, method: 'cash', note: null, created_at: at(), updated_at: null,
})
const exp = (amount: number, paid_by: string, category: Expense['category'] = 'food'): Expense => ({
  id: `e${seq}`, game_id: 'g', category, description: null, amount, partner_id: null, paid_by, created_at: at(), updated_at: null,
})
const players = new Map<string, Player>(
  ['ali', 'bob', 'cat'].map((id) => [id, { id, name: id.toUpperCase(), phone: null, notes: null, loss_discount_pct: null, created_at: '' }]),
)

describe('summarizePlayer', () => {
  it('is seated until a cash-out follows the latest buy-in', () => {
    const a = tx('ali', 'buy_in', 1000)
    expect(summarizePlayer('ali', 'Ali', [a]).status).toBe('playing')
    const b = tx('ali', 'cash_out', 0)
    expect(summarizePlayer('ali', 'Ali', [a, b]).status).toBe('out')
    const c = tx('ali', 'buy_in', 500)
    const line = summarizePlayer('ali', 'Ali', [a, b, c])
    expect(line.status).toBe('playing')
    expect(line.buyIns).toBe(1500)
    expect(line.buyInCount).toBe(2)
  })
})

describe('summarizeGame', () => {
  it('computes player results, house take and profit', () => {
    const txs = [
      tx('ali', 'buy_in', 1000),
      tx('bob', 'buy_in', 500),
      tx('bob', 'buy_in', 500, 'transfer'),
      tx('cat', 'buy_in', 1000),
      tx('ali', 'cash_out', 1800),
      tx('bob', 'cash_out', 0),
      tx('cat', 'cash_out', 900),
    ]
    const s = summarizeGame(txs, [tip('Joe', 60), tip('joe ', 40)], [exp(120, 'Sam'), exp(30, 'Game bank', 'drinks')], players)

    expect(s.totalBuyIns).toBe(3000)
    expect(s.totalCashOuts).toBe(2700)
    expect(s.totalTips).toBe(100)
    expect(s.houseTake).toBe(200)
    expect(s.totalExpenses).toBe(150)
    expect(s.netProfit).toBe(50)
    expect(s.allCashedOut).toBe(true)
    expect(s.totalWon).toBe(800)
    expect(s.totalLost).toBe(1100)

    const net = Object.fromEntries(s.players.map((p) => [p.playerId, p.net]))
    expect(net).toEqual({ ali: 800, bob: -1000, cat: -100 })

    expect(s.dealers).toEqual([{ name: 'Joe', amount: 100, count: 2, rounds: 2, rake: 0, tax: 0, net: 100 }])
    expect(s.rakeReported).toBe(false)
    // nobody reported rake, so every chip the house kept shows as unaccounted
    expect(s.unaccounted).toBe(200)
    expect(s.reimbursements).toEqual([{ name: 'Sam', amount: 120, count: 1 }])
    expect(s.buyInsByMethod).toEqual([
      { method: 'cash', amount: 2500 },
      { method: 'transfer', amount: 500 },
    ])
  })

  it('tracks seated players while the game is live', () => {
    const s = summarizeGame([tx('ali', 'buy_in', 1000), tx('bob', 'buy_in', 300), tx('bob', 'cash_out', 450)], [], [], players)
    expect(s.seatedCount).toBe(1)
    expect(s.allCashedOut).toBe(false)
    expect(s.seatedBuyIns).toBe(1000)
    expect(s.bank).toBe(850)
  })

  it('sums cents without floating point drift', () => {
    const s = summarizeGame([tx('ali', 'buy_in', 0.1), tx('ali', 'buy_in', 0.2)], [], [], players)
    expect(s.totalBuyIns).toBe(0.3)
  })

  it('applies tip tax and loss discounts', () => {
    const txs = [
      tx('ali', 'buy_in', 1000),
      tx('bob', 'buy_in', 1000),
      tx('ali', 'cash_out', 1750),
      tx('bob', 'cash_out', 0),
      tx('bob', 'discount', 100),
    ]
    const s = summarizeGame(txs, [tip('Joe', 150)], [exp(40, 'Game bank')], players, { tipTaxPct: 20, lossDiscountPct: 10 })
    expect(s.totalDiscounts).toBe(100)
    expect(s.tipTax).toBe(30)
    expect(s.dealerNet).toBe(120)
    // house chips = 2000 − 1750 − 150 = 100 ; house take = 100 + 30
    expect(s.houseChips).toBe(100)
    expect(s.houseTake).toBe(130)
    // discounts are an expense: costs = 40 + 100
    expect(s.totalCosts).toBe(140)
    expect(s.netProfit).toBe(-10)
    expect(s.discountsByPlayer).toEqual([{ playerId: 'bob', name: 'BOB', amount: 100 }])
    expect(s.dealers[0]).toMatchObject({ name: 'Joe', amount: 150, tax: 30, net: 120 })
    const bob = s.players.find((p) => p.playerId === 'bob')!
    expect(bob.net).toBe(-900)
    expect(bob.discounts).toBe(100)
  })
})

describe('dealer rounds', () => {
  it('adds up reported rake and finds the over / short', () => {
    const txs = [tx('ali', 'buy_in', 1000), tx('bob', 'buy_in', 1000), tx('ali', 'cash_out', 1500), tx('bob', 'cash_out', 260)]
    const rounds = [tip('Marco', 20, 90), tip('Lucy', 0, 85), tip('Marco', 25, 0)]
    const s = summarizeGame(txs, rounds, [exp(30, 'Game bank')], players, { tipTaxPct: 20, lossDiscountPct: 0 })
    expect(s.rounds).toBe(3)
    expect(s.totalRake).toBe(175)
    expect(s.totalTips).toBe(45)
    expect(s.tipTax).toBe(9)
    // 2000 − 1760 − 45 − 175 = 20 over
    expect(s.unaccounted).toBe(20)
    expect(s.houseTake).toBe(204)
    expect(s.netProfit).toBe(174)
    // so far: rake + tip tax − costs, ignoring the $20 over
    expect(s.profitSoFar).toBe(154)
    expect(s.dealers.find((d) => d.name === 'Marco')).toMatchObject({ rounds: 2, rake: 90, amount: 45, tax: 9, net: 36 })
    expect(s.lastRoundAt).toBe(rounds[2].created_at)
  })

  it('shows chips still in play while people are seated', () => {
    const s = summarizeGame([tx('ali', 'buy_in', 1000), tx('bob', 'buy_in', 500)], [tip('Lucy', 10, 40)], [], players)
    expect(s.allCashedOut).toBe(false)
    expect(s.unaccounted).toBe(1450)
  })
})

describe('discountRateFor', () => {
  it('uses the player rate when set, else the game rate', () => {
    expect(discountRateFor({ loss_discount_pct: null }, 10)).toBe(10)
    expect(discountRateFor({ loss_discount_pct: 15 }, 10)).toBe(15)
    expect(discountRateFor({ loss_discount_pct: 0 }, 10)).toBe(0)
    expect(discountRateFor(undefined, 5)).toBe(5)
  })
})

describe('lossDiscountDue', () => {
  it('gives back the % of the loss, minus discounts already given', () => {
    const line = summarizePlayer('bob', 'Bob', [tx('bob', 'buy_in', 1000), tx('bob', 'buy_in', 500)])
    expect(lossDiscountDue(line, 300, 10)).toBe(120)
    expect(lossDiscountDue(line, 1600, 10)).toBe(0)
    expect(lossDiscountDue(line, 300, 0)).toBe(0)
    const withDiscount = summarizePlayer('bob', 'Bob', [...line.txs, tx('bob', 'cash_out', 300), tx('bob', 'discount', 120)])
    // editing that $300 cash-out down to $0: loss 1500 → due 150, 120 already given
    expect(lossDiscountDue(withDiscount, 0, 10, 300)).toBe(30)
  })
})

describe('splitProfit', () => {
  it('splits by share and handles losses', () => {
    expect(splitProfit(1000, [{ share_pct: 60 }, { share_pct: 40 }]).map((p) => p.amount)).toEqual([600, 400])
    expect(splitProfit(-250, [{ share_pct: 50 }]).map((p) => p.amount)).toEqual([-125])
  })
})

