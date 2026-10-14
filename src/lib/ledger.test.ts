import { describe, expect, it } from 'vitest'
import { ledgerCsv, partnerLedger, playerLedger, withBalances } from './ledger'
import type { AccountTx, PartnerEntry, PartnerShareWithGame, PlayerPayment } from './types'

let n = 0
const at = () => new Date(Date.UTC(2026, 9, 10, 20, n++)).toISOString()
const tx = (kind: AccountTx['kind'], amount: number, method: AccountTx['method']): AccountTx => ({
  id: `t${n}`, game_id: 'g', player_id: 'p', kind, amount, method, note: null, created_at: at(), updated_at: null,
  game_name: 'Friday game', game_date: '2026-10-10',
})
const pay = (direction: PlayerPayment['direction'], amount: number): PlayerPayment => ({
  id: `y${n}`, player_id: 'p', direction, amount, method: 'transfer', note: null, created_at: at(), updated_at: null,
})

describe('playerLedger', () => {
  it('cash play nets to zero; credit carries a balance until paid', () => {
    const entries = playerLedger('Rob', [
      tx('buy_in', 1000, 'cash'), // owes 1000, paid 1000 → 0
      tx('buy_in', 500, 'account'), // owes 500 → −500
      tx('cash_out', 300, 'account'), // credited 300 → −200
      tx('discount', 120, 'account'), // credited 120 → −80
    ], [pay('from_player', 50)]) // paid 50 → −30

    const { rows, totals } = withBalances(entries)
    expect(totals).toEqual({ owedToThem: 420, theyOwe: 1500, ourPayments: 0, theirPayments: 1050, balance: -30 })
    // newest first, each row carries the balance after it
    expect(rows.map((r) => r.balance)).toEqual([-30, -80, -200, -500, 0])
  })

  it('a cash cash-out is owed and paid in the same entry', () => {
    const { rows, totals } = withBalances(playerLedger('Jess', [tx('buy_in', 500, 'cash'), tx('cash_out', 1460, 'transfer')], []))
    expect(rows[0]).toMatchObject({ owedToThem: 1460, ourPayment: 1460, balance: 0 })
    expect(totals.balance).toBe(0)
  })
})

describe('partnerLedger', () => {
  it('shares (incl. losing nights), expenses, payouts and contributions', () => {
    const share = (amount: number, game_profit: number): PartnerShareWithGame => ({
      id: `s${n}`, game_id: 'g', partner_id: 'x', share_pct: 40, game_profit, amount, created_at: at(), game_name: 'G', game_date: '2026-10-01',
    })
    const entry = (kind: PartnerEntry['kind'], amount: number): PartnerEntry => ({
      id: `e${n}`, partner_id: 'x', kind, amount, method: 'cash', note: null, created_at: at(), updated_at: null,
    })
    const expense = {
      id: `x${n}`, game_id: 'g', category: 'food' as const, description: 'Pizza', amount: 90, partner_id: 'x', paid_by: 'Sam',
      created_at: at(), updated_at: null, game_name: 'G', game_date: '2026-10-01',
    }
    const entries = partnerLedger('Sam', [share(400, 1000), share(-100, -250)], [expense], [entry('contribution', 2000), entry('payout', 800)])
    const { totals } = withBalances(entries)
    expect(totals).toEqual({ owedToThem: 490, theyOwe: 100, ourPayments: 800, theirPayments: 2000, balance: 1590 })
  })
})

describe('ledgerCsv', () => {
  it('writes one row per entry, oldest first, with quoting', () => {
    const { rows } = withBalances(playerLedger('A, "B"', [tx('buy_in', 100, 'account')], [pay('from_player', 100)]))
    const csv = ledgerCsv(rows).split('\n')
    expect(csv).toHaveLength(3)
    expect(csv[1]).toContain('Buy-in on credit')
    expect(csv[2]).toContain('"Payment from A, ""B"""')
    expect(csv[2].endsWith(',0')).toBe(true)
  })
})
