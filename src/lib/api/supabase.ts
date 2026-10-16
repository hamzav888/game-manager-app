// Data layer backed by Supabase (PostgREST). Row Level Security does the protecting.
import type { PostgrestError } from '@supabase/supabase-js'
import { orgId } from '../org'
import { supabase } from '../supabase'
import type {
  AccountTx,
  Dealer,
  DealerAccount,
  DealerPayment,
  DealerRound,
  AuditEntry,
  AuditFilter,
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

const PAGE = 1000

function friendly(error: PostgrestError): Error {
  if (error.code === '23505') return new Error('That already exists — names must be unique.')
  if (error.code === '23503') return new Error('This is still in use (it has buy-ins or cash-outs), so it cannot be deleted.')
  if (error.code === '42501') return new Error('Not allowed. You may not have permission, or the game has ended.')
  if (error.code === 'PGRST301' || error.message?.includes('JWT')) return new Error('Your session expired. Sign in again.')
  if (error.code === '23514') return new Error('Invalid value — check the amount and fields.')
  if (error.code === 'P0001') return new Error(error.message)
  return new Error(error.message || 'Something went wrong')
}

async function run<T>(q: PromiseLike<{ data: T | null; error: PostgrestError | null }>): Promise<T> {
  const { data, error } = await q
  if (error) throw friendly(error)
  return data as T
}

/** For update/delete: RLS silently filters rows, so make sure something changed. */
async function runChanged(q: PromiseLike<{ data: unknown[] | null; error: PostgrestError | null }>): Promise<void> {
  const rows = await run(q)
  if (!rows || rows.length === 0) {
    throw new Error('Change not saved — you may not have permission, or the game has ended.')
  }
}

/** Page through results past PostgREST's row cap. */
async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const rows = await run(page(from, from + PAGE - 1))
    out.push(...(rows ?? []))
    if (!rows || rows.length < PAGE) return out
  }
}

const num = <T extends object>(row: T, keys: (keyof T)[]): T => {
  const r = { ...row }
  for (const k of keys) (r as Record<keyof T, unknown>)[k] = Number(r[k] ?? 0)
  return r
}

/** null stays null (e.g. "use the game's rate"). */
const pctOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
const toPlayer = <T extends Player>(p: T): T => ({ ...p, loss_discount_pct: pctOrNull(p.loss_discount_pct) })

// ---------------------------------------------------------------- organizations & members

export interface WhoAmI {
  is_owner: boolean
  approved: boolean
  username: string | null
}

export async function whoAmI(): Promise<WhoAmI> {
  const rows = (await run(supabase.rpc('whoami'))) as WhoAmI[]
  return rows?.[0] ?? { is_owner: false, approved: false, username: null }
}

export const listMyOrganizations = async (): Promise<MyOrg[]> =>
  ((await run(supabase.rpc('my_organizations'))) as MyOrg[]).map((o) => num(o, ['tip_tax_pct', 'loss_discount_pct']))

/** Owner only. The first admin defaults to the owner. */
export const createOrganization = async (name: string, adminUserId?: string | null): Promise<string> =>
  (await run(supabase.rpc('create_organization', { p_name: name.trim(), p_admin: adminUserId ?? null }))) as string

export const updateOrganization = (patch: { name?: string; tip_tax_pct?: number; loss_discount_pct?: number }) =>
  runChanged(supabase.from('organizations').update(patch).eq('id', orgId()).select('id'))

type MemberRow = Omit<Member, 'email' | 'display_name' | 'username'> & {
  profiles: { email: string | null; display_name: string | null; username: string | null } | null
}

const toMember = ({ profiles, ...m }: MemberRow): Member => ({
  ...m,
  username: profiles?.username ?? null,
  email: profiles?.email ?? null,
  display_name: profiles?.display_name ?? null,
})

const membersOf = async (org: string): Promise<Member[]> =>
  (
    await run(
      supabase
        .from('memberships')
        .select('user_id, role, active, created_at, profiles(email, display_name, username)')
        .eq('org_id', org)
        .order('created_at')
        .returns<MemberRow[]>(),
    )
  ).map(toMember)

export const listMembers = (): Promise<Member[]> => membersOf(orgId())

/** Add an existing, owner-approved account to the current organization by username. */
export const addMember = async (username: string, role: Role) => {
  await run(supabase.rpc('add_member', { p_org: orgId(), p_login: username.trim(), p_role: role }))
}

export const updateMember = (userId: string, patch: { role?: Role; active?: boolean }) =>
  runChanged(supabase.from('memberships').update(patch).eq('org_id', orgId()).eq('user_id', userId).select('user_id'))

