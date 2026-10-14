// Realistic fake data for the /sample demo: a regular crew, three partners,
// ~12 closed nights and one game in progress right now. Deterministic, so
// every visit shows the same story.
import type {
  AuditEntry,
  DealerTip,
  Expense,
  ExpenseCategory,
  AdminAccount,
  Game,
  Member,
  Partner,
  PartnerEntry,
  PartnerShare,
  PayMethod,
  Player,
  PlayerPayment,
  Transaction,
} from '../types'

export const SAMPLE_EMAIL = 'sam@example.com'
export const SAMPLE_USER_ID = 'sample-user-sam'
export const SAMPLE_ORG_ID = 'sample-org'

export interface SampleOrg {
  id: string
  name: string
  tip_tax_pct: number
  loss_discount_pct: number
  created_at: string
}

export interface SampleDb {
  version: number
  org: SampleOrg
  members: Member[]
  /** every login in the app (the owner's view) */
  accounts: AdminAccount[]
  /** organizations other than the one you're browsing (owner's view only) */
  extraOrgs: { org: SampleOrg; members: Member[] }[]
  partners: Partner[]
  partner_entries: PartnerEntry[]
  partner_shares: PartnerShare[]
  players: Player[]
  player_payments: PlayerPayment[]
  games: Game[]
  transactions: Transaction[]
  dealer_tips: DealerTip[]
  expenses: Expense[]
  audit: AuditEntry[]
  nextAuditId: number
}

export const SAMPLE_VERSION = 8

let idSeq = 0
export const sampleId = () => `s-${Date.now().toString(36)}-${(idSeq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`

// Small seeded PRNG (mulberry32) so the demo is the same on every load.
function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const MEMBERS: Member[] = [
  { user_id: SAMPLE_USER_ID, email: SAMPLE_EMAIL, display_name: 'Sam', role: 'admin', active: true, created_at: '2026-05-01T18:00:00.000Z' },
  { user_id: 'sample-user-jordan', email: 'jordan@example.com', display_name: 'Jordan', role: 'organizer', active: true, created_at: '2026-05-01T18:05:00.000Z' },
  { user_id: 'sample-user-priya', email: 'priya@example.com', display_name: 'Priya', role: 'admin', active: true, created_at: '2026-06-12T18:05:00.000Z' },
]

const PLAYER_NAMES = [
  'Danny K.', 'Omar', 'Jess', 'Kev', 'Tariq', 'Mike R.', 'Lena', 'Big Rob',
  'Chris', 'Sana', 'Vik', 'Theo', 'Nadia', 'Bilal', 'Hector', 'Marcus',
]
const DEALERS = ['Marco', 'Lucy', 'Andre']
const TIP_TAX = 10
const LOSS_DISCOUNT = 10

function localDate(daysAgo: number): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - daysAgo)
  return d
}
const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const at = (day: Date, minutesAfter7pm: number) => new Date(day.getTime() + (19 * 60 + minutesAfter7pm) * 60000).toISOString()
const round5 = (n: number) => Math.round(n / 5) * 5
/** `daysAgo` at a given minute of the day, with some seconds so stamps look real. */
const afternoon = (daysAgo: number, minuteOfDay: number) =>
  new Date(localDate(daysAgo).getTime() + minuteOfDay * 60000 + ((daysAgo * 37) % 60) * 1000).toISOString()

const toCents = (n: number) => Math.round(n * 100)

/** A game's net profit, same formula as the game_totals view. */
export function gameNetProfit(db: SampleDb, g: Game): number {
  const txs = db.transactions.filter((t) => t.game_id === g.id)
  const of = (kind: Transaction['kind']) => txs.filter((t) => t.kind === kind).reduce((s, t) => s + toCents(t.amount), 0)
  const tips = db.dealer_tips.filter((t) => t.game_id === g.id).reduce((s, t) => s + toCents(t.amount), 0)
  const tax = Math.round((tips * g.tip_tax_pct) / 100)
  const expenses = db.expenses.filter((e) => e.game_id === g.id).reduce((s, e) => s + toCents(e.amount), 0)
  return (of('buy_in') - of('cash_out') - of('discount') - tips + tax - expenses) / 100
}

