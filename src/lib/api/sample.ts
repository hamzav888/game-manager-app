// In-browser data layer for the /sample demo. Same functions and rules as the
// Supabase version (closed games lock, unique names, audit log, last admin…),
// but everything lives in this tab's sessionStorage. Nothing leaves the browser.
import type {
  AccountTx,
  AuditEntry,
  AuditFilter,
  AuditTable,
  DealerTip,
  Expense,
  Game,
  GameData,
  GameTotals,
  AdminAccount,
  AdminOrg,
  Member,
  MyOrg,
  Partner,
  PartnerAccount,
  PartnerEntry,
  PartnerShareWithGame,
  Player,
  PlayerGameResult,
  PlayerPayment,
  PlayerTotals,
  Role,
  Settings,
  Transaction,
} from '../types'
import { emitSampleChange } from './sampleBus'
import { SAMPLE_EMAIL, SAMPLE_USER_ID, SAMPLE_VERSION, postShares, sampleId, seedSample } from './sampleSeed'
import type { SampleDb } from './sampleSeed'
import type { ExpenseInput, PartnerEntryInput, PartnerInput, PaymentInput, TipInput, TxInput } from './supabase'

const KEY = 'poker-ledger:sample'
const TABLES = [
  'organizations', 'memberships', 'players', 'games', 'transactions', 'dealer_tips', 'expenses',
  'partners', 'partner_entries', 'partner_shares', 'player_payments', 'audit_log',
]

function load(): SampleDb {
  try {
    const raw = sessionStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as SampleDb) : null
    if (parsed?.version === SAMPLE_VERSION) return parsed
  } catch {
    /* storage unavailable or corrupt: start fresh */
  }
  return seedSample()
}

let db = load()

function persist() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(db))
  } catch {
    /* storage unavailable: keep working in memory */
  }
}

/** Throw away every change and start over with the original sample data. */
export function resetSample() {
  db = seedSample()
  persist()
  TABLES.forEach(emitSampleChange)
}

const latency = () => new Promise((r) => setTimeout(r, 70))
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T
const now = () => new Date().toISOString()
const cents = (n: number) => Math.round(n * 100)
const sum = (xs: number[]) => xs.reduce((s, x) => s + cents(x), 0) / 100

function fail(message: string): never {
  throw new Error(message)
}

function audit(table: AuditTable, action: AuditEntry['action'], oldRow: object | null, newRow: object | null) {
  const row = (newRow ?? oldRow) as Record<string, unknown>
  db.audit.push({
    id: db.nextAuditId++,
    occurred_at: now(),
    actor_id: SAMPLE_USER_ID,
    actor_email: SAMPLE_EMAIL,
    table_name: table,
    action,
    record_id: String(row.id ?? row.user_id),
    game_id: table === 'games' ? String(row.id) : ((row.game_id as string) ?? null),
    player_id: table === 'players' ? String(row.id) : ((row.player_id as string) ?? null),
    partner_id: table === 'partners' ? String(row.id) : ((row.partner_id as string) ?? null),
    old_data: oldRow ? copy(oldRow as Record<string, unknown>) : null,
    new_data: newRow ? copy(newRow as Record<string, unknown>) : null,
  })
}

function commit(...tables: string[]) {
  persist()
  for (const t of [...tables, 'audit_log']) emitSampleChange(t)
}

function assertOpen(gameId: string) {
  if (db.games.find((g) => g.id === gameId)?.status !== 'open')
    fail('Not allowed. You may not have permission, or the game is closed.')
}

function find<T extends { id: string }>(rows: T[], id: string): T {
  return rows.find((r) => r.id === id) ?? fail('Change not saved — that record no longer exists.')
}

function validAmount(amount: number, allowZero: boolean) {
  if (!(amount >= 0) || amount > 10_000_000 || (!allowZero && amount === 0)) fail('Invalid value — check the amount and fields.')
}

