import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Icon } from '../components/Icon'
import {
  Avatar,
  Button,
  Card,
  Empty,
  ErrorBox,
  Field,
  Loading,
  Money,
  PageHeader,
  Segmented,
  Sheet,
  TextInput,
  useAction,
} from '../components/ui'
import { createPlayer, listPlayerTotals } from '../lib/api'
import { shortDate } from '../lib/format'
import { useLoader, useRealtime } from '../lib/hooks'

type Sort = 'name' | 'net' | 'owes'

export function PlayersPage() {
  const navigate = useNavigate()
  const { data, error, reload } = useLoader(listPlayerTotals, [])
  useRealtime(['players', 'transactions', 'games', 'player_payments'], reload)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('name')
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const { busy, run } = useAction()

  const rows = useMemo(() => {
    const list = (data ?? []).filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()))
    if (sort === 'net') return [...list].sort((a, b) => b.net - a.net)
    if (sort === 'owes') return [...list].filter((p) => Math.abs(p.balance) > 0.004).sort((a, b) => a.balance - b.balance)
    return list
  }, [data, q, sort])

  const owedToHouse = (data ?? []).reduce((s, p) => s + (p.balance < 0 ? -Math.round(p.balance * 100) : 0), 0) / 100
  const owedToPlayers = (data ?? []).reduce((s, p) => s + (p.balance > 0 ? Math.round(p.balance * 100) : 0), 0) / 100

  const add = async () => {
    let id = ''
    const ok = await run(async () => {
      id = (await createPlayer(name)).id
    }, 'Player added')
    if (ok) navigate(`/players/${id}`)
  }

  return (
    <>
      <PageHeader
        title="Players"
        sub={data ? `${data.length} regulars` : undefined}
        action={
          <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
            Add
          </Button>
        }
      />

      {data && (owedToHouse > 0 || owedToPlayers > 0) && (
        <Card className="mt-5 grid grid-cols-2 divide-x divide-line">
          <button type="button" className="px-4 py-3.5 text-left" onClick={() => setSort('owes')}>
            <div className="text-[12px] text-muted">Owed to the house</div>
            <Money value={owedToHouse} className="font-display text-[30px] leading-tight text-loss" />
          </button>
          <button type="button" className="px-4 py-3.5 text-left" onClick={() => setSort('owes')}>
            <div className="text-[12px] text-muted">Owed to players</div>
            <Money value={owedToPlayers} className="font-display text-[30px] leading-tight" />
          </button>
        </Card>
      )}

      <div className="mt-4 space-y-3">
        <div className="relative">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <TextInput placeholder="Search players" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <Segmented<Sort>
          value={sort}
          onChange={setSort}
          options={[
            { value: 'name', label: 'A–Z' },
            { value: 'net', label: 'Winners' },
            { value: 'owes', label: 'Accounts' },
          ]}
        />
      </div>

      <div className="mt-4">
        {error ? (
          <ErrorBox error={error} onRetry={reload} />
        ) : !data ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Card>
            <Empty icon="users" title={q ? 'No match' : sort === 'owes' ? 'All square' : 'No players yet'}>
              {q ? 'Try a different name.' : sort === 'owes' ? 'Nobody has an open account balance.' : 'Players are added when they first buy in, or here.'}
            </Empty>
          </Card>
        ) : (
          <Card className="divide-y divide-line overflow-hidden">
            {rows.map((p) => (
              <Link key={p.id} to={`/players/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/60">
                <Avatar name={p.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{p.name}</span>
                    {p.loss_discount_pct !== null && (
                      <span className="shrink-0 rounded border border-brass/30 px-1 text-[10px] font-medium text-brass">
                        {p.loss_discount_pct === 0 ? 'NO DISC.' : `${p.loss_discount_pct}% DISC.`}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[13px] text-muted">
                    {p.games_played} game{p.games_played === 1 ? '' : 's'}
                    {p.last_played && ` · last ${shortDate(p.last_played)}`}
                    {p.balance < -0.004 && (
                      <>
                        {' · '}
                        <span className="text-loss">
                          owes <Money value={-p.balance} />
                        </span>
                      </>
                    )}
                    {p.balance > 0.004 && (
                      <>
                        {' · '}
                        <span className="text-brass">
                          credit <Money value={p.balance} />
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <Money value={p.net} signed colored className="text-[15px] font-semibold" />
                  <div className="text-[11px] text-faint">all-time</div>
                </div>
              </Link>
            ))}
          </Card>
        )}
      </div>

      <Sheet
        open={adding}
        onClose={() => setAdding(false)}
        title="Add player"
        footer={
          <Button variant="primary" size="lg" className="w-full" disabled={!name.trim()} loading={busy} onClick={add}>
            Add player
          </Button>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) void add()
          }}
        >
          <Field label="Name">
            <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </Field>
        </form>
      </Sheet>
    </>
  )
}