/** Remove someone from the current organization (or yourself: leave). */
export const removeMember = (userId: string) =>
  runChanged(supabase.from('memberships').delete().eq('org_id', orgId()).eq('user_id', userId).select('user_id'))

export const updateMyProfile = (userId: string, patch: { display_name: string | null }) =>
  runChanged(supabase.from('profiles').update(patch).eq('id', userId).select('id'))

/** Change your own password (any length); needs the current one. */
export const changeMyPassword = async (current: string, next: string) => {
  await run(supabase.rpc('change_my_password', { p_current: current, p_new: next }))
}

// ---------------------------------------------------------------- owner (app admin)

export const adminListAccounts = async (): Promise<AdminAccount[]> => (await run(supabase.rpc('admin_accounts'))) as AdminAccount[]

export const adminListOrganizations = async (): Promise<AdminOrg[]> =>
  ((await run(supabase.rpc('admin_organizations'))) as AdminOrg[]).map((o) => num(o, ['members']))

/** Owner only: create a login (username + password). Done inside the database. */
export const adminCreateAccount = async (a: { username: string; password: string; name: string }): Promise<string> =>
  (await run(
    supabase.rpc('admin_create_account', { p_username: a.username.trim(), p_password: a.password, p_name: a.name.trim() || null }),
  )) as string

/** Owner only: names behind the ids in the history, across every organization. */
export async function adminNames(): Promise<NameBook> {
  const rows = (await run(supabase.rpc('admin_names'))) as { kind: keyof NameBook; id: string; name: string }[]
  const book: NameBook = { org: new Map(), player: new Map(), game: new Map(), partner: new Map(), dealer: new Map(), account: new Map() }
  for (const r of rows) book[r.kind]?.set(r.id, r.name)
  return book
}

/** Owner only: change someone's username (their login changes with it). */
export const adminSetUsername = async (userId: string, username: string) => {
  await run(supabase.rpc('admin_set_username', { p_user: userId, p_username: username.trim() }))
}

export const adminSetApproved = async (userId: string, approved: boolean) => {
  await run(supabase.rpc('admin_set_approved', { p_user: userId, p_approved: approved }))
}

export const adminSetPassword = async (userId: string, password: string) => {
  await run(supabase.rpc('admin_set_password', { p_user: userId, p_password: password }))
}

export const adminOrgMembers = (org: string): Promise<Member[]> => membersOf(org)

export const adminAddMember = async (org: string, username: string, role: Role) => {
  await run(supabase.rpc('add_member', { p_org: org, p_login: username.trim(), p_role: role }))
}

export const adminUpdateMember = (org: string, userId: string, patch: { role?: Role; active?: boolean }) =>
  runChanged(supabase.from('memberships').update(patch).eq('org_id', org).eq('user_id', userId).select('user_id'))

export const adminRemoveMember = (org: string, userId: string) =>
  runChanged(supabase.from('memberships').delete().eq('org_id', org).eq('user_id', userId).select('user_id'))

export const adminRenameOrganization = (org: string, name: string) =>
  runChanged(supabase.from('organizations').update({ name: name.trim() }).eq('id', org).select('id'))

// ---------------------------------------------------------------- players

export const listPlayers = async () =>
  (await fetchAll<Player>((a, b) => supabase.from('players').select('*').eq('org_id', orgId()).order('name').range(a, b))).map(toPlayer)

export const createPlayer = async (name: string) =>
  toPlayer(await run(supabase.from('players').insert({ org_id: orgId(), name: name.trim() }).select('*').single<Player>()))

export const updatePlayer = (id: string, patch: Partial<Pick<Player, 'name' | 'phone' | 'notes' | 'loss_discount_pct'>>) =>
  runChanged(supabase.from('players').update(patch).eq('id', id).select('id'))

export const deletePlayer = (id: string) =>
  runChanged(supabase.from('players').delete().eq('id', id).select('id'))

const PLAYER_TOTAL_NUMS: (keyof PlayerTotals)[] = ['games_played', 'total_buy_ins', 'total_cash_outs', 'total_discounts', 'net', 'balance']

export const listPlayerTotals = async () =>
  (await fetchAll<PlayerTotals>((a, b) => supabase.from('player_totals').select('*').eq('org_id', orgId()).order('name').range(a, b))).map((r) =>
    toPlayer(num(r, PLAYER_TOTAL_NUMS)),
  )