function validPct(n: number | undefined) {
  if (n !== undefined && !(n >= 0 && n <= 100)) fail('Percentages must be between 0 and 100.')
}

// ---------------------------------------------------------------- organization & members

const SAMPLE_ONLY = 'In the sample you browse one organization. Create real ones in the real app.'

export async function whoAmI(): Promise<{ is_owner: boolean; approved: boolean }> {
  await latency()
  return { is_owner: true, approved: true }
}

export async function listMyOrganizations(): Promise<MyOrg[]> {
  await latency()
  const me = db.members.find((m) => m.user_id === SAMPLE_USER_ID)!
  return [{ ...copy(db.org), role: me.role, active: me.active, joined_at: me.created_at }]
}

export async function updateOrganization(patch: { name?: string; tip_tax_pct?: number; loss_discount_pct?: number }) {
  await latency()
  validPct(patch.tip_tax_pct)
  validPct(patch.loss_discount_pct)
  if (patch.name !== undefined && !patch.name.trim()) fail('Give the organization a name.')
  const before = { ...db.org }
  Object.assign(db.org, patch)
  audit('organizations', 'UPDATE', before, db.org)
  commit('organizations')
}

/** All organizations with their member lists (the browsed one first). */
function allOrgs() {
  return [{ org: db.org, members: db.members }, ...db.extraOrgs]
}
function orgEntry(id: string) {
  return allOrgs().find((o) => o.org.id === id) ?? fail('Organization not found.')
}

function protectLastAdmin(members: Member[], m: Member, next: Member | null) {
  const losingAdmin = m.role === 'admin' && m.active && (!next || next.role !== 'admin' || !next.active)
  if (losingAdmin && !members.some((x) => x.user_id !== m.user_id && x.role === 'admin' && x.active))
    fail('An organization needs at least one active admin. Make someone else an admin first.')
}

const memberRow = (orgId: string, m: Member) => ({ org_id: orgId, user_id: m.user_id, role: m.role, active: m.active })

function addTo(orgId: string, email: string, role: Role) {
  const acct = db.accounts.find((a) => a.email === email.trim().toLowerCase() && a.approved)
  if (!acct) fail(`No account uses ${email.trim().toLowerCase()}. Ask the app owner to create it first.`)
  const entry = orgEntry(orgId)
  const existing = entry.members.find((m) => m.user_id === acct.id)
  if (existing) {
    const before = memberRow(orgId, existing)
    Object.assign(existing, { role, active: true })
    if (orgId === db.org.id) audit('memberships', 'UPDATE', before, memberRow(orgId, existing))
  } else {
    const m: Member = { user_id: acct.id, email: acct.email, display_name: acct.display_name, role, active: true, created_at: now() }
    entry.members.push(m)
    if (orgId === db.org.id) audit('memberships', 'INSERT', null, memberRow(orgId, m))
  }
  commit('memberships')
}

function updateIn(orgId: string, userId: string, patch: { role?: Role; active?: boolean }) {
  const entry = orgEntry(orgId)
  const m = entry.members.find((x) => x.user_id === userId) ?? fail('That member is no longer in this organization.')
  protectLastAdmin(entry.members, m, { ...m, ...patch })
  const before = memberRow(orgId, m)
  Object.assign(m, patch)
  if (orgId === db.org.id) audit('memberships', 'UPDATE', before, memberRow(orgId, m))
  commit('memberships')
}

function removeFrom(orgId: string, userId: string) {
  const entry = orgEntry(orgId)
  const m = entry.members.find((x) => x.user_id === userId) ?? fail('That member is no longer in this organization.')
  if (orgId === db.org.id && userId === SAMPLE_USER_ID) fail(SAMPLE_ONLY)
  protectLastAdmin(entry.members, m, null)
  entry.members.splice(entry.members.indexOf(m), 1)
  if (orgId === db.org.id) audit('memberships', 'DELETE', memberRow(orgId, m), null)
  commit('memberships')
}

export async function listMembers(): Promise<Member[]> {
  await latency()
  return copy(db.members)
}

