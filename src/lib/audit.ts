import { money, signedMoney } from './format'
import { categoryLabel, methodLabel } from './types'
import type { AuditEntry } from './types'

export interface AuditContext {
  playerName: (id: string | null | undefined) => string | null
  gameName?: (id: string | null | undefined) => string | null
  partnerName?: (id: string | null | undefined) => string | null
  dealerName?: (id: string | null | undefined) => string | null
  /** organization name (the owner's all-organizations view) */
  orgName?: (id: string | null | undefined) => string | null
  /** member name by account id (for membership changes) */
  memberName?: (userId: string | null | undefined) => string | null
  actorName: (email: string | null) => string
}

export interface DescribedAudit {
  actor: string
  summary: string
  /** for edits: "Amount: $500 → $700" */
  changes: string[]
  /** the full record that was added or deleted (and context like game / player) */
  details: { label: string; value: string }[]
  tone: 'add' | 'edit' | 'delete'
}

type Row = Record<string, unknown>

const str = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v))
const amt = (v: unknown) => money(Number(v ?? 0))

const FIELD_LABELS: Record<string, string> = {
  amount: 'Amount',
  rake: 'Rake',
  username: 'Username',
  approved: 'Access',
  method: 'Method',
  note: 'Note',
  dealer_name: 'Dealer',
  category: 'Category',
  description: 'Description',
  paid_by: 'Paid by',
  name: 'Name',
  phone: 'Phone',
  notes: 'Notes',
  game_date: 'Date',
  status: 'Status',
  display_name: 'Name',
  role: 'Role',
  active: 'Active',
  tip_tax_pct: 'Tip tax',
  loss_discount_pct: 'Loss discount',
  share_pct: 'Share',
  email: 'Email',
  kind: 'Type',
  direction: 'Direction',
  partner_id: 'Paid by',
  game_profit: 'Game net profit',
  expires_at: 'Expires',
}

const KIND_LABELS: Record<string, string> = {
  buy_in: 'Buy-in',
  cash_out: 'Cash-out',
  discount: 'Loss discount',
  payout: 'Payout to partner',
  contribution: 'Money put in by partner',
}

// Which fields to show (in order) for a whole record.
const RECORD_FIELDS: Record<string, string[]> = {
  transactions: ['kind', 'amount', 'method', 'note'],
  dealer_tips: ['dealer_name', 'rake', 'amount', 'method', 'note'],
  dealers: ['name', 'phone', 'notes'],
  dealer_payments: ['direction', 'amount', 'method', 'note'],
  profiles: ['username', 'display_name', 'approved'],
  expenses: ['category', 'description', 'amount', 'paid_by'],
  player_payments: ['direction', 'amount', 'method', 'note'],
  partner_entries: ['kind', 'amount', 'method', 'note'],
  partner_shares: ['share_pct', 'game_profit', 'amount'],
  games: ['name', 'game_date', 'status', 'tip_tax_pct', 'loss_discount_pct', 'notes'],
  players: ['name', 'phone', 'loss_discount_pct', 'notes'],
  partners: ['name', 'share_pct', 'email', 'notes'],
  organizations: ['name', 'tip_tax_pct', 'loss_discount_pct'],
  memberships: ['role', 'active'],
}

const IGNORED = new Set([
  'id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'closed_at', 'closed_by', 'game_id', 'player_id', 'partner_id',
  'org_id', 'user_id', 'org_name', 'token', 'accepted_by', 'accepted_at', 'dealer_id', 'approved_at', 'approved_by',
])

/** Per-table names for a field, where the generic one would mislead. */
const TABLE_LABELS: Record<string, Record<string, string>> = {
  dealer_tips: { amount: 'Tips', method: 'Tips paid' },
  profiles: { display_name: 'Name' },
}
/** Fields that change as a side effect and would only be noise in a diff. */
const TABLE_IGNORED: Record<string, string[]> = {
  profiles: ['email'],
}
const labelFor = (table: string, key: string) => TABLE_LABELS[table]?.[key] ?? FIELD_LABELS[key] ?? key