export const getPlayerTotals = async (id: string): Promise<PlayerTotals | null> => {
  const r: PlayerTotals | null = await run(supabase.from('player_totals').select('*').eq('id', id).maybeSingle<PlayerTotals>())
  return r && toPlayer(num(r, PLAYER_TOTAL_NUMS))
}

export const getPlayerResults = async (playerId: string) =>
  (
    await fetchAll<PlayerGameResult>((a, b) =>
      supabase
        .from('player_game_results')
        .select('*')
        .eq('player_id', playerId)
        .order('game_date', { ascending: false })
        .range(a, b),
    )
  ).map((r) => num(r, ['buy_ins', 'cash_outs', 'discounts', 'buy_in_count', 'net']))

// ---------------------------------------------------------------- games

export const listGameTotals = async () =>
  (
    await fetchAll<GameTotals>((a, b) =>
      supabase
        .from('game_totals')
        .select('*')
        .eq('org_id', orgId())
        .order('game_date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(a, b),
    )
  ).map((r) =>
    num(r, [
      'tip_tax_pct',
      'loss_discount_pct',
      'total_buy_ins',
      'total_cash_outs',
      'total_discounts',
      'player_count',
      'total_tips',
      'tip_tax',
      'total_expenses',
      'house_take',
      'net_profit',
      'total_rake',
      'over_short',
      'seated_count',
    ]),
  )

export const createGame = async (g: { name: string; game_date: string }): Promise<Game> =>
  num(await run(supabase.from('games').insert({ ...g, org_id: orgId() }).select('*').single<Game>()), ['tip_tax_pct', 'loss_discount_pct'])

export const updateGame = (
  id: string,
  patch: Partial<Pick<Game, 'name' | 'game_date' | 'notes' | 'status' | 'tip_tax_pct' | 'loss_discount_pct'>>,
) =>
  runChanged(supabase.from('games').update(patch).eq('id', id).select('id'))

export const deleteGame = (id: string) => runChanged(supabase.from('games').delete().eq('id', id).select('id'))

export async function getGameData(gameId: string): Promise<GameData> {
  const [game, txs, tips, expenses] = await Promise.all([
    run(supabase.from('games').select('*').eq('id', gameId).maybeSingle<Game>()),
    fetchAll<Transaction>((a, b) =>
      supabase.from('transactions').select('*').eq('game_id', gameId).order('created_at').range(a, b),
    ),
    fetchAll<DealerTip>((a, b) =>
      supabase.from('dealer_tips').select('*').eq('game_id', gameId).order('created_at').range(a, b),
    ),
    fetchAll<Expense>((a, b) => supabase.from('expenses').select('*').eq('game_id', gameId).order('created_at').range(a, b)),
  ])
  return {
    game: game && num(game, ['tip_tax_pct', 'loss_discount_pct']),
    txs: txs.map((t) => num(t, ['amount'])),
    tips: tips.map((t) => num(t, ['amount', 'rake'])),
    expenses: expenses.map((e) => num(e, ['amount'])),
  }
}

// ---------------------------------------------------------------- money rows

export type TxInput = Pick<Transaction, 'game_id' | 'player_id' | 'kind' | 'amount' | 'method' | 'note'>
export const addTx = async (t: TxInput) => {
  await run(supabase.from('transactions').insert(t))
}
export const updateTx = (id: string, patch: Partial<Pick<Transaction, 'amount' | 'method' | 'note'>>) =>
  runChanged(supabase.from('transactions').update(patch).eq('id', id).select('id'))
export const deleteTx = (id: string) => runChanged(supabase.from('transactions').delete().eq('id', id).select('id'))

/** One dealer round: tips and rake (either can be 0, not both). A new dealer name opens a dealer account. */
export type TipInput = Pick<DealerTip, 'game_id' | 'dealer_name' | 'amount' | 'rake' | 'method' | 'note'> & { dealer_id: string | null }
export const addTip = async (t: TipInput) => {
  await run(supabase.from('dealer_tips').insert(t))
}
export const updateTip = (id: string, patch: Partial<Omit<TipInput, 'game_id'>>) =>
  runChanged(supabase.from('dealer_tips').update(patch).eq('id', id).select('id'))
export const deleteTip = (id: string) => runChanged(supabase.from('dealer_tips').delete().eq('id', id).select('id'))

export type ExpenseInput = Pick<Expense, 'game_id' | 'category' | 'description' | 'amount' | 'partner_id'> & { dealer_id: string | null }
export const addExpense = async (e: ExpenseInput) => {
  await run(supabase.from('expenses').insert(e))
}
export const updateExpense = (id: string, patch: Partial<Omit<ExpenseInput, 'game_id'>>) =>
  runChanged(supabase.from('expenses').update(patch).eq('id', id).select('id'))
export const deleteExpense = (id: string) => runChanged(supabase.from('expenses').delete().eq('id', id).select('id'))

// ---------------------------------------------------------------- dealers

const DEALER_NUMS: (keyof DealerAccount)[] = ['rounds', 'games', 'total_rake', 'total_tips', 'tip_tax', 'net_tips', 'dealer_pay', 'balance']

export const listDealerAccounts = async () =>
  (await fetchAll<DealerAccount>((a, b) => supabase.from('dealer_accounts').select('*').eq('org_id', orgId()).order('name').range(a, b))).map((r) =>
    num(r, DEALER_NUMS),
  )

export const getDealerAccount = async (id: string): Promise<DealerAccount | null> => {
  const r = await run(supabase.from('dealer_accounts').select('*').eq('id', id).maybeSingle<DealerAccount>())
  return r && num(r, DEALER_NUMS)
}

export const createDealer = (name: string) =>
  run(supabase.from('dealers').insert({ org_id: orgId(), name: name.trim() }).select('*').single<Dealer>())

export const updateDealer = (id: string, patch: Partial<Pick<Dealer, 'name' | 'phone' | 'notes' | 'active'>>) =>
  runChanged(supabase.from('dealers').update(patch).eq('id', id).select('id'))

export const deleteDealer = (id: string) => runChanged(supabase.from('dealers').delete().eq('id', id).select('id'))

/** Every round a dealer reported, the dealer pay that went to them, and payments either way. */
export async function getDealerLedger(dealerId: string): Promise<{
  rounds: DealerRound[]
  pay: (Expense & { game_name: string; game_date: string })[]
  payments: DealerPayment[]
}> {
  const [rounds, pay, payments] = await Promise.all([
    fetchAll<DealerTip & { games: { name: string; game_date: string; tip_tax_pct: number } | null }>((a, b) =>
      supabase
        .from('dealer_tips')
        .select('*, games(name, game_date, tip_tax_pct)')
        .eq('dealer_id', dealerId)
        .order('created_at', { ascending: false })
        .range(a, b),
    ),
    fetchAll<WithGame<Expense>>((a, b) =>
      supabase.from('expenses').select('*, games(name, game_date)').eq('dealer_id', dealerId).order('created_at', { ascending: false }).range(a, b),
    ),
    fetchAll<DealerPayment>((a, b) =>
      supabase.from('dealer_payments').select('*').eq('dealer_id', dealerId).order('created_at', { ascending: false }).range(a, b),
    ),
  ])
  return {
    rounds: rounds.map(({ games, ...r }) => ({
      ...num(r as DealerTip, ['amount', 'rake']),
      game_name: games?.name ?? '',
      game_date: games?.game_date ?? '',
      tip_tax_pct: Number(games?.tip_tax_pct ?? 0),
    })),
    pay: pay.map(flattenGame),
    payments: payments.map((p) => num(p, ['amount'])),
  }
}

export type DealerPaymentInput = Pick<DealerPayment, 'dealer_id' | 'direction' | 'amount' | 'method' | 'note'>
export const addDealerPayment = async (p: DealerPaymentInput) => {
  await run(supabase.from('dealer_payments').insert(p))
}
export const deleteDealerPayment = (id: string) =>
  runChanged(supabase.from('dealer_payments').delete().eq('id', id).select('id'))

// ---------------------------------------------------------------- house rules (on the organization)

export async function getSettings(): Promise<Settings> {
  const r = await run(
    supabase.from('organizations').select('tip_tax_pct, loss_discount_pct').eq('id', orgId()).maybeSingle<Settings>(),
  )
  return { tip_tax_pct: Number(r?.tip_tax_pct ?? 0), loss_discount_pct: Number(r?.loss_discount_pct ?? 0) }
}

export const updateSettings = (patch: Partial<Settings>) => updateOrganization(patch)

// ---------------------------------------------------------------- partners

export const listPartnerAccounts = async () =>
  (await fetchAll<PartnerAccount>((a, b) => supabase.from('partner_accounts').select('*').eq('org_id', orgId()).order('name').range(a, b))).map((r) =>
    num(r, ['share_pct', 'expenses_paid', 'profit_share', 'contributions', 'payouts', 'balance']),
  )

export type PartnerInput = Pick<Partner, 'name' | 'email' | 'share_pct' | 'notes'>
export const createPartner = (p: PartnerInput) =>
  run(supabase.from('partners').insert({ ...p, org_id: orgId(), name: p.name.trim() }).select('*').single<Partner>())
export const updatePartner = (id: string, patch: Partial<PartnerInput & { active: boolean }>) =>
  runChanged(supabase.from('partners').update(patch).eq('id', id).select('id'))
export const deletePartner = (id: string) => runChanged(supabase.from('partners').delete().eq('id', id).select('id'))

export const listPartnerEntries = async (partnerId: string) =>
  (
    await fetchAll<PartnerEntry>((a, b) =>
      supabase.from('partner_entries').select('*').eq('partner_id', partnerId).order('created_at', { ascending: false }).range(a, b),
    )
  ).map((e) => num(e, ['amount']))

export type PartnerEntryInput = Pick<PartnerEntry, 'partner_id' | 'kind' | 'amount' | 'method' | 'note'>
export const addPartnerEntry = async (e: PartnerEntryInput) => {
  await run(supabase.from('partner_entries').insert(e))
}
export const deletePartnerEntry = (id: string) =>
  runChanged(supabase.from('partner_entries').delete().eq('id', id).select('id'))

type WithGame<T> = T & { games: { name: string; game_date: string } | null }
const flattenGame = <T extends { amount: number }>(r: WithGame<T>) => {
  const { games, ...rest } = r
  return { ...num(rest as unknown as T, ['amount'] as (keyof T)[]), game_name: games?.name ?? '', game_date: games?.game_date ?? '' }
}

export const listPartnerExpenses = async (partnerId: string) =>
  (
    await fetchAll<WithGame<Expense>>((a, b) =>
      supabase.from('expenses').select('*, games(name, game_date)').eq('partner_id', partnerId).order('created_at', { ascending: false }).range(a, b),
    )
  ).map(flattenGame)

export const listPartnerShares = async (partnerId: string): Promise<PartnerShareWithGame[]> =>
  (
    await fetchAll<PartnerShareWithGame & { games: { name: string; game_date: string } | null }>((a, b) =>
      supabase
        .from('partner_shares')
        .select('*, games(name, game_date)')
        .eq('partner_id', partnerId)
        .order('created_at', { ascending: false })
        .range(a, b),
    )
  ).map(({ games, ...r }) => ({
    ...num(r, ['share_pct', 'game_profit', 'amount']),
    game_name: games?.name ?? '',
    game_date: games?.game_date ?? '',
  }))

// ---------------------------------------------------------------- player accounts

/** Everything money-related with this player: every buy-in, cash-out and discount (any method) plus payments. */
export async function getPlayerLedger(playerId: string): Promise<{ txs: AccountTx[]; payments: PlayerPayment[] }> {
  const [txs, payments] = await Promise.all([
    fetchAll<WithGame<Transaction>>((a, b) =>
      supabase
        .from('transactions')
        .select('*, games(name, game_date)')
        .eq('player_id', playerId)
        .order('created_at', { ascending: false })
        .range(a, b),
    ),
    fetchAll<PlayerPayment>((a, b) =>
      supabase.from('player_payments').select('*').eq('player_id', playerId).order('created_at', { ascending: false }).range(a, b),
    ),
  ])
  return { txs: txs.map(flattenGame), payments: payments.map((p) => num(p, ['amount'])) }
}

export type PaymentInput = Pick<PlayerPayment, 'player_id' | 'direction' | 'amount' | 'method' | 'note'>
export const addPlayerPayment = async (p: PaymentInput) => {
  await run(supabase.from('player_payments').insert(p))
}
export const deletePlayerPayment = (id: string) =>
  runChanged(supabase.from('player_payments').delete().eq('id', id).select('id'))

// ---------------------------------------------------------------- audit log

/** The history. Only the app owner can read it (enforced by the database). */
export async function listAudit(f: AuditFilter = {}): Promise<AuditEntry[]> {
  let q = supabase.from('audit_log').select('*')
  if (f.accountsOnly) q = q.is('org_id', null)
  else if (f.inOrg) q = q.eq('org_id', f.inOrg)
  else if (!f.everywhere) q = q.eq('org_id', orgId())
  if (f.gameId) q = q.eq('game_id', f.gameId)
  if (f.playerId) q = q.eq('player_id', f.playerId)
  if (f.partnerId) q = q.eq('partner_id', f.partnerId)
  if (f.dealerId) q = q.eq('dealer_id', f.dealerId)
  if (f.actorId) q = q.eq('actor_id', f.actorId)
  if (f.table) q = q.eq('table_name', f.table)
  if (f.beforeId) q = q.lt('id', f.beforeId)
  return run(q.order('id', { ascending: false }).limit(f.limit ?? 100).returns<AuditEntry[]>())
}