export async function addMember(email: string, role: Role) {
  await latency()
  addTo(db.org.id, email, role)
}

export async function updateMember(userId: string, patch: { role?: Role; active?: boolean }) {
  await latency()
  updateIn(db.org.id, userId, patch)
}

export async function removeMember(userId: string) {
  await latency()
  removeFrom(db.org.id, userId)
}

export async function updateMyProfile(userId: string, patch: { display_name: string | null }) {
  await latency()
  for (const o of allOrgs()) for (const m of o.members) if (m.user_id === userId) m.display_name = patch.display_name
  const a = db.accounts.find((x) => x.id === userId)
  if (a) a.display_name = patch.display_name
  commit('memberships')
}

// ---------------------------------------------------------------- owner (app admin)

export async function createOrganization(name: string, adminUserId?: string | null): Promise<string> {
  await latency()
  if (!name.trim()) fail('Give the organization a name.')
  const admin = db.accounts.find((a) => a.id === (adminUserId ?? SAMPLE_USER_ID) && a.approved) ?? fail('That account isn’t approved yet.')
  const org = { id: sampleId(), name: name.trim(), tip_tax_pct: 0, loss_discount_pct: 0, created_at: now() }
  db.extraOrgs.unshift({
    org,
    members: [{ user_id: admin.id, email: admin.email, display_name: admin.display_name, role: 'admin', active: true, created_at: now() }],
  })
  commit('organizations')
  return org.id
}

export async function adminListAccounts(): Promise<AdminAccount[]> {
  await latency()
  return copy(
    db.accounts.map((a) => ({
      ...a,
      organizations:
        allOrgs()
          .flatMap((o) => o.members.filter((m) => m.user_id === a.id && m.active).map((m) => `${o.org.name}${m.role === 'admin' ? ' (admin)' : ''}`))
          .join(', ') || null,
    })),
  )
}

export async function adminListOrganizations(): Promise<AdminOrg[]> {
  await latency()
  return allOrgs().map(({ org, members }) => ({
    id: org.id,
    name: org.name,
    created_at: org.created_at,
    members: members.filter((m) => m.active).length,
    admins: members.filter((m) => m.active && m.role === 'admin').map((m) => m.display_name || m.email).join(', ') || null,
  }))
}

export async function adminCreateAccount(a: { email: string; password: string; name: string }): Promise<string> {
  await latency()
  const email = a.email.trim().toLowerCase()
  if (db.accounts.some((x) => x.email === email)) fail('An account with that email already exists.')
  if (a.password.length < 8) fail('Passwords need at least 8 characters.')
  const id = sampleId()
  db.accounts.unshift({
    id, email, display_name: a.name.trim() || email.split('@')[0], approved: true, is_owner: false,
    created_at: now(), last_sign_in_at: null, organizations: null,
  })
  commit('memberships')
  return id
}

export async function adminSetApproved(userId: string, approved: boolean) {
  await latency()
  const a = db.accounts.find((x) => x.id === userId) ?? fail('Account not found.')
  if (!approved && a.is_owner) fail('The owner account is always approved.')
  a.approved = approved
  if (!approved) for (const o of allOrgs()) for (const m of o.members) if (m.user_id === userId) m.active = false
  commit('memberships')
}

export async function adminSetPassword(_userId: string, password: string) {
  await latency()
  if (password.length < 8) fail('Passwords need at least 8 characters.')
}

export async function adminOrgMembers(org: string): Promise<Member[]> {
  await latency()
  return copy(orgEntry(org).members)
}

export async function adminAddMember(org: string, email: string, role: Role) {
  await latency()
  addTo(org, email, role)
}

export async function adminUpdateMember(org: string, userId: string, patch: { role?: Role; active?: boolean }) {
  await latency()
  updateIn(org, userId, patch)
}

export async function adminRemoveMember(org: string, userId: string) {
  await latency()
  removeFrom(org, userId)
}

