import { money, signedMoney } from './format'
import { categoryLabel, methodLabel } from './types'
import type { AuditEntry } from './types'

export interface AuditContext {
  playerName: (id: string | null | undefined) => string | null
  gameName?: (id: string | null | undefined) => string | null
  partnerName?: (id: string | null | undefined) => string | null
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
  dealer_tips: ['dealer_name', 'amount', 'note'],
  expenses: ['category', 'description', 'amount', 'paid_by'],
  player_payments: ['direction', 'amount', 'method', 'note'],
  partner_entries: ['kind', 'amount', 'method', 'note'],
  partner_shares: ['share_pct', 'game_profit', 'amount'],
  games: ['name', 'game_date', 'status', 'tip_tax_pct', 'loss_discount_pct', 'notes'],
  players: ['name', 'phone', 'notes'],
  partners: ['name', 'share_pct', 'email', 'notes'],
  organizations: ['name', 'tip_tax_pct', 'loss_discount_pct'],
  memberships: ['role', 'active'],
}

const IGNORED = new Set([
  'id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'closed_at', 'closed_by', 'game_id', 'player_id', 'partner_id',
  'org_id', 'user_id', 'org_name', 'token', 'accepted_by', 'accepted_at',
])

function fieldValue(key: string, v: unknown): string {
  if (key === 'amount') return amt(v)
  if (key === 'method') return methodLabel(str(v))
  if (key === 'category') return categoryLabel(str(v))
  if (key === 'active') return v ? 'Yes' : 'No'
  if (key === 'tip_tax_pct' || key === 'loss_discount_pct' || key === 'share_pct') return `${Number(v ?? 0)}%`
  if (key === 'kind') return KIND_LABELS[String(v)] ?? str(v)
  if (key === 'direction') return v === 'from_player' ? 'Player paid us' : 'We paid the player'
  if (key === 'game_profit') return signedMoney(Number(v ?? 0))
  if (key === 'status') return v === 'closed' ? 'Closed' : 'Open'
  if (key === 'role') return v === 'admin' ? 'Admin' : 'Organizer'
  if (key === 'expires_at') return new Date(String(v)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  return str(v)
}

function diff(oldRow: Row | null, newRow: Row | null): string[] {
  if (!oldRow || !newRow) return []
  const out: string[] = []
  for (const key of Object.keys(newRow)) {
    if (IGNORED.has(key)) continue
    const a = oldRow[key]
    const b = newRow[key]
    if (JSON.stringify(a) === JSON.stringify(b)) continue
    out.push(`${FIELD_LABELS[key] ?? key}: ${fieldValue(key, a)} → ${fieldValue(key, b)}`)
  }
  return out
}

export function describeAudit(e: AuditEntry, ctx: AuditContext): DescribedAudit {
  const row = (e.new_data ?? e.old_data ?? {}) as Row
  const actor = ctx.actorName(e.actor_email)
  const tone: DescribedAudit['tone'] = e.action === 'INSERT' ? 'add' : e.action === 'UPDATE' ? 'edit' : 'delete'
  const changes = e.action === 'UPDATE' ? diff(e.old_data, e.new_data) : []
  const player = ctx.playerName(e.player_id) ?? 'a player'
  const details: DescribedAudit['details'] = []
  if (e.action !== 'UPDATE') {
    for (const key of RECORD_FIELDS[e.table_name] ?? []) {
      const v = row[key]
      if (v === null || v === undefined || v === '') continue
      details.push({ label: key === 'kind' || key === 'direction' ? 'Type' : (FIELD_LABELS[key] ?? key), value: fieldValue(key, v) })
    }
  }
  const gameName = e.table_name !== 'games' ? ctx.gameName?.(e.game_id) : null
  if (gameName) details.push({ label: 'Game', value: gameName })
  if (e.player_id && e.table_name !== 'players') details.push({ label: 'Player', value: player })
  const partnerName = e.table_name !== 'partners' ? ctx.partnerName?.(e.partner_id) : null
  if (partnerName) details.push({ label: 'Partner', value: partnerName })
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
    case 'dealer_tips':
      summary =
        e.action === 'INSERT'
          ? `Dealer tip ${amt(row.amount)} for ${str(row.dealer_name)}`
          : e.action === 'UPDATE'
            ? `Edited dealer tip for ${str(row.dealer_name)}`
            : `Deleted dealer tip ${amt(row.amount)} for ${str(row.dealer_name)}`
      break
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
        summary = e.new_data?.status === 'closed' ? `Closed game “${name}”` : `Reopened game “${name}”`
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