/** Mirror of the post_partner_shares trigger: freeze each partner's cut when a game closes. */
export function postShares(db: SampleDb, g: Game, when: string): PartnerShare[] {
  const profit = gameNetProfit(db, g)
  const rows = db.partners
    .filter((p) => p.active && p.share_pct > 0)
    .map((p) => ({
      id: sampleId(),
      game_id: g.id,
      partner_id: p.id,
      share_pct: p.share_pct,
      game_profit: profit,
      amount: Math.round(toCents(profit) * p.share_pct / 100) / 100,
      created_at: when,
    }))
  db.partner_shares.push(...rows)
  return rows
}

export function seedSample(): SampleDb {
  const r = rng(20261008)
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]
  const between = (a: number, b: number) => a + r() * (b - a)
  const gauss = () => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r())

  const db: SampleDb = {
    version: SAMPLE_VERSION,
    org: { id: SAMPLE_ORG_ID, name: 'Riverside Card Club', tip_tax_pct: TIP_TAX, loss_discount_pct: LOSS_DISCOUNT, created_at: '2026-05-01T18:00:00.000Z' },
    members: MEMBERS.map((m) => ({ ...m })),
    accounts: [
      ...MEMBERS.map((m, i) => ({
        id: m.user_id,
        email: m.email,
        display_name: m.display_name,
        approved: true,
        is_owner: i === 0,
        created_at: m.created_at,
        last_sign_in_at: localDate(i).toISOString(),
        organizations: null,
      })),
      { id: 'sample-user-dev', email: 'dev@example.com', display_name: 'Dev', approved: true, is_owner: false, created_at: '2026-07-02T17:00:00.000Z', last_sign_in_at: localDate(6).toISOString(), organizations: null },
      { id: 'sample-user-alex', email: 'alex@example.com', display_name: 'Alex', approved: false, is_owner: false, created_at: localDate(1).toISOString(), last_sign_in_at: localDate(1).toISOString(), organizations: null },
    ],
    extraOrgs: [
      {
        org: { id: 'sample-org-eastside', name: 'Eastside Home Game', tip_tax_pct: 0, loss_discount_pct: 5, created_at: '2026-07-02T17:05:00.000Z' },
        members: [
          { user_id: 'sample-user-priya', email: 'priya@example.com', display_name: 'Priya', role: 'admin', active: true, created_at: '2026-07-02T17:05:00.000Z' },
          { user_id: 'sample-user-dev', email: 'dev@example.com', display_name: 'Dev', role: 'organizer', active: true, created_at: '2026-07-02T17:06:00.000Z' },
        ],
      },
    ],
    partners: [],
    partner_entries: [],
    partner_shares: [],
    players: [],
    player_payments: [],
    games: [],
    transactions: [],
    dealer_tips: [],
    expenses: [],
    audit: [],
    nextAuditId: 1,
  }
  const events: Omit<AuditEntry, 'id'>[] = []
  const log = (
    table: AuditEntry['table_name'],
    action: AuditEntry['action'],
    oldRow: object | null,
    newRow: object | null,
    actor: string,
    when: string,
  ) => {
    const row = (newRow ?? oldRow) as Record<string, unknown>
    events.push({
      occurred_at: when,
      actor_email: actor,
      table_name: table,
      action,
      record_id: String(row.id ?? row.email),
      game_id: table === 'games' ? String(row.id) : ((row.game_id as string) ?? null),
      player_id: table === 'players' ? String(row.id) : ((row.player_id as string) ?? null),
      partner_id: table === 'partners' ? String(row.id) : ((row.partner_id as string) ?? null),
      old_data: oldRow ? { ...(oldRow as Record<string, unknown>) } : null,
      new_data: newRow ? { ...(newRow as Record<string, unknown>) } : null,
    })
  }
  const actor = () => (r() < 0.55 ? SAMPLE_EMAIL : r() < 0.7 ? 'jordan@example.com' : 'priya@example.com')

  // ------------------------------------------------ partners
  const founded = localDate(160).toISOString()
  for (const [name, email, share] of [
    ['Sam', SAMPLE_EMAIL, 40],
    ['Jordan', 'jordan@example.com', 35],
    ['Priya', 'priya@example.com', 25],
  ] as const) {
    const p: Partner = { id: sampleId(), name, email, share_pct: share, active: true, notes: null, created_at: founded }
    db.partners.push(p)
    log('partners', 'INSERT', null, p, SAMPLE_EMAIL, founded)
  }
  const partner = (name: string) => db.partners.find((p) => p.name === name)!
  const addEntry = (name: string, kind: PartnerEntry['kind'], amount: number, when: string, note: string | null) => {
    const e: PartnerEntry = { id: sampleId(), partner_id: partner(name).id, kind, amount, method: 'transfer', note, created_at: when, updated_at: null }
    db.partner_entries.push(e)
    log('partner_entries', 'INSERT', null, e, SAMPLE_EMAIL, when)
  }
  addEntry('Sam', 'contribution', 2000, afternoon(90, 15 * 60 + 12), 'Starting float for the cage')

  // ------------------------------------------------ players
  for (const name of PLAYER_NAMES) {
    const created = localDate(150 - Math.floor(r() * 30)).toISOString()
    const p: Player = { id: sampleId(), name, phone: null, notes: null, created_at: created }
    db.players.push(p)
    log('players', 'INSERT', null, p, SAMPLE_EMAIL, created)
  }
  db.players.find((p) => p.name === 'Big Rob')!.notes = 'Plays on account. Settles by transfer on Mondays.'
  db.players.find((p) => p.name === 'Lena')!.phone = '(555) 014-2290'
  const onAccount = new Set(['Big Rob', 'Tariq'].map((n) => db.players.find((p) => p.name === n)!.id))

  const addTx = (g: Game, p: Player, kind: Transaction['kind'], amount: number, when: string, method: PayMethod = 'cash') => {
    const t: Transaction = { id: sampleId(), game_id: g.id, player_id: p.id, kind, amount, method, note: null, created_at: when, updated_at: null }
    db.transactions.push(t)
    log('transactions', 'INSERT', null, t, actor(), when)
    return t
  }
  const addTip = (g: Game, dealer: string, amount: number, when: string) => {
    const t: DealerTip = { id: sampleId(), game_id: g.id, dealer_name: dealer, amount, note: null, created_at: when, updated_at: null }
    db.dealer_tips.push(t)
    log('dealer_tips', 'INSERT', null, t, actor(), when)
  }
  const addExpense = (g: Game, category: ExpenseCategory, amount: number, payer: string | null, description: string | null, when: string) => {
    const e: Expense = {
      id: sampleId(),
      game_id: g.id,
      category,
      description,
      amount,
      partner_id: payer ? partner(payer).id : null,
      paid_by: payer ?? 'Game bank',
      created_at: when,
      updated_at: null,
    }
    db.expenses.push(e)
    log('expenses', 'INSERT', null, e, actor(), when)
  }
  const pay = (p: Player, direction: PlayerPayment['direction'], amount: number, when: string, note: string | null) => {
    const row: PlayerPayment = { id: sampleId(), player_id: p.id, direction, amount, method: 'transfer', note, created_at: when, updated_at: null }
    db.player_payments.push(row)
    log('player_payments', 'INSERT', null, row, SAMPLE_EMAIL, when)
  }
  const method = (p: Player, cashChance: number): PayMethod =>
    onAccount.has(p.id) ? 'account' : r() < cashChance ? 'cash' : 'transfer'

  // ------------------------------------------------ past nights
  const pastDays = [82, 75, 68, 61, 54, 47, 40, 33, 26, 19, 12, 5]
  for (const [gi, daysAgo] of pastDays.entries()) {
    const day = localDate(daysAgo)
    const weekday = day.toLocaleDateString('en-US', { weekday: 'long' })
    const g: Game = {
      id: sampleId(),
      name: daysAgo === 33 ? 'High-roller night' : `${weekday} game`,
      game_date: isoDate(day),
      status: 'open',
      notes: null,
      created_at: at(day, -20),
      closed_at: null,
      tip_tax_pct: TIP_TAX,
      loss_discount_pct: LOSS_DISCOUNT,
    }
    db.games.push(g)
    log('games', 'INSERT', null, g, SAMPLE_EMAIL, g.created_at)

    const seats = [...db.players].sort(() => r() - 0.5).slice(0, 9 + Math.floor(r() * 4))
    const stake = daysAgo === 33 ? 2 : 1
    const ins = new Map<string, number>()
    for (const [i, p] of seats.entries()) {
      const first = (r() < 0.55 ? 1000 : 500) * stake
      addTx(g, p, 'buy_in', first, at(day, i * 4 + Math.floor(r() * 10)), method(p, 0.75))
      let total = first
      const roll = r()
      const rebuys = roll < 0.5 ? 0 : roll < 0.8 ? 1 : roll < 0.95 ? 2 : 3
      for (let k = 0; k < rebuys; k++) {
        const amt = (r() < 0.5 ? 500 : first / stake) * stake
        addTx(g, p, 'buy_in', amt, at(day, 60 + k * 50 + Math.floor(r() * 40)), method(p, 0.7))
        total += amt
      }
      ins.set(p.id, total)
    }

    const totalIn = [...ins.values()].reduce((a, b) => a + b, 0)
    const tips = round5(totalIn * between(0.01, 0.016))
    // One slow night where the room cost more than the rake brought in.
    const rake = round5(totalIn * (daysAgo === 47 ? 0.02 : between(0.075, 0.1)))
    const pool = totalIn - rake - tips

    const weights = seats.map((p, i) => (i > 1 && r() < 0.22 ? 0 : ins.get(p.id)! * Math.exp(gauss() * 0.75)))
    const wSum = weights.reduce((a, b) => a + b, 0)
    const outs = weights.map((w) => round5((pool * w) / wSum))
    const biggest = outs.indexOf(Math.max(...outs))
    outs[biggest] += pool - outs.reduce((a, b) => a + b, 0)
    seats.forEach((p, i) => {
      const when = at(day, 240 + i * 6 + Math.floor(r() * 30))
      const loss = ins.get(p.id)! - outs[i]
      // Credit players run a tab: their cash-outs are netted against it too.
      const m: PayMethod = onAccount.has(p.id) ? 'account' : r() < 0.7 ? 'cash' : 'transfer'
      addTx(g, p, 'cash_out', outs[i], when, m)
      if (loss > 0) addTx(g, p, 'discount', Math.round((loss * LOSS_DISCOUNT) / 100), when, m === 'account' ? 'account' : 'cash')
    })

    const tipA = round5(tips * between(0.4, 0.6))
    addTip(g, pick(DEALERS), tipA, at(day, 150))
    if (tips - tipA > 0) addTip(g, pick(DEALERS), tips - tipA, at(day, 280))

    addExpense(g, 'food', round5(between(70, 190)), pick(['Sam', 'Jordan', 'Priya']), pick(['Pizza', 'Wings & fries', 'Shawarma platters', 'Tacos']), at(day, 30))
    if (r() < 0.5) addExpense(g, 'drinks', round5(between(35, 90)), null, 'Drinks & ice', at(day, 45))
    if (r() < 0.6) addExpense(g, 'dealer_pay', round5(between(150, 260)), null, 'Dealer shift', at(day, 300))
    if (daysAgo === 33) addExpense(g, 'venue', 300, 'Jordan', 'Back room rental', at(day, 0))
    if (daysAgo === 47) addExpense(g, 'venue', 350, 'Priya', 'Hall booking', at(day, 0))

    const before = { ...g }
    g.status = 'closed'
    g.closed_at = at(day, 330)
    log('games', 'UPDATE', before, { ...g }, SAMPLE_EMAIL, g.closed_at)
    for (const share of postShares(db, g, g.closed_at)) log('partner_shares', 'INSERT', null, share, SAMPLE_EMAIL, g.closed_at)

    // Partners take a payout every four weeks.
    if (gi % 4 === 3) {
      const payDay = afternoon(daysAgo - 2, 14 * 60 + 37)
      addEntry('Sam', 'payout', 800, payDay, 'Monthly split')
      addEntry('Jordan', 'payout', 700, payDay, 'Monthly split')
      addEntry('Priya', 'payout', 500, payDay, 'Monthly split')
    }
  }

  // Account players pay down part of their tab.
  for (const [i, pid] of [...onAccount].entries()) {
    const owed = -db.transactions
      .filter((t) => t.player_id === pid && t.method === 'account')
      .reduce((s, t) => s + (t.kind === 'buy_in' ? -t.amount : t.amount), 0)
    const amount = Math.floor((owed * 0.6) / 100) * 100
    if (amount > 0)
      pay(db.players.find((p) => p.id === pid)!, 'from_player', amount, afternoon(i ? 9 : 30, 13 * 60 + 8 + i * 41), i ? 'Partial payment' : 'E-transfer')
  }

  // A correction on a past night, so the history shows an edit.
  const fix = db.transactions.find((t) => t.kind === 'buy_in' && t.amount === 1000)
  if (fix) {
    const old = { ...fix }
    fix.amount = 500
    fix.updated_at = new Date(new Date(fix.created_at).getTime() + 20 * 60000).toISOString()
    log('transactions', 'UPDATE', old, { ...fix }, 'jordan@example.com', fix.updated_at)
  }

  // ------------------------------------------------ tonight (live)
  const now = Date.now()
  const ago = (min: number) => new Date(now - min * 60000).toISOString()
  const today = localDate(0)
  const live: Game = {
    id: sampleId(),
    name: `${today.toLocaleDateString('en-US', { weekday: 'long' })} game`,
    game_date: isoDate(today),
    status: 'open',
    notes: null,
    created_at: ago(200),
    closed_at: null,
    tip_tax_pct: TIP_TAX,
    loss_discount_pct: LOSS_DISCOUNT,
  }
  db.games.push(live)
  log('games', 'INSERT', null, live, SAMPLE_EMAIL, live.created_at)

  const P = (name: string) => db.players.find((p) => p.name === name)!
  const plan: [string, number[], number | null][] = [
    ['Danny K.', [1000], null],
    ['Omar', [1000, 500], null],
    ['Jess', [500], 1460],
    ['Kev', [1000], null],
    ['Tariq', [1000, 1000], null],
    ['Lena', [500], 0],
    ['Big Rob', [500, 500, 500], null],
    ['Chris', [1000], 1915],
    ['Sana', [1000], null],
    ['Vik', [500], 380],
    ['Theo', [1000], null],
  ]
  plan.forEach(([name, buys, out], i) => {
    const p = P(name)
    buys.forEach((b, j) => addTx(live, p, 'buy_in', b, ago(190 - i * 4 - j * 55), onAccount.has(p.id) && j > 0 ? 'account' : 'cash'))
    if (out !== null) {
      addTx(live, p, 'cash_out', out, ago(48 - i * 3))
      const loss = buys.reduce((a, b) => a + b, 0) - out
      if (loss > 0) addTx(live, p, 'discount', Math.round((loss * LOSS_DISCOUNT) / 100), ago(48 - i * 3))
    }
  })
  addTip(live, 'Marco', 45, ago(95))
  addTip(live, 'Lucy', 30, ago(25))
  addExpense(live, 'food', 145, 'Jordan', 'Wings & fries', ago(150))
  addExpense(live, 'drinks', 40, null, 'Ice & mixers', ago(120))

  // ------------------------------------------------ finalize audit log in time order
  events.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
  db.audit = events.map((e, i) => ({ ...e, id: i + 1 }))
  db.nextAuditId = db.audit.length + 1
  return db
}