export async function adminRenameOrganization(org: string, name: string) {
  await latency()
  if (!name.trim()) fail('Give the organization a name.')
  orgEntry(org).org.name = name.trim()
  commit('organizations')
}

// ---------------------------------------------------------------- players

export async function listPlayers(): Promise<Player[]> {
  await latency()
  return copy([...db.players].sort((a, b) => a.name.localeCompare(b.name)))
}

function assertUniqueName(rows: { id: string; name: string }[], name: string, exceptId?: string) {
  const key = name.trim().toLowerCase()
  if (rows.some((p) => p.id !== exceptId && p.name.trim().toLowerCase() === key)) fail('That already exists — names must be unique.')
}

export async function createPlayer(name: string): Promise<Player> {
  await latency()
  assertUniqueName(db.players, name)
  const p: Player = { id: sampleId(), name: name.trim(), phone: null, notes: null, created_at: now() }
  db.players.push(p)
  audit('players', 'INSERT', null, p)
  commit('players')
  return copy(p)
}

export async function updatePlayer(id: string, patch: Partial<Pick<Player, 'name' | 'phone' | 'notes'>>) {
  await latency()
  const p = find(db.players, id)
  if (patch.name !== undefined) assertUniqueName(db.players, patch.name, id)
  const before = { ...p }
  Object.assign(p, patch)
  audit('players', 'UPDATE', before, p)
  commit('players')
}

export async function deletePlayer(id: string) {
  await latency()
  const p = find(db.players, id)
  if (db.transactions.some((t) => t.player_id === id) || db.player_payments.some((t) => t.player_id === id))
    fail('This is still in use (it has buy-ins or cash-outs), so it cannot be deleted.')
  db.players = db.players.filter((x) => x !== p)
  audit('players', 'DELETE', p, null)
  commit('players')
}

function results(): PlayerGameResult[] {
  const games = new Map(db.games.map((g) => [g.id, g]))
  const map = new Map<string, { r: PlayerGameResult; inC: number; outC: number; discC: number }>()
  for (const t of db.transactions) {
    const g = games.get(t.game_id)
    if (!g) continue
    const key = `${t.player_id}|${g.id}`
    const acc = map.get(key) ?? {
      r: {
        player_id: t.player_id, game_id: g.id, game_name: g.name, game_date: g.game_date, game_status: g.status,
        buy_ins: 0, cash_outs: 0, discounts: 0, buy_in_count: 0, net: 0,
      },
      inC: 0, outC: 0, discC: 0,
    }
    if (t.kind === 'buy_in') {
      acc.inC += cents(t.amount)
      acc.r.buy_in_count += 1
    } else if (t.kind === 'cash_out') acc.outC += cents(t.amount)
    else acc.discC += cents(t.amount)
    map.set(key, acc)
  }
  return [...map.values()].map(({ r, inC, outC, discC }) => ({
    ...r,
    buy_ins: inC / 100,
    cash_outs: outC / 100,
    discounts: discC / 100,
    net: (outC + discC - inC) / 100,
  }))
}

function balanceOf(playerId: string): number {
  const onAccount = db.transactions
    .filter((t) => t.player_id === playerId && t.method === 'account')
    .reduce((s, t) => s + (t.kind === 'buy_in' ? -cents(t.amount) : cents(t.amount)), 0)
  const settled = db.player_payments
    .filter((p) => p.player_id === playerId)
    .reduce((s, p) => s + (p.direction === 'from_player' ? cents(p.amount) : -cents(p.amount)), 0)
  return (onAccount + settled) / 100
}

function totalsFor(p: Player, all: PlayerGameResult[]): PlayerTotals {
  const mine = all.filter((r) => r.player_id === p.id)
  const closed = mine.filter((r) => r.game_status === 'closed')
  return {
    ...p,
    games_played: mine.length,
    total_buy_ins: sum(closed.map((r) => r.buy_ins)),
    total_cash_outs: sum(closed.map((r) => r.cash_outs)),
    total_discounts: sum(closed.map((r) => r.discounts)),
    net: sum(closed.map((r) => r.net)),
    last_played: mine.map((r) => r.game_date).sort().at(-1) ?? null,
    balance: balanceOf(p.id),
  }
}

