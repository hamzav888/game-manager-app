// In-browser data layer for the /sample demo. Same functions and rules as the
// Supabase version (closed games lock, unique names, audit log, last admin…),
// but everything lives in this tab's sessionStorage. Nothing leaves the browser.
import type {
  AccountTx,
  Dealer,
  DealerAccount,
  DealerPayment,
  DealerRound,
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
  NameBook,
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
import { SAMPLE_EMAIL, SAMPLE_USER_ID, SAMPLE_VERSION, loginEmail, postShares, sampleId, seedSample } from './sampleSeed'
import type { SampleDb } from './sampleSeed'
import type {
  DealerPaymentInput,
  ExpenseInput,
  PartnerEntryInput,
  PartnerInput,
  PaymentInput,
  TipInput,
  TxInput,
  WhoAmI,
} from './supabase'

const KEY = 'poker-ledger:sample'
const TABLES = [
  'organizations', 'memberships', 'players', 'games', 'transactions', 'dealer_tips', 'expenses',
  'partners', 'partner_entries', 'partner_shares', 'player_payments', 'dealers', 'dealer_payments', 'audit_log',
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
// Save the freshly seeded data too, so a reload keeps the same ids (and links).
persist()

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

const ACCOUNT_TABLES: AuditTable[] = ['profiles', 'passwords', 'sign_ins', 'app_admins']

function audit(table: AuditTable, action: AuditEntry['action'], oldRow: object | null, newRow: object | null) {
  const row = (newRow ?? oldRow) as Record<string, unknown>
  db.audit.push({
    id: db.nextAuditId++,
    org_id: ACCOUNT_TABLES.includes(table) ? null : ((row.org_id as string) ?? db.org.id),
    occurred_at: now(),
    actor_id: SAMPLE_USER_ID,
    actor_email: SAMPLE_EMAIL,
    table_name: table,
    action,
    record_id: String(row.id ?? row.user_id),
    game_id: table === 'games' ? String(row.id) : ((row.game_id as string) ?? null),
    player_id: table === 'players' ? String(row.id) : ((row.player_id as string) ?? null),
    partner_id: table === 'partners' ? String(row.id) : ((row.partner_id as string) ?? null),
    dealer_id: table === 'dealers' ? String(row.id) : ((row.dealer_id as string) ?? null),
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
    fail('Not allowed. You may not have permission, or the game has ended.')
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

export async function whoAmI(): Promise<WhoAmI> {
  await latency()
  return { is_owner: true, approved: true, username: db.accounts.find((a) => a.id === SAMPLE_USER_ID)?.username ?? 'sam' }
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

function addTo(orgId: string, login: string, role: Role) {
  const key = login.trim().toLowerCase().replace(/^@/, '')
  const acct = db.accounts.find((a) => (a.username === key || a.email === key) && a.approved)
  if (!acct) fail(`No account is called ${key}. Ask the app owner to create it first.`)
  const entry = orgEntry(orgId)
  const existing = entry.members.find((m) => m.user_id === acct.id)
  if (existing) {
    const before = memberRow(orgId, existing)
    Object.assign(existing, { role, active: true })
    if (orgId === db.org.id) audit('memberships', 'UPDATE', before, memberRow(orgId, existing))
  } else {
    const m: Member = { user_id: acct.id, username: acct.username, email: acct.email, display_name: acct.display_name, role, active: true, created_at: now() }
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

export async function addMember(username: string, role: Role) {
  await latency()
  addTo(db.org.id, username, role)
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
  if (a) {
    audit('profiles', 'UPDATE', { id: a.id, username: a.username, display_name: a.display_name }, { id: a.id, username: a.username, display_name: patch.display_name })
    a.display_name = patch.display_name
  }
  commit('memberships')
}

export async function changeMyPassword(current: string, next: string) {
  await latency()
  if (!current) fail('Your current password isn’t right.')
  if (!next) fail('Enter a new password.')
  audit('passwords', 'INSERT', null, { id: SAMPLE_USER_ID, username: 'sam', by: 'self' })
  commit()
}

// ---------------------------------------------------------------- owner (app admin)

export async function createOrganization(name: string, adminUserId?: string | null): Promise<string> {
  await latency()
  if (!name.trim()) fail('Give the organization a name.')
  const admin = db.accounts.find((a) => a.id === (adminUserId ?? SAMPLE_USER_ID) && a.approved) ?? fail('That account isn’t approved yet.')
  const org = { id: sampleId(), name: name.trim(), tip_tax_pct: 0, loss_discount_pct: 0, created_at: now() }
  db.extraOrgs.unshift({
    org,
    members: [{ user_id: admin.id, username: admin.username, email: admin.email, display_name: admin.display_name, role: 'admin', active: true, created_at: now() }],
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

const USERNAME = /^[a-z0-9][a-z0-9._-]{0,31}$/
const USERNAME_RULE = 'Usernames are up to 32 letters, numbers, dots, dashes or underscores, starting with a letter or number.'

export async function adminCreateAccount(a: { username: string; password: string; name: string }): Promise<string> {
  await latency()
  const username = a.username.trim().toLowerCase()
  if (!USERNAME.test(username)) fail(USERNAME_RULE)
  if (db.accounts.some((x) => x.username === username)) fail(`The username ${username} is already taken.`)
  if (!a.password) fail('Enter a password.')
  const id = sampleId()
  const acct = {
    id, username, email: loginEmail(username), display_name: a.name.trim() || username, approved: true, is_owner: false,
    created_at: now(), last_sign_in_at: null, organizations: null,
  }
  db.accounts.unshift(acct)
  audit('profiles', 'INSERT', null, { id, username, display_name: acct.display_name, approved: true })
  commit('memberships')
  return id
}

export async function adminNames(): Promise<NameBook> {
  await latency()
  const label = (g: Game) => `${g.name} · ${new Date(`${g.game_date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
  return {
    org: new Map(allOrgs().map((o) => [o.org.id, o.org.name])),
    player: new Map(db.players.map((p) => [p.id, p.name])),
    game: new Map(db.games.map((g) => [g.id, label(g)])),
    partner: new Map(db.partners.map((p) => [p.id, p.name])),
    dealer: new Map(db.dealers.map((d) => [d.id, d.name])),
    account: new Map(db.accounts.map((a) => [a.id, a.display_name || a.username || a.email || ''])),
  }
}

export async function adminSetUsername(userId: string, username: string) {
  await latency()
  const u = username.trim().toLowerCase()
  if (!USERNAME.test(u)) fail(USERNAME_RULE)
  if (db.accounts.some((x) => x.username === u && x.id !== userId)) fail(`The username ${u} is already taken.`)
  const a = db.accounts.find((x) => x.id === userId) ?? fail('Account not found.')
  audit('profiles', 'UPDATE', { id: a.id, username: a.username }, { id: a.id, username: u })
  a.username = u
  a.email = loginEmail(u)
  for (const o of allOrgs()) for (const m of o.members) if (m.user_id === userId) Object.assign(m, { username: u, email: a.email })
  commit('memberships')
}

export async function adminSetApproved(userId: string, approved: boolean) {
  await latency()
  const a = db.accounts.find((x) => x.id === userId) ?? fail('Account not found.')
  if (!approved && a.is_owner) fail('The owner account is always approved.')
  audit('profiles', 'UPDATE', { id: a.id, username: a.username, approved: a.approved }, { id: a.id, username: a.username, approved })
  a.approved = approved
  if (!approved) for (const o of allOrgs()) for (const m of o.members) if (m.user_id === userId) m.active = false
  commit('memberships')
}

export async function adminSetPassword(userId: string, password: string) {
  await latency()
  if (!password) fail('Enter a password.')
  const a = db.accounts.find((x) => x.id === userId) ?? fail('Account not found.')
  audit('passwords', 'INSERT', null, { id: a.id, username: a.username, by: 'owner' })
  commit()
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
  const p: Player = { id: sampleId(), name: name.trim(), phone: null, notes: null, loss_discount_pct: null, created_at: now() }
  db.players.push(p)
  audit('players', 'INSERT', null, p)
  commit('players')
  return copy(p)
}

export async function updatePlayer(id: string, patch: Partial<Pick<Player, 'name' | 'phone' | 'notes' | 'loss_discount_pct'>>) {
  await latency()
  const p = find(db.players, id)
  if (patch.name !== undefined) assertUniqueName(db.players, patch.name, id)
  validPct(patch.loss_discount_pct ?? undefined)
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
  const rounds = db.dealer_tips.filter((t) => t.game_id === g.id)
  const tips = sum(rounds.map((t) => t.amount))
  const rake = sum(rounds.map((t) => t.rake))
  const tipTax = Math.round((cents(tips) * g.tip_tax_pct) / 100) / 100
  const expenses = sum(db.expenses.filter((e) => e.game_id === g.id).map((e) => e.amount))
  // Same as the game_totals view: house take is before loss discounts (they're an expense).
  const house = (cents(buyIns) - cents(cashOuts) - cents(tips) + cents(tipTax)) / 100
  const lastIn = new Map<string, string>()
  const lastOut = new Map<string, string>()
  for (const t of txs) {
    const m = t.kind === 'buy_in' ? lastIn : t.kind === 'cash_out' ? lastOut : null
    if (m && (m.get(t.player_id) ?? '') < t.created_at) m.set(t.player_id, t.created_at)
  }
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
    net_profit: (cents(house) - cents(discounts) - cents(expenses)) / 100,
    total_rake: rake,
    over_short: (cents(buyIns) - cents(cashOuts) - cents(tips) - cents(rake)) / 100,
    seated_count: [...lastIn.entries()].filter(([pid, at]) => (lastOut.get(pid) ?? '') < at).length,
    last_round_at: rounds.reduce<string | null>((m, t) => (!m || t.created_at > m ? t.created_at : m), null),
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

/** A dealer round needs tips or rake (or both), never negative. */
function validRound(amount: number, rake: number) {
  validAmount(amount, true)
  validAmount(rake, true)
  if (!(amount + rake > 0)) fail('Enter the rake or the tips for this round.')
}

/** Mirror of the round_dealer trigger: find the dealer by id or name, opening an account for a new name. */
function dealerFor(dealerId: string | null, name: string): Dealer {
  if (dealerId) return find(db.dealers, dealerId)
  const key = name.trim().toLowerCase()
  if (!key) fail('Choose the dealer for this round.')
  const existing = db.dealers.find((d) => d.name.trim().toLowerCase() === key)
  if (existing) return existing
  const d: Dealer = { id: sampleId(), name: name.trim(), phone: null, notes: null, active: true, created_at: now() }
  db.dealers.push(d)
  audit('dealers', 'INSERT', null, d)
  return d
}

export async function addTip(t: TipInput) {
  await latency()
  assertOpen(t.game_id)
  validRound(t.amount, t.rake)
  const dealer = dealerFor(t.dealer_id, t.dealer_name)
  const row: DealerTip = { ...t, dealer_id: dealer.id, dealer_name: dealer.name, id: sampleId(), created_at: now(), updated_at: null }
  db.dealer_tips.push(row)
  audit('dealer_tips', 'INSERT', null, row)
  commit('dealer_tips', 'dealers')
}

export async function updateTip(id: string, patch: Partial<Omit<TipInput, 'game_id'>>) {
  await latency()
  const t = find(db.dealer_tips, id)
  assertOpen(t.game_id)
  validRound(patch.amount ?? t.amount, patch.rake ?? t.rake)
  const before = { ...t }
  const dealer =
    patch.dealer_id !== undefined || patch.dealer_name !== undefined
      ? dealerFor(patch.dealer_id ?? null, patch.dealer_name ?? t.dealer_name)
      : find(db.dealers, t.dealer_id)
  Object.assign(t, patch, { dealer_id: dealer.id, dealer_name: dealer.name, updated_at: now() })
  audit('dealer_tips', 'UPDATE', before, t)
  commit('dealer_tips', 'dealers')
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
  if (e.dealer_id) find(db.dealers, e.dealer_id)
  const row: Expense = { ...e, paid_by: paidByLabel(e.partner_id), id: sampleId(), created_at: now(), updated_at: null }
  db.expenses.push(row)
  audit('expenses', 'INSERT', null, row)
  commit('expenses', 'partners', 'dealers')
}

export async function updateExpense(id: string, patch: Partial<Omit<ExpenseInput, 'game_id'>>) {
  await latency()
  const e = find(db.expenses, id)
  assertOpen(e.game_id)
  if (patch.amount !== undefined) validAmount(patch.amount, false)
  if (patch.dealer_id) find(db.dealers, patch.dealer_id)
  const before = { ...e }
  Object.assign(e, patch, { updated_at: now() })
  e.paid_by = paidByLabel(e.partner_id)
  audit('expenses', 'UPDATE', before, e)
  commit('expenses', 'partners', 'dealers')
}

export async function deleteExpense(id: string) {
  await latency()
  const e = find(db.expenses, id)
  assertOpen(e.game_id)
  db.expenses = db.expenses.filter((x) => x !== e)
  audit('expenses', 'DELETE', e, null)
  commit('expenses', 'partners', 'dealers')
}

// ---------------------------------------------------------------- dealers

function dealerAccount(d: Dealer): DealerAccount {
  const games = new Map(db.games.map((g) => [g.id, g]))
  const rounds = db.dealer_tips.filter((t) => t.dealer_id === d.id)
  let taxC = 0
  let owedC = 0
  for (const t of rounds) {
    const tax = Math.round((cents(t.amount) * (games.get(t.game_id)?.tip_tax_pct ?? 0)) / 100)
    taxC += tax
    if (t.method === 'account') owedC += cents(t.amount) - tax
  }
  const settled = db.dealer_payments
    .filter((p) => p.dealer_id === d.id)
    .reduce((s, p) => s + (p.direction === 'from_dealer' ? cents(p.amount) : -cents(p.amount)), 0)
  const tipsC = rounds.reduce((s, t) => s + cents(t.amount), 0)
  return {
    ...d,
    rounds: rounds.length,
    games: new Set(rounds.map((t) => t.game_id)).size,
    total_rake: sum(rounds.map((t) => t.rake)),
    total_tips: tipsC / 100,
    tip_tax: taxC / 100,
    net_tips: (tipsC - taxC) / 100,
    dealer_pay: sum(db.expenses.filter((e) => e.dealer_id === d.id).map((e) => e.amount)),
    last_dealt: rounds.map((t) => games.get(t.game_id)?.game_date ?? '').sort().at(-1) || null,
    balance: (owedC + settled) / 100,
  }
}

export async function listDealerAccounts(): Promise<DealerAccount[]> {
  await latency()
  return copy([...db.dealers].sort((a, b) => a.name.localeCompare(b.name)).map(dealerAccount))
}

export async function getDealerAccount(id: string): Promise<DealerAccount | null> {
  await latency()
  const d = db.dealers.find((x) => x.id === id)
  return d ? copy(dealerAccount(d)) : null
}

export async function createDealer(name: string): Promise<Dealer> {
  await latency()
  assertUniqueName(db.dealers, name)
  const d: Dealer = { id: sampleId(), name: name.trim(), phone: null, notes: null, active: true, created_at: now() }
  db.dealers.push(d)
  audit('dealers', 'INSERT', null, d)
  commit('dealers')
  return copy(d)
}

export async function updateDealer(id: string, patch: Partial<Pick<Dealer, 'name' | 'phone' | 'notes' | 'active'>>) {
  await latency()
  const d = find(db.dealers, id)
  if (patch.name !== undefined) assertUniqueName(db.dealers, patch.name, id)
  const before = { ...d }
  Object.assign(d, patch)
  for (const t of db.dealer_tips) if (t.dealer_id === id) t.dealer_name = d.name
  audit('dealers', 'UPDATE', before, d)
  commit('dealers', 'dealer_tips')
}

export async function deleteDealer(id: string) {
  await latency()
  const d = find(db.dealers, id)
  if (db.dealer_tips.some((t) => t.dealer_id === id) || db.dealer_payments.some((p) => p.dealer_id === id) || db.expenses.some((e) => e.dealer_id === id))
    fail('This is still in use (it has rounds or payments), so it cannot be deleted.')
  db.dealers = db.dealers.filter((x) => x !== d)
  audit('dealers', 'DELETE', d, null)
  commit('dealers')
}

export async function getDealerLedger(dealerId: string): Promise<{
  rounds: DealerRound[]
  pay: (Expense & { game_name: string; game_date: string })[]
  payments: DealerPayment[]
}> {
  await latency()
  const games = new Map(db.games.map((g) => [g.id, g]))
  const newest = <T extends { created_at: string }>(rows: T[]) => [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at))
  return copy({
    rounds: newest(db.dealer_tips.filter((t) => t.dealer_id === dealerId)).map((t) => ({
      ...t,
      game_name: games.get(t.game_id)?.name ?? '',
      game_date: games.get(t.game_id)?.game_date ?? '',
      tip_tax_pct: games.get(t.game_id)?.tip_tax_pct ?? 0,
    })),
    pay: newest(db.expenses.filter((e) => e.dealer_id === dealerId)).map((e) => ({
      ...e,
      game_name: games.get(e.game_id)?.name ?? '',
      game_date: games.get(e.game_id)?.game_date ?? '',
    })),
    payments: newest(db.dealer_payments.filter((p) => p.dealer_id === dealerId)),
  })
}

export async function addDealerPayment(p: DealerPaymentInput) {
  await latency()
  find(db.dealers, p.dealer_id)
  validAmount(p.amount, false)
  const row: DealerPayment = { ...p, id: sampleId(), created_at: now(), updated_at: null }
  db.dealer_payments.push(row)
  audit('dealer_payments', 'INSERT', null, row)
  commit('dealer_payments', 'dealers')
}

export async function deleteDealerPayment(id: string) {
  await latency()
  const p = find(db.dealer_payments, id)
  db.dealer_payments = db.dealer_payments.filter((x) => x !== p)
  audit('dealer_payments', 'DELETE', p, null)
  commit('dealer_payments', 'dealers')
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
          (f.accountsOnly ? !e.org_id : f.inOrg ? e.org_id === f.inOrg : f.everywhere || e.org_id === db.org.id) &&
          (!f.gameId || e.game_id === f.gameId) &&
          (!f.playerId || e.player_id === f.playerId) &&
          (!f.partnerId || e.partner_id === f.partnerId) &&
          (!f.dealerId || e.dealer_id === f.dealerId) &&
          (!f.actorId || e.actor_id === f.actorId) &&
          (!f.table || e.table_name === f.table) &&
          (!f.beforeId || e.id < f.beforeId),
      )
      .sort((a, b) => b.id - a.id)
      .slice(0, f.limit ?? 100),
  )
}