function fieldValue(key: string, v: unknown, table?: string): string {
  if (key === 'amount' || key === 'rake') return amt(v)
  if (key === 'loss_discount_pct' && table === 'players') return v === null || v === undefined ? 'House rate' : Number(v) === 0 ? 'None' : `${Number(v)}%`
  if (key === 'method' && table === 'dealer_tips') return v === 'account' ? 'Owed to the dealer' : methodLabel(str(v))
  if (key === 'approved') return v ? 'Approved' : 'Not approved'
  if (key === 'username') return v ? `@${String(v)}` : '—'
  if (key === 'direction' && (v === 'to_dealer' || v === 'from_dealer')) return v === 'to_dealer' ? 'We paid the dealer' : 'The dealer paid us'
  if (key === 'method') return methodLabel(str(v))
  if (key === 'category') return categoryLabel(str(v))
  if (key === 'active') return v ? 'Yes' : 'No'
  if (key === 'tip_tax_pct' || key === 'loss_discount_pct' || key === 'share_pct') return `${Number(v ?? 0)}%`
  if (key === 'kind') return KIND_LABELS[String(v)] ?? str(v)
  if (key === 'direction') return v === 'from_player' ? 'Player paid us' : 'We paid the player'
  if (key === 'game_profit') return signedMoney(Number(v ?? 0))
  if (key === 'status') return v === 'closed' ? 'Ended' : 'Open'
  if (key === 'role') return v === 'admin' ? 'Admin' : 'Organizer'
  if (key === 'expires_at') return new Date(String(v)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  return str(v)
}

function diff(table: string, oldRow: Row | null, newRow: Row | null): string[] {
  if (!oldRow || !newRow) return []
  const out: string[] = []
  for (const key of Object.keys(newRow)) {
    if (IGNORED.has(key) || TABLE_IGNORED[table]?.includes(key)) continue
    const a = oldRow[key]
    const b = newRow[key]
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue
    out.push(`${labelFor(table, key)}: ${fieldValue(key, a, table)} → ${fieldValue(key, b, table)}`)
  }
  return out
}

export function describeAudit(e: AuditEntry, ctx: AuditContext): DescribedAudit {
  const row = (e.new_data ?? e.old_data ?? {}) as Row
  const actor = ctx.actorName(e.actor_email)
  const tone: DescribedAudit['tone'] = e.action === 'INSERT' ? 'add' : e.action === 'UPDATE' ? 'edit' : 'delete'
  const changes = e.action === 'UPDATE' ? diff(e.table_name, e.old_data, e.new_data) : []
  const player = ctx.playerName(e.player_id) ?? 'a player'
  const details: DescribedAudit['details'] = []
  if (e.action !== 'UPDATE') {
    for (const key of RECORD_FIELDS[e.table_name] ?? []) {
      const v = row[key]
      if (v === null || v === undefined || v === '') continue
      if (e.table_name === 'dealer_tips' && (key === 'rake' || key === 'amount') && Number(v) === 0) continue
      details.push({ label: key === 'kind' || key === 'direction' ? 'Type' : labelFor(e.table_name, key), value: fieldValue(key, v, e.table_name) })
    }
  }
  const gameName = e.table_name !== 'games' ? ctx.gameName?.(e.game_id) : null
  if (gameName) details.push({ label: 'Game', value: gameName })
  if (e.player_id && e.table_name !== 'players') details.push({ label: 'Player', value: player })
  const partnerName = e.table_name !== 'partners' ? ctx.partnerName?.(e.partner_id) : null
  if (partnerName) details.push({ label: 'Partner', value: partnerName })
  const dealer = e.table_name !== 'dealers' ? ctx.dealerName?.(e.dealer_id) : null
  if (dealer && e.table_name !== 'dealer_tips') details.push({ label: 'Dealer', value: dealer })
  const orgName = ctx.orgName?.(e.org_id)
  if (orgName) details.push({ label: 'Organization', value: orgName })
  const who = (v: unknown) => (v ? `@${String(v)}` : 'an account')
  const inGame = ctx.gameName?.(e.game_id) ? ` in ${ctx.gameName(e.game_id)}` : ''

  let summary: string
  switch (e.table_name) {
    case 'transactions': {
      const isBuy = row.kind === 'buy_in'
      const what = isBuy ? 'buy-in' : row.kind === 'discount' ? 'loss discount' : 'cash-out'
      const via = row.method && row.method !== 'cash' ? ` (${methodLabel(String(row.method)).toLowerCase()})` : ''
      if (e.action === 'INSERT') {
        summary = isBuy
          ? `${player} bought in for ${amt(row.amount)}${via}`
          : row.kind === 'discount'
            ? `${player} got a ${amt(row.amount)} loss discount${via}`
            : Number(row.amount) === 0
              ? `${player} busted out`
              : `${player} cashed out ${amt(row.amount)}${via}`
      } else if (e.action === 'UPDATE') {
        summary = `Edited ${player}'s ${what}`
      } else {
        summary = `Deleted ${player}'s ${what} of ${amt(row.amount)}`
      }
      break
    }
    case 'dealer_tips': {
      const parts = [Number(row.rake ?? 0) > 0 && `rake ${amt(row.rake)}`, Number(row.amount ?? 0) > 0 && `tips ${amt(row.amount)}`]
        .filter(Boolean)
        .join(', ')
      summary =
        e.action === 'INSERT'
          ? `${str(row.dealer_name)}’s round: ${parts}${row.method === 'account' && Number(row.amount ?? 0) > 0 ? ' (tips owed)' : ''}`
          : e.action === 'UPDATE'
            ? `Edited ${str(row.dealer_name)}’s round`
            : `Deleted ${str(row.dealer_name)}’s round (${parts})`
      break
    }
    case 'expenses': {
      const label = `${categoryLabel(str(row.category))}${row.description ? ` (${row.description})` : ''}`
      summary =
        e.action === 'INSERT'
          ? `Expense ${amt(row.amount)} — ${label}, paid by ${str(row.paid_by)}`
          : e.action === 'UPDATE'
            ? `Edited expense — ${label}`
            : `Deleted expense ${amt(row.amount)} — ${label}`
      break
    }
    case 'games': {
      const name = str(row.name)
      if (e.action === 'INSERT') summary = `Started game “${name}”`
      else if (e.action === 'DELETE') summary = `Deleted game “${name}”`
      else if (e.old_data?.status !== e.new_data?.status)
        summary = e.new_data?.status === 'closed' ? `Ended game “${name}”` : `Reopened game “${name}”`
      else summary = `Edited game “${name}”`
      break
    }
    case 'players': {
      const name = str(row.name)
      summary =
        e.action === 'INSERT' ? `Added player ${name}` : e.action === 'UPDATE' ? `Edited player ${name}` : `Deleted player ${name}`
      break
    }
    case 'partners': {
      const name = str(row.name)
      summary =
        e.action === 'INSERT'
          ? `Added partner ${name} (${Number(row.share_pct ?? 0)}% share)`
          : e.action === 'UPDATE'
            ? `Edited partner ${name}`
            : `Removed partner ${name}`
      break
    }
    case 'partner_entries': {
      const who = ctx.partnerName?.(e.partner_id) ?? 'a partner'
      const what = row.kind === 'payout' ? `Paid ${who} ${amt(row.amount)}` : `${who} put in ${amt(row.amount)}`
      summary = e.action === 'DELETE' ? `Deleted: ${what.charAt(0).toLowerCase()}${what.slice(1)}` : what
      break
    }
    case 'partner_shares': {
      const who = ctx.partnerName?.(e.partner_id) ?? 'A partner'
      summary =
        e.action === 'DELETE'
          ? `Reversed ${who}’s ${amt(row.amount)} profit share (game reopened)`
          : `${who} credited ${signedMoney(Number(row.amount ?? 0))} profit share (${Number(row.share_pct ?? 0)}%)`
      break
    }
    case 'player_payments': {
      const what =
        row.direction === 'from_player' ? `${player} paid ${amt(row.amount)} toward their account` : `Paid ${player} ${amt(row.amount)} from their account`
      summary = e.action === 'DELETE' ? `Deleted payment — ${what}` : what
      break
    }
    case 'dealers': {
      const name = str(row.name)
      summary =
        e.action === 'INSERT' ? `Opened a dealer account for ${name}` : e.action === 'UPDATE' ? `Edited dealer ${name}` : `Removed dealer ${name}`
      break
    }
    case 'dealer_payments': {
      const name = ctx.dealerName?.(e.dealer_id) ?? 'the dealer'
      const what = row.direction === 'to_dealer' ? `Paid ${name} ${amt(row.amount)}` : `${name} paid the house ${amt(row.amount)}`
      summary = e.action === 'DELETE' ? `Deleted payment — ${what}` : what
      break
    }
    case 'profiles': {
      const changed = (k: string) => e.old_data && e.new_data && JSON.stringify(e.old_data[k] ?? null) !== JSON.stringify(e.new_data[k] ?? null)
      if (e.action === 'INSERT') summary = `Created the account ${who(row.username)}`
      else if (e.action === 'DELETE') summary = `Deleted the account ${who(row.username)}`
      else if (changed('approved')) summary = e.new_data?.approved ? `Approved ${who(row.username)}` : `Blocked ${who(row.username)}`
      else if (changed('username')) summary = `Changed the login ${who(e.old_data?.username)} to ${who(e.new_data?.username)}`
      else summary = `Edited the account ${who(row.username)}`
      break
    }
    case 'passwords':
      summary = row.by === 'self' ? 'Changed their own password' : `Set a new password for ${who(row.username)}`
      break
    case 'sign_ins':
      summary = `${who(row.username)} signed in`
      break
    case 'app_admins':
      summary = e.action === 'DELETE' ? 'Removed an app owner' : 'Made an account the app owner'
      break
    case 'organizations':
      summary =
        e.action === 'INSERT' ? `Created the organization “${str(row.name)}”` : e.action === 'UPDATE' ? 'Changed organization settings' : 'Deleted the organization'
      break
    case 'memberships': {
      const who = ctx.memberName?.(String(row.user_id ?? '')) ?? 'a member'
      const self = e.actor_id && e.actor_id === row.user_id
      summary =
        e.action === 'INSERT'
          ? `${who} joined as ${row.role === 'admin' ? 'an admin' : 'an organizer'}`
          : e.action === 'UPDATE'
            ? `Changed ${who}’s access`
            : self
              ? `${who} left the organization`
              : `Removed ${who} from the organization`
      break
    }
    default:
      summary = `${e.action} on ${e.table_name}`
  }

  const scoped = ['transactions', 'dealer_tips', 'expenses', 'partner_shares'].includes(e.table_name)
  return { actor, summary: scoped ? summary + inGame : summary, changes, details, tone }
}