export async function listPlayerTotals(): Promise<PlayerTotals[]> {
  await latency()
  const all = results()
  return copy([...db.players].sort((a, b) => a.name.localeCompare(b.name)).map((p) => totalsFor(p, all)))
}

export async function getPlayerTotals(id: string): Promise<PlayerTotals | null> {
  await latency()
  const p = db.players.find((x) => x.id === id)
  return p ? copy(totalsFor(p, results())) : null
}

export async function getPlayerResults(playerId: string): Promise<PlayerGameResult[]> {
  await latency()
  return results()
    .filter((r) => r.player_id === playerId)
    .sort((a, b) => b.game_date.localeCompare(a.game_date))
}

// ---------------------------------------------------------------- games

function totalsOf(g: Game): GameTotals {
  const txs = db.transactions.filter((t) => t.game_id === g.id)
  const of = (kind: Transaction['kind']) => sum(txs.filter((t) => t.kind === kind).map((t) => t.amount))
  const buyIns = of('buy_in')
  const cashOuts = of('cash_out')
  const discounts = of('discount')
  const tips = sum(db.dealer_tips.filter((t) => t.game_id === g.id).map((t) => t.amount))
  const tipTax = Math.round((cents(tips) * g.tip_tax_pct) / 100) / 100
  const expenses = sum(db.expenses.filter((e) => e.game_id === g.id).map((e) => e.amount))
  const house = (cents(buyIns) - cents(cashOuts) - cents(discounts) - cents(tips) + cents(tipTax)) / 100
  return {
    ...copy(g),
    total_buy_ins: buyIns,
    total_cash_outs: cashOuts,
    total_discounts: discounts,
    player_count: new Set(txs.map((t) => t.player_id)).size,
    total_tips: tips,
    tip_tax: tipTax,
    total_expenses: expenses,
    house_take: house,
    net_profit: (cents(house) - cents(expenses)) / 100,
  }
}

export async function listGameTotals(): Promise<GameTotals[]> {
  await latency()
  return [...db.games]
    .sort((a, b) => b.game_date.localeCompare(a.game_date) || b.created_at.localeCompare(a.created_at))
    .map(totalsOf)
}

export async function createGame(g: { name: string; game_date: string }): Promise<Game> {
  await latency()
  const row: Game = {
    id: sampleId(),
    name: g.name,
    game_date: g.game_date,
    status: 'open',
    notes: null,
    created_at: now(),
    closed_at: null,
    tip_tax_pct: db.org.tip_tax_pct,
    loss_discount_pct: db.org.loss_discount_pct,
  }
  db.games.push(row)
  audit('games', 'INSERT', null, row)
  commit('games')
  return copy(row)
}

export async function updateGame(
  id: string,
  patch: Partial<Pick<Game, 'name' | 'game_date' | 'notes' | 'status' | 'tip_tax_pct' | 'loss_discount_pct'>>,
) {
  await latency()
  const g = find(db.games, id)
  validPct(patch.tip_tax_pct)
  validPct(patch.loss_discount_pct)
  const before = { ...g }
  Object.assign(g, patch)
  if (patch.status && patch.status !== before.status) g.closed_at = patch.status === 'closed' ? now() : null
  audit('games', 'UPDATE', before, g)
  // Mirror the post_partner_shares trigger.
  if (g.status === 'closed' && before.status !== 'closed') {
    for (const share of postShares(db, g, now())) audit('partner_shares', 'INSERT', null, share)
  } else if (g.status === 'open' && before.status === 'closed') {
    for (const share of db.partner_shares.filter((x) => x.game_id === id)) audit('partner_shares', 'DELETE', share, null)
    db.partner_shares = db.partner_shares.filter((x) => x.game_id !== id)
  }
  commit('games', 'partner_shares', 'partners')
}

