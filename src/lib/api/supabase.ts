// Data layer backed by Supabase (PostgREST). Row Level Security does the protecting.
import type { PostgrestError } from '@supabase/supabase-js'
import { createClient } from '@supabase/supabase-js'
import { orgId } from '../org'
import { supabase, supabaseKey, supabaseUrl } from '../supabase'
import type {
  AccountTx,
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

export async function whoAmI(): Promise<{ is_owner: boolean; approved: boolean }> {
  const rows = (await run(supabase.rpc('whoami'))) as { is_owner: boolean; approved: boolean }[]
  return rows?.[0] ?? { is_owner: false, approved: false }
}

export const listMyOrganizations = async (): Promise<MyOrg[]> =>
  ((await run(supabase.rpc('my_organizations'))) as MyOrg[]).map((o) => num(o, ['tip_tax_pct', 'loss_discount_pct']))

/** Owner only. The first admin defaults to the owner. */
export const createOrganization = async (name: string, adminUserId?: string | null): Promise<string> =>
  (await run(supabase.rpc('create_organization', { p_name: name.trim(), p_admin: adminUserId ?? null }))) as string

export const updateOrganization = (patch: { name?: string; tip_tax_pct?: number; loss_discount_pct?: number }) =>
  runChanged(supabase.from('organizations').update(patch).eq('id', orgId()).select('id'))

type MemberRow = Omit<Member, 'email' | 'display_name'> & { profiles: { email: string | null; display_name: string | null } | null }

const toMember = ({ profiles, ...m }: MemberRow): Member => ({ ...m, email: profiles?.email ?? null, display_name: profiles?.display_name ?? null })

const membersOf = async (org: string): Promise<Member[]> =>
  (
    await run(
      supabase
        .from('memberships')
        .select('user_id, role, active, created_at, profiles(email, display_name)')
        .eq('org_id', org)
        .order('created_at')
        .returns<MemberRow[]>(),
    )
  ).map(toMember)

export const listMembers = (): Promise<Member[]> => membersOf(orgId())

/** Add an existing, owner-approved account to the current organization by email. */
export const addMember = async (email: string, role: Role) => {
  await run(supabase.rpc('add_member', { p_org: orgId(), p_email: email.trim(), p_role: role }))
}

export const updateMember = (userId: string, patch: { role?: Role; active?: boolean }) =>
  runChanged(supabase.from('memberships').update(patch).eq('org_id', orgId()).eq('user_id', userId).select('user_id'))

/** Remove someone from the current organization (or yourself: leave). */
export const removeMember = (userId: string) =>
  runChanged(supabase.from('memberships').delete().eq('org_id', orgId()).eq('user_id', userId).select('user_id'))

export const updateMyProfile = (userId: string, patch: { display_name: string | null }) =>
  runChanged(supabase.from('profiles').update(patch).eq('id', userId).select('id'))

// ---------------------------------------------------------------- owner (app admin)

export const adminListAccounts = async (): Promise<AdminAccount[]> => (await run(supabase.rpc('admin_accounts'))) as AdminAccount[]

export const adminListOrganizations = async (): Promise<AdminOrg[]> =>
  ((await run(supabase.rpc('admin_organizations'))) as AdminOrg[]).map((o) => num(o, ['members']))

/**
 * Create a login for someone. Without a server we can't use Supabase's admin
 * API, so we sign the new account up through a throwaway client (it never
 * touches your own session) and then approve it.
 */
export async function adminCreateAccount(a: { email: string; password: string; name: string }): Promise<string> {
  const temp = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'poker-ledger-admin-create' },
  })
  const { data, error } = await temp.auth.signUp({
    email: a.email.trim().toLowerCase(),
    password: a.password,
    options: { data: { display_name: a.name.trim() || undefined } },
  })
  if (error) {
    if (/already registered|already been registered/i.test(error.message)) throw new Error('An account with that email already exists.')
    if (/signups? not allowed|signup is disabled/i.test(error.message))
      throw new Error('Supabase is blocking new accounts. Turn on “Allow new users to sign up” (see SETUP.md).')
    throw new Error(error.message)
  }
  const id = data.user?.id
  // Supabase hides "already exists" when email confirmation is on: no identities come back.
  if (!id || (data.user?.identities && data.user.identities.length === 0)) throw new Error('An account with that email already exists.')
  if (!data.session) throw new Error('The account was created but needs email confirmation. Turn off “Confirm email” in Supabase (see SETUP.md).')
  await temp.auth.signOut().catch(() => undefined)
  await run(supabase.rpc('admin_set_approved', { p_user: id, p_approved: true }))
  return id
}

export const adminSetApproved = async (userId: string, approved: boolean) => {
  await run(supabase.rpc('admin_set_approved', { p_user: userId, p_approved: approved }))
}

export const adminSetPassword = async (userId: string, password: string) => {
  await run(supabase.rpc('admin_set_password', { p_user: userId, p_password: password }))
}

export const adminOrgMembers = (org: string): Promise<Member[]> => membersOf(org)

export const adminAddMember = async (org: string, email: string, role: Role) => {
  await run(supabase.rpc('add_member', { p_org: org, p_email: email.trim(), p_role: role }))
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

/** One dealer round: tips and rake (either can be 0, not both). */
export type TipInput = Pick<DealerTip, 'game_id' | 'dealer_name' | 'amount' | 'rake' | 'note'>
export const addTip = async (t: TipInput) => {
  await run(supabase.from('dealer_tips').insert(t))
}
export const updateTip = (id: string, patch: Partial<Omit<TipInput, 'game_id'>>) =>
  runChanged(supabase.from('dealer_tips').update(patch).eq('id', id).select('id'))
export const deleteTip = (id: string) => runChanged(supabase.from('dealer_tips').delete().eq('id', id).select('id'))

export type ExpenseInput = Pick<Expense, 'game_id' | 'category' | 'description' | 'amount' | 'partner_id'>
export const addExpense = async (e: ExpenseInput) => {
  await run(supabase.from('expenses').insert(e))
}
export const updateExpense = (id: string, patch: Partial<Omit<ExpenseInput, 'game_id'>>) =>
  runChanged(supabase.from('expenses').update(patch).eq('id', id).select('id'))
export const deleteExpense = (id: string) => runChanged(supabase.from('expenses').delete().eq('id', id).select('id'))

/** Distinct dealer names used before, most recent first (for quick picks). */
export async function recentDealerNames(): Promise<string[]> {
  const rows = await run(
    supabase
      .from('dealer_tips')
      .select('dealer_name')
      .eq('org_id', orgId())
      .order('created_at', { ascending: false })
      .limit(200)
      .returns<{ dealer_name: string }[]>(),
  )
  const seen = new Map<string, string>()
  for (const r of rows) {
    const k = r.dealer_name.trim().toLowerCase()
    if (!seen.has(k)) seen.set(k, r.dealer_name.trim())
  }
  return [...seen.values()].slice(0, 8)
}

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

export async function listAudit(f: AuditFilter = {}): Promise<AuditEntry[]> {
  let q = supabase.from('audit_log').select('*').eq('org_id', orgId())
  if (f.gameId) q = q.eq('game_id', f.gameId)
  if (f.playerId) q = q.eq('player_id', f.playerId)
  if (f.partnerId) q = q.eq('partner_id', f.partnerId)
  if (f.actorEmail) q = q.eq('actor_email', f.actorEmail)
  if (f.table) q = q.eq('table_name', f.table)
  if (f.beforeId) q = q.lt('id', f.beforeId)
  return run(q.order('id', { ascending: false }).limit(f.limit ?? 100).returns<AuditEntry[]>())
}
