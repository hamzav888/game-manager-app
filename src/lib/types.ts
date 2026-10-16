export type Role = 'admin' | 'organizer'

/** An organization the signed-in account belongs to. */
export interface MyOrg {
  id: string
  name: string
  role: Role
  /** false = an admin paused this account's access */
  active: boolean
  tip_tax_pct: number
  loss_discount_pct: number
  joined_at: string
}

/** A person in the current organization. */
export interface Member {
  user_id: string
  role: Role
  active: boolean
  created_at: string
  /** their sign-in name */
  username: string | null
  email: string | null
  display_name: string | null
}

/** Who recorded a row (set by the database). */
export interface Stamped {
  created_by?: string | null
  updated_by?: string | null
}

/** Owner view: one account in the app. */
export interface AdminAccount {
  id: string
  /** their sign-in name */
  username: string | null
  email: string | null
  display_name: string | null
  /** created or approved by the owner; only approved accounts can join organizations */
  approved: boolean
  is_owner: boolean
  created_at: string
  last_sign_in_at: string | null
  /** e.g. "Riverside (admin), Thursday Game" */
  organizations: string | null
}

/** Owner view: one organization in the app. */
export interface AdminOrg {
  id: string
  name: string
  created_at: string
  members: number
  admins: string | null
}

export interface Player {
  id: string
  name: string
  phone: string | null
  notes: string | null
  /** their own loss discount %: null = the game's rate, 0 = never */
  loss_discount_pct: number | null
  created_at: string
}

export type GameStatus = 'open' | 'closed'

export interface Game {
  id: string
  name: string
  game_date: string
  status: GameStatus
  notes: string | null
  created_at: string
  closed_at: string | null
  /** % of dealer tips the house keeps */
  tip_tax_pct: number
  /** % of a losing player's loss given back */
  loss_discount_pct: number
}

export type TxKind = 'buy_in' | 'cash_out' | 'discount'
/** 'account' = on credit, settled later through the player's account. */
export type PayMethod = 'cash' | 'transfer' | 'account' | 'other'

export interface Transaction extends Stamped {
  id: string
  game_id: string
  player_id: string
  kind: TxKind
  amount: number
  method: PayMethod
  note: string | null
  created_at: string
  updated_at: string | null
}

/** One dealer round: what the dealer reports when they get up. */
export interface DealerTip extends Stamped {
  id: string
  game_id: string
  /** the dealer's account */
  dealer_id: string
  /** the dealer's name (kept in sync with their account) */
  dealer_name: string
  /** tips the dealer collected */
  amount: number
  /** rake the dealer took for the house this round (varies every round) */
  rake: number
  /** how the dealer's tips (after tip tax) were paid: now, or owed on their account */
  method: TipMethod
  note: string | null
  created_at: string
  updated_at: string | null
}

export type TipMethod = 'cash' | 'transfer' | 'account'

export type ExpenseCategory = 'food' | 'drinks' | 'venue' | 'dealer_pay' | 'supplies' | 'other'

export interface Expense extends Stamped {
  id: string
  game_id: string
  category: ExpenseCategory
  description: string | null
  amount: number
  /** null = paid from the game bank */
  partner_id: string | null
  /** display label, kept in sync with the partner by the database */
  paid_by: string
  /** dealer pay: which dealer it went to */
  dealer_id?: string | null
  created_at: string
  updated_at: string | null
}

export interface Settings {
  tip_tax_pct: number
  loss_discount_pct: number
}

export interface Partner {
  id: string
  name: string
  email: string | null
  share_pct: number
  active: boolean
  notes: string | null
  created_at: string
}

export interface PartnerAccount extends Partner {
  expenses_paid: number
  profit_share: number
  contributions: number
  payouts: number
  /** positive = the business owes the partner */
  balance: number
}

export interface PartnerEntry extends Stamped {
  id: string
  partner_id: string
  kind: 'payout' | 'contribution'
  amount: number
  method: 'cash' | 'transfer'
  note: string | null
  created_at: string
  updated_at: string | null
}

export interface PlayerPayment extends Stamped {
  id: string
  player_id: string
  /** from_player: the player paid the house · to_player: the house paid the player */
  direction: 'from_player' | 'to_player'
  amount: number
  method: 'cash' | 'transfer'
  note: string | null
  created_at: string
  updated_at: string | null
}

export interface Dealer {
  id: string
  name: string
  phone: string | null
  notes: string | null
  active: boolean
  created_at: string
}

export interface DealerAccount extends Dealer {
  rounds: number
  games: number
  /** rake they collected for the house */
  total_rake: number
  /** tips they made, before tip tax */
  total_tips: number
  tip_tax: number
  /** tips after tip tax: what they take home */
  net_tips: number
  /** dealer pay (expenses) that went to them */
  dealer_pay: number
  last_dealt: string | null
  /** positive = the house owes the dealer */
  balance: number
}