export async function deleteGame(id: string) {
  await latency()
  const g = find(db.games, id)
  // Mirror ON DELETE CASCADE, logging each removed row like the database trigger does.
  for (const t of db.transactions.filter((x) => x.game_id === id)) audit('transactions', 'DELETE', t, null)
  for (const t of db.dealer_tips.filter((x) => x.game_id === id)) audit('dealer_tips', 'DELETE', t, null)
  for (const e of db.expenses.filter((x) => x.game_id === id)) audit('expenses', 'DELETE', e, null)
  for (const sh of db.partner_shares.filter((x) => x.game_id === id)) audit('partner_shares', 'DELETE', sh, null)
  db.partner_shares = db.partner_shares.filter((x) => x.game_id !== id)
  db.transactions = db.transactions.filter((x) => x.game_id !== id)
  db.dealer_tips = db.dealer_tips.filter((x) => x.game_id !== id)
  db.expenses = db.expenses.filter((x) => x.game_id !== id)
  db.games = db.games.filter((x) => x !== g)
  audit('games', 'DELETE', g, null)
  commit('games', 'transactions', 'dealer_tips', 'expenses', 'partner_shares', 'partners')
}

export async function getGameData(gameId: string): Promise<GameData> {
  await latency()
  const byTime = <T extends { created_at: string }>(rows: T[]) => [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))
  return copy({
    game: db.games.find((g) => g.id === gameId) ?? null,
    txs: byTime(db.transactions.filter((t) => t.game_id === gameId)),
    tips: byTime(db.dealer_tips.filter((t) => t.game_id === gameId)),
    expenses: byTime(db.expenses.filter((e) => e.game_id === gameId)),
  })
}

// ---------------------------------------------------------------- money rows

export async function addTx(t: TxInput) {
  await latency()
  assertOpen(t.game_id)
  validAmount(t.amount, t.kind === 'cash_out')
  const row: Transaction = { ...t, id: sampleId(), created_at: now(), updated_at: null }
  db.transactions.push(row)
  audit('transactions', 'INSERT', null, row)
  commit('transactions')
}

export async function updateTx(id: string, patch: Partial<Pick<Transaction, 'amount' | 'method' | 'note'>>) {
  await latency()
  const t = find(db.transactions, id)
  assertOpen(t.game_id)
  if (patch.amount !== undefined) validAmount(patch.amount, t.kind === 'cash_out')
  const before = { ...t }
  Object.assign(t, patch, { updated_at: now() })
  audit('transactions', 'UPDATE', before, t)
  commit('transactions')
}

export async function deleteTx(id: string) {
  await latency()
  const t = find(db.transactions, id)
  assertOpen(t.game_id)
  db.transactions = db.transactions.filter((x) => x !== t)
  audit('transactions', 'DELETE', t, null)
  commit('transactions')
}

export async function addTip(t: TipInput) {
  await latency()
  assertOpen(t.game_id)
  validAmount(t.amount, false)
  const row: DealerTip = { ...t, id: sampleId(), created_at: now(), updated_at: null }
  db.dealer_tips.push(row)
  audit('dealer_tips', 'INSERT', null, row)
  commit('dealer_tips')
}

export async function updateTip(id: string, patch: Partial<Omit<TipInput, 'game_id'>>) {
  await latency()
  const t = find(db.dealer_tips, id)
  assertOpen(t.game_id)
  if (patch.amount !== undefined) validAmount(patch.amount, false)
  const before = { ...t }
  Object.assign(t, patch, { updated_at: now() })
  audit('dealer_tips', 'UPDATE', before, t)
  commit('dealer_tips')
}

export async function deleteTip(id: string) {
  await latency()
  const t = find(db.dealer_tips, id)
  assertOpen(t.game_id)
  db.dealer_tips = db.dealer_tips.filter((x) => x !== t)
  audit('dealer_tips', 'DELETE', t, null)
  commit('dealer_tips')
}

