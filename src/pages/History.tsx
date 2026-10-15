import { useMemo, useState } from 'react'
import { useAuth } from '../auth'
import { ActivityList } from '../components/ActivityList'
import { PageHeader, cx, inputCls } from '../components/ui'
import { listGameTotals, listPartnerAccounts, listPlayers } from '../lib/api'
import { useLoader, useRealtime } from '../lib/hooks'
import type { AuditTable } from '../lib/types'

const TYPES: { value: '' | AuditTable; label: string }[] = [
  { value: '', label: 'Everything' },
  { value: 'transactions', label: 'Buy-ins, cash-outs & discounts' },
  { value: 'dealer_tips', label: 'Dealer rounds (rake & tips)' },
  { value: 'expenses', label: 'Expenses' },
  { value: 'player_payments', label: 'Player payments' },
  { value: 'partner_entries', label: 'Partner payouts' },
  { value: 'games', label: 'Games (started, ended)' },
  { value: 'players', label: 'Players' },
  { value: 'partners', label: 'Partners' },
  { value: 'partner_shares', label: 'Profit shares' },
  { value: 'memberships', label: 'Members' },
  { value: 'organizations', label: 'Organization settings' },
]

export function HistoryPage() {
  const { members } = useAuth()
  const [actor, setActor] = useState('')
  const [table, setTable] = useState<'' | AuditTable>('')
  const [playerId, setPlayerId] = useState('')
  const [partnerId, setPartnerId] = useState('')

  const roster = useLoader(listPlayers, [])
  const games = useLoader(listGameTotals, [])
  const partners = useLoader(listPartnerAccounts, [])
  useRealtime(['players', 'games', 'partners'], () => {
    void roster.reload()
    void games.reload()
    void partners.reload()
  })
  const partnerNames = useMemo(() => new Map((partners.data ?? []).map((p) => [p.id, p.name] as const)), [partners.data])
  const playersById = useMemo(() => new Map((roster.data ?? []).map((p) => [p.id, p] as const)), [roster.data])
  const gameNames = useMemo(() => new Map((games.data ?? []).map((g) => [g.id, g.name] as const)), [games.data])

  const filter = {
    ...(actor && { actorEmail: actor }),
    ...(table && { table }),
    ...(playerId && { playerId }),
    ...(partnerId && { partnerId }),
  }

  return (
    <>
      <PageHeader title="History" sub="Every action, to the second. Can’t be edited or deleted." />

      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <select className={cx(inputCls, 'h-10 text-base sm:text-sm')} value={actor} onChange={(e) => setActor(e.target.value)} aria-label="Done by">
          <option value="">Everyone</option>
          {members
            .filter((m) => m.email)
            .map((m) => (
              <option key={m.user_id} value={m.email!}>
                {m.display_name || m.email}
              </option>
            ))}
        </select>
        <select
          className={cx(inputCls, 'h-10 text-base sm:text-sm')}
          value={table}
          onChange={(e) => setTable(e.target.value as '' | AuditTable)}
          aria-label="Type"
        >
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select className={cx(inputCls, 'h-10 text-base sm:text-sm')} value={playerId} onChange={(e) => setPlayerId(e.target.value)} aria-label="Player">
          <option value="">All players</option>
          {(roster.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select className={cx(inputCls, 'h-10 text-base sm:text-sm')} value={partnerId} onChange={(e) => setPartnerId(e.target.value)} aria-label="Partner">
          <option value="">All partners</option>
          {(partners.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-6">
        <ActivityList filter={filter} playersById={playersById} gameNames={gameNames} partnerNames={partnerNames} live />
      </div>
    </>
  )
}