export interface DealerPayment extends Stamped {
  id: string
  dealer_id: string
  /** to_dealer: the house paid the dealer · from_dealer: the dealer paid the house */
  direction: 'to_dealer' | 'from_dealer'
  amount: number
  method: 'cash' | 'transfer'
  note: string | null
  created_at: string
  updated_at: string | null
}

/** A dealer round with the game it belongs to. */
export interface DealerRound extends DealerTip {
  game_name: string
  game_date: string
  tip_tax_pct: number
}

/** A partner's cut of one ended game, posted when the game ended. */
export interface PartnerShare {
  id: string
  game_id: string
  partner_id: string
  share_pct: number
  game_profit: number
  amount: number
  created_at: string
}

export interface PartnerShareWithGame extends PartnerShare {
  game_name: string
  game_date: string
}

/** A player's buy-in / cash-out / discount, with the game it belongs to. */
export interface AccountTx extends Transaction {
  game_name: string
  game_date: string
}

export type AuditTable =
  | 'organizations'
  | 'memberships'
  | 'players'
  | 'games'
  | 'transactions'
  | 'dealer_tips'
  | 'expenses'
  | 'partners'
  | 'partner_entries'
  | 'partner_shares'
  | 'player_payments'
  | 'dealers'
  | 'dealer_payments'
  /** account-level: created, renamed, approved, blocked */
  | 'profiles'
  | 'passwords'
  | 'sign_ins'
  | 'app_admins'

export interface AuditEntry {
  id: number
  org_id?: string | null
  occurred_at: string
  actor_email: string | null
  table_name: AuditTable
  action: 'INSERT' | 'UPDATE' | 'DELETE'
  record_id: string | null
  actor_id?: string | null
  game_id: string | null
  player_id: string | null
  partner_id?: string | null
  dealer_id?: string | null
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
}

export interface GameTotals {
  id: string
  name: string
  game_date: string
  status: GameStatus
  created_at: string
  closed_at: string | null
  tip_tax_pct: number
  loss_discount_pct: number
  total_buy_ins: number
  total_cash_outs: number
  total_discounts: number
  player_count: number
  total_tips: number
  tip_tax: number
  total_expenses: number
  /** reported rake + over/short + tip tax (before loss discounts) */
  house_take: number
  net_profit: number
  /** rake reported by dealers */
  total_rake: number
  /** buy-ins − cash-outs − tips − rake: chips in play while live, over/short once everyone is out */
  over_short: number
  seated_count: number
  last_round_at: string | null
}

export interface PlayerTotals {
  id: string
  name: string
  phone: string | null
  notes: string | null
  created_at: string
  games_played: number
  total_buy_ins: number
  total_cash_outs: number
  total_discounts: number
  net: number
  last_played: string | null
  /** account balance: positive = the house owes the player, negative = the player owes */
  balance: number
  /** null = the game's rate, 0 = never */
  loss_discount_pct: number | null
}

export interface PlayerGameResult {
  player_id: string
  game_id: string
  game_name: string
  game_date: string
  game_status: GameStatus
  buy_ins: number
  cash_outs: number
  discounts: number
  buy_in_count: number
  net: number
}

export interface GameData {
  game: Game | null
  txs: Transaction[]
  tips: DealerTip[]
  expenses: Expense[]
}

export interface AuditFilter {
  gameId?: string
  playerId?: string
  partnerId?: string
  dealerId?: string
  /** the account that did it */
  actorId?: string
  /** owner only: every organization plus account-level events, not just the current organization */
  everywhere?: boolean
  /** with `everywhere`: only account-level events (no organization) */
  accountsOnly?: boolean
  /** owner only: one particular organization (instead of the current one) */
  inOrg?: string
  table?: AuditTable
  /** load entries older than this id (pagination) */
  beforeId?: number
  limit?: number
}

export const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: 'food', label: 'Food' },
  { value: 'drinks', label: 'Drinks' },
  { value: 'venue', label: 'Venue / rent' },
  { value: 'dealer_pay', label: 'Dealer pay' },
  { value: 'supplies', label: 'Supplies' },
  { value: 'other', label: 'Other' },
]

/** Owner only: id → name for everything in the history, across organizations. */
export interface NameBook {
  org: Map<string, string>
  player: Map<string, string>
  game: Map<string, string>
  partner: Map<string, string>
  dealer: Map<string, string>
  account: Map<string, string>
}

export const TIP_METHODS: { value: TipMethod; label: string }[] = [
  { value: 'cash', label: 'Paid cash' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'account', label: 'Owed' },
]

export const PAY_METHODS: { value: PayMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'account', label: 'On account' },
]

/** Expenses paid out of the game's own money rather than by a partner. */
export const BANK_PAYER = 'Game bank'

export const categoryLabel = (c: string) => EXPENSE_CATEGORIES.find((x) => x.value === c)?.label ?? c
export const methodLabel = (m: string) =>
  PAY_METHODS.find((x) => x.value === m)?.label ?? (m === 'other' ? 'Other' : m)