function paidByLabel(partnerId: string | null): string {
  if (!partnerId) return 'Game bank'
  return find(db.partners, partnerId).name
}

export async function addExpense(e: ExpenseInput) {
  await latency()
  assertOpen(e.game_id)
  validAmount(e.amount, false)
  const row: Expense = { ...e, paid_by: paidByLabel(e.partner_id), id: sampleId(), created_at: now(), updated_at: null }
  db.expenses.push(row)
  audit('expenses', 'INSERT', null, row)
  commit('expenses', 'partners')
}

export async function updateExpense(id: string, patch: Partial<Omit<ExpenseInput, 'game_id'>>) {
  await latency()
  const e = find(db.expenses, id)
  assertOpen(e.game_id)
  if (patch.amount !== undefined) validAmount(patch.amount, false)
  const before = { ...e }
  Object.assign(e, patch, { updated_at: now() })
  e.paid_by = paidByLabel(e.partner_id)
  audit('expenses', 'UPDATE', before, e)
  commit('expenses', 'partners')
}

export async function deleteExpense(id: string) {
  await latency()
  const e = find(db.expenses, id)
  assertOpen(e.game_id)
  db.expenses = db.expenses.filter((x) => x !== e)
  audit('expenses', 'DELETE', e, null)
  commit('expenses', 'partners')
}

export async function recentDealerNames(): Promise<string[]> {
  await latency()
  const seen = new Map<string, string>()
  for (const t of [...db.dealer_tips].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    const k = t.dealer_name.trim().toLowerCase()
    if (!seen.has(k)) seen.set(k, t.dealer_name.trim())
  }
  return [...seen.values()].slice(0, 8)
}

// ---------------------------------------------------------------- house rules (on the organization)

export async function getSettings(): Promise<Settings> {
  await latency()
  return { tip_tax_pct: db.org.tip_tax_pct, loss_discount_pct: db.org.loss_discount_pct }
}

export const updateSettings = (patch: Partial<Settings>) => updateOrganization(patch)

// ---------------------------------------------------------------- partners

export async function listPartnerAccounts(): Promise<PartnerAccount[]> {
  await latency()
  return copy(
    [...db.partners]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => {
        const expensesPaid = sum(db.expenses.filter((e) => e.partner_id === p.id).map((e) => e.amount))
        const entries = db.partner_entries.filter((e) => e.partner_id === p.id)
        const contributions = sum(entries.filter((e) => e.kind === 'contribution').map((e) => e.amount))
        const payouts = sum(entries.filter((e) => e.kind === 'payout').map((e) => e.amount))
        const share = sum(db.partner_shares.filter((s) => s.partner_id === p.id).map((s) => s.amount))
        return {
          ...p,
          expenses_paid: expensesPaid,
          profit_share: share,
          contributions,
          payouts,
          balance: (cents(expensesPaid) + cents(share) + cents(contributions) - cents(payouts)) / 100,
        }
      }),
  )
}

export async function createPartner(p: PartnerInput): Promise<Partner> {
  await latency()
  assertUniqueName(db.partners, p.name)
  validPct(p.share_pct)
  const row: Partner = { ...p, name: p.name.trim(), id: sampleId(), active: true, created_at: now() }
  db.partners.push(row)
  audit('partners', 'INSERT', null, row)
  commit('partners')
  return copy(row)
}

export async function updatePartner(id: string, patch: Partial<PartnerInput & { active: boolean }>) {
  await latency()
  const p = find(db.partners, id)
  if (patch.name !== undefined) assertUniqueName(db.partners, patch.name, id)
  validPct(patch.share_pct)
  const before = { ...p }
  Object.assign(p, patch)
  audit('partners', 'UPDATE', before, p)
  commit('partners')
}

