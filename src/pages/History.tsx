import { useMemo, useState } from 'react'
import { useAuth } from '../auth'
import { ActivityList } from '../components/ActivityList'
import { PageHeader, cx, inputCls } from '../components/ui'
import { listDealerAccounts, listGameTotals, listPartnerAccounts, listPlayers } from '../lib/api'
import { useLoader, useRealtime } from '../lib/hooks'
import type { AuditTable } from '../lib/types'

const TYPES: { value: '' | AuditTable; label: string }[] = [
  { value: '', label: 'Everything' },
  { value: 'transactions', label: 'Buy-ins, cash-outs & discounts' },
  { value: 'dealer_tips', label: 'Dealer rounds (rake & tips)' },
  { value: 'expenses', label: 'Expenses' },
  { value: 'player_payments', label: 'Player payments' },
  { value: 'dealer_payments', label: 'Dealer payments' },
  { value: 'partner_entries', label: 'Partner payouts' },
  { value: 'games', label: 'Games (started, ended)' },
  { value: 'players', label: 'Players' },
  { value: 'partners', label: 'Partners' },
  { value: 'dealers', label: 'Dealers' },
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
  const [dealerId, setDealerId] = useState('')

  const roster = useLoader(listPlayers, [])
  const games = useLoader(listGameTotals, [])
  const partners = useLoader(listPartnerAccounts, [])
  const dealers = useLoader(listDealerAccounts, [])
  useRealtime(['players', 'games', 'partners', 'dealers'], () => {
    void roster.reload()
    void games.reload()
    void partners.reload()
    void dealers.reload()
  })
  const dealerNames = useMemo(() => new Map((dealers.data ?? []).map((d) => [d.id, d.name] as const)), [dealers.data])
  const partnerNames = useMemo(() => new Map((partners.data ?? []).map((p) => [p.id, p.name] as const)), [partners.data])
  const playersById = useMemo(() => new Map((roster.data ?? []).map((p) => [p.id, p] as const)), [roster.data])
  const gameNames = useMemo(() => new Map((games.data ?? []).map((g) => [g.id, g.name] as const)), [games.data])

  const filter = {
    ...(actor && { actorId: actor }),
    ...(table && { table }),
    ...(playerId && { playerId }),
    ...(partnerId && { partnerId }),
    ...(dealerId && { dealerId }),
  }

  return (
    <>
      <PageHeader title="History" sub="Every action, to the second. Only you see it; nobody can edit or delete it." />

      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <select className={cx(inputCls, 'h-10 text-base sm:text-sm')} value={actor} onChange={(e) => setActor(e.target.value)} aria-label="Done by">
          <option value="">Everyone</option>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.display_name || `@${m.username}`}
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
        <select className={cx(inputCls, 'h-10 text-base sm:text-sm')} value={dealerId} onChange={(e) => setDealerId(e.target.value)} aria-label="Dealer">
          <option value="">All dealers</option>
          {(dealers.data ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-6">
        <ActivityList filter={filter} playersById={playersById} gameNames={gameNames} partnerNames={partnerNames} dealerNames={dealerNames} live />
      </div>
    </>
  )
}