export async function deletePartner(id: string) {
  await latency()
  const p = find(db.partners, id)
  if (
    db.expenses.some((e) => e.partner_id === id) ||
    db.partner_entries.some((e) => e.partner_id === id) ||
    db.partner_shares.some((e) => e.partner_id === id)
  )
    fail('This is still in use (it has expenses or payouts), so it cannot be deleted.')
  db.partners = db.partners.filter((x) => x !== p)
  audit('partners', 'DELETE', p, null)
  commit('partners')
}

export async function listPartnerEntries(partnerId: string): Promise<PartnerEntry[]> {
  await latency()
  return copy(db.partner_entries.filter((e) => e.partner_id === partnerId).sort((a, b) => b.created_at.localeCompare(a.created_at)))
}

export async function addPartnerEntry(e: PartnerEntryInput) {
  await latency()
  find(db.partners, e.partner_id)
  validAmount(e.amount, false)
  const row: PartnerEntry = { ...e, id: sampleId(), created_at: now(), updated_at: null }
  db.partner_entries.push(row)
  audit('partner_entries', 'INSERT', null, row)
  commit('partner_entries', 'partners')
}

export async function deletePartnerEntry(id: string) {
  await latency()
  const e = find(db.partner_entries, id)
  db.partner_entries = db.partner_entries.filter((x) => x !== e)
  audit('partner_entries', 'DELETE', e, null)
  commit('partner_entries', 'partners')
}

export async function listPartnerExpenses(partnerId: string): Promise<(Expense & { game_name: string; game_date: string })[]> {
  await latency()
  return copy(
    db.expenses
      .filter((e) => e.partner_id === partnerId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((e) => {
        const g = db.games.find((x) => x.id === e.game_id)
        return { ...e, game_name: g?.name ?? '', game_date: g?.game_date ?? '' }
      }),
  )
}

export async function listPartnerShares(partnerId: string): Promise<PartnerShareWithGame[]> {
  await latency()
  return copy(
    db.partner_shares
      .filter((s) => s.partner_id === partnerId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((s) => {
        const g = db.games.find((x) => x.id === s.game_id)
        return { ...s, game_name: g?.name ?? '', game_date: g?.game_date ?? '' }
      }),
  )
}

// ---------------------------------------------------------------- player accounts

export async function getPlayerLedger(playerId: string): Promise<{ txs: AccountTx[]; payments: PlayerPayment[] }> {
  await latency()
  const txs = db.transactions
    .filter((t) => t.player_id === playerId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((t) => {
      const g = db.games.find((x) => x.id === t.game_id)
      return { ...t, game_name: g?.name ?? '', game_date: g?.game_date ?? '' }
    })
  const payments = db.player_payments
    .filter((p) => p.player_id === playerId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
  return copy({ txs, payments })
}

export async function addPlayerPayment(p: PaymentInput) {
  await latency()
  find(db.players, p.player_id)
  validAmount(p.amount, false)
  const row: PlayerPayment = { ...p, id: sampleId(), created_at: now(), updated_at: null }
  db.player_payments.push(row)
  audit('player_payments', 'INSERT', null, row)
  commit('player_payments', 'players')
}

export async function deletePlayerPayment(id: string) {
  await latency()
  const p = find(db.player_payments, id)
  db.player_payments = db.player_payments.filter((x) => x !== p)
  audit('player_payments', 'DELETE', p, null)
  commit('player_payments', 'players')
}

// ---------------------------------------------------------------- audit log

export async function listAudit(f: AuditFilter = {}): Promise<AuditEntry[]> {
  await latency()
  return copy(
    db.audit
      .filter(
        (e) =>
          (!f.gameId || e.game_id === f.gameId) &&
          (!f.playerId || e.player_id === f.playerId) &&
          (!f.partnerId || e.partner_id === f.partnerId) &&
          (!f.actorEmail || e.actor_email === f.actorEmail) &&
          (!f.table || e.table_name === f.table) &&
          (!f.beforeId || e.id < f.beforeId),
      )
      .sort((a, b) => b.id - a.id)
      .slice(0, f.limit ?? 100),
  )
}
