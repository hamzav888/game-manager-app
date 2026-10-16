import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useAuth } from '../auth'
import { ActivityList } from '../components/ActivityList'
import { Icon } from '../components/Icon'
import { Ledger } from '../components/Ledger'
import {
  AmountInput,
  Avatar,
  Badge,
  Button,
  Card,
  Empty,
  ErrorBox,
  Field,
  IconButton,
  Loading,
  Money,
  PageHeader,
  PercentInput,
  SectionTitle,
  Segmented,
  Sheet,
  Tabs,
  TextInput,
  cx,
  inputCls,
  useAction,
  useFeedback,
} from '../components/ui'
import {
  addPartnerEntry,
  createPartner,
  deletePartner,
  deletePartnerEntry,
  listPartnerAccounts,
  listPartnerEntries,
  listPartnerExpenses,
  listPartnerShares,
  listPlayers,
  updatePartner,
} from '../lib/api'
import { money, parseAmount } from '../lib/format'
import { useRecordStamps } from '../lib/actors'
import { useLoader, useRealtime } from '../lib/hooks'
import { partnerLedger } from '../lib/ledger'
import type { PartnerAccount, PartnerEntry } from '../lib/types'

const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`

function balanceLabel(b: number) {
  if (b > 0.004) return 'We owe them'
  if (b < -0.004) return 'They owe us'
  return 'Settled'
}

// ---------------------------------------------------------------- partner form

function PartnerSheet({ existing, onClose, onSaved }: { existing?: PartnerAccount; onClose: () => void; onSaved: (id?: string) => void }) {
  const { confirm } = useFeedback()
  const { busy, run } = useAction()
  const [name, setName] = useState(existing?.name ?? '')
  const [share, setShare] = useState(existing ? String(existing.share_pct) : '')
  const [email, setEmail] = useState(existing?.email ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const shareN = Number(share || 0)
  const valid = name.trim() && Number.isFinite(shareN) && shareN >= 0 && shareN <= 100 && (!email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))

  const save = async () => {
    const payload = { name: name.trim(), share_pct: shareN, email: email.trim().toLowerCase() || null, notes: notes.trim() || null }
    let id: string | undefined
    const ok = await run(async () => {
      if (existing) await updatePartner(existing.id, payload)
      else id = (await createPartner(payload)).id
    }, existing ? 'Partner updated' : 'Partner added')
    if (ok) {
      onSaved(id)
      onClose()
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={existing ? 'Edit partner' : 'Add a partner'}
      subtitle="Partners own the game: they split the profit and can be charged expenses."
      footer={
        <Button variant="primary" size="lg" className="w-full" disabled={!valid} loading={busy} onClick={save}>
          {existing ? 'Save changes' : 'Add partner'}
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus={!existing} />
        </Field>
        <Field label="Profit share" hint="Their cut of each ended game’s net profit. Shares should add up to 100%.">
          <PercentInput value={share} onChange={setShare} />
        </Field>
        <Field label="Email (optional)" hint="Their login email, if they’re also a member of this organization.">
          <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoCapitalize="none" />
        </Field>
        <Field label="Notes (optional)">
          <textarea className={cx(inputCls, 'h-20 py-2')} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
        </Field>
      </div>
      {existing && (
        <div className="mt-6 flex flex-wrap gap-3">
          <Button onClick={() => run(() => updatePartner(existing.id, { active: !existing.active }), existing.active ? 'Partner archived' : 'Partner restored').then((ok) => ok && (onSaved(), onClose()))}>
            {existing.active ? 'Archive partner' : 'Restore partner'}
          </Button>
          <Button
            variant="danger"
            icon="trash"
            onClick={async () => {
              if (await confirm({ title: `Delete ${existing.name}?`, message: 'Only possible if they have no expenses or payouts. Archive them otherwise.', confirmLabel: 'Delete', danger: true }))
                if (await run(() => deletePartner(existing.id), 'Partner deleted')) {
                  onSaved()
                  onClose()
                }
            }}
          >
            Delete
          </Button>
        </div>
      )}
    </Sheet>
  )
}

function EntrySheet({ partner, onClose, onSaved }: { partner: PartnerAccount; onClose: () => void; onSaved: () => void }) {
  const { busy, run } = useAction()
  const [kind, setKind] = useState<PartnerEntry['kind']>('payout')
  const [amount, setAmount] = useState(partner.balance > 0 ? String(Math.round(partner.balance)) : '')
  const [method, setMethod] = useState<PartnerEntry['method']>('transfer')
  const [note, setNote] = useState('')
  const value = parseAmount(amount)

  const save = async () => {
    const ok = await run(
      () => addPartnerEntry({ partner_id: partner.id, kind, amount: value, method, note: note.trim() || null }),
      kind === 'payout' ? `Paid ${partner.name} ${money(value)}` : `${partner.name} put in ${money(value)}`,
    )
    if (ok) {
      onSaved()
      onClose()
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Record money"
      subtitle={partner.name}
      footer={
        <Button variant="primary" size="lg" className="w-full" disabled={!(value > 0)} loading={busy} onClick={save}>
          {kind === 'payout' ? `Pay ${partner.name}` : `Record contribution`}
        </Button>
      }
    >
      <div className="space-y-4">
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'payout', label: 'We paid them' },
            { value: 'contribution', label: 'They put money in' },
          ]}
        />
        <AmountInput value={amount} onChange={setAmount} autoFocus />
        <Field label="Method">
          <Segmented
            value={method}
            onChange={setMethod}
            options={[
              { value: 'transfer', label: 'Transfer' },
              { value: 'cash', label: 'Cash' },
            ]}
          />
        </Field>
        <Field label="Note (optional)">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. October split" />
        </Field>
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------- list

export function PartnersPage() {
  const { isAdmin } = useAuth()
  const navigate = useNavigate()
  const { data, error, reload } = useLoader(listPartnerAccounts, [])
  useRealtime(['partners', 'partner_entries', 'expenses', 'games', 'transactions', 'dealer_tips'], reload)
  const [adding, setAdding] = useState(false)

  const active = (data ?? []).filter((p) => p.active)
  const archived = (data ?? []).filter((p) => !p.active)
  const owed = active.reduce((s, p) => s + Math.round(p.balance * 100), 0) / 100
  const shares = active.reduce((s, p) => s + p.share_pct, 0)

  return (
    <>
      <PageHeader
        title="Partners"
        sub="Owners, their share, and what they’re owed"
        action={
          isAdmin && (
            <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
              Add
            </Button>
          )
        }
      />

      {error ? (
        <div className="mt-5">
          <ErrorBox error={error} onRetry={reload} />
        </div>
      ) : !data ? (
        <Loading />
      ) : active.length === 0 ? (
        <Card className="mt-5">
          <Empty icon="briefcase" title="No partners yet">
            Add the people who run the game with their profit share. Expenses can then be charged to their accounts.
          </Empty>
        </Card>
      ) : (
        <>
          <Card className="mt-5 grid grid-cols-2 divide-x divide-line">
            <div className="px-4 py-3.5">
              <div className="text-[12px] text-muted">Owed to partners</div>
              <Money value={owed} className="font-display text-[32px] leading-tight" />
            </div>
            <div className="px-4 py-3.5">
              <div className="text-[12px] text-muted">Shares</div>
              <div className={cx('font-display text-[32px] leading-tight', Math.abs(shares - 100) > 0.01 && 'text-warn')}>{pct(shares)}</div>
              {Math.abs(shares - 100) > 0.01 && <div className="text-[11px] text-warn">should total 100%</div>}
            </div>
          </Card>

          <SectionTitle>Accounts</SectionTitle>
          <Card className="divide-y divide-line overflow-hidden">
            {active.map((p) => (
              <Link key={p.id} to={`/partners/${p.id}`} className="flex items-center gap-3.5 px-4 py-3.5 hover:bg-surface-2/60">
                <Avatar name={p.name} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{p.name}</span>
                    <Badge tone="brass">{pct(p.share_pct)}</Badge>
                  </div>
                  <div className="truncate text-[13px] text-muted">
                    Share <Money value={p.profit_share} signed /> · expenses <Money value={p.expenses_paid} /> · paid <Money value={p.payouts} />
                  </div>
                </div>
                <div className="text-right">
                  <Money value={p.balance} className="font-display text-[22px] leading-none" />
                  <div className="mt-0.5 text-[11px] text-faint">{balanceLabel(p.balance)}</div>
                </div>
              </Link>
            ))}
          </Card>

          {archived.length > 0 && (
            <>
              <SectionTitle>Archived</SectionTitle>
              <Card className="divide-y divide-line">
                {archived.map((p) => (
                  <Link key={p.id} to={`/partners/${p.id}`} className="flex items-center gap-3 px-4 py-3 text-muted hover:bg-surface-2/60">
                    <Avatar name={p.name} size={32} />
                    <span className="flex-1 truncate">{p.name}</span>
                    <Money value={p.balance} />
                  </Link>
                ))}
              </Card>
            </>
          )}
        </>
      )}

      {adding && <PartnerSheet onClose={() => setAdding(false)} onSaved={(id) => (id ? navigate(`/partners/${id}`) : reload())} />}
    </>
  )
}

// ---------------------------------------------------------------- detail

export function PartnerPage() {
  const { id = '' } = useParams()
  const { isAdmin, isOwner } = useAuth()
  const { run } = useAction()
  const [tab, setTab] = useState<'ledger' | 'history'>('ledger')
  const [editing, setEditing] = useState(false)
  const [recording, setRecording] = useState(false)

  const accounts = useLoader(listPartnerAccounts, [])
  const entries = useLoader(() => listPartnerEntries(id), [id])
  const expenses = useLoader(() => listPartnerExpenses(id), [id])
  const shares = useLoader(() => listPartnerShares(id), [id])
  const roster = useLoader(listPlayers, [])
  const stampRows = useMemo(() => [...(entries.data ?? []), ...(expenses.data ?? [])], [entries.data, expenses.data])
  const stamps = useRecordStamps({ partnerId: id }, stampRows)
  const reloadAll = () => {
    void accounts.reload()
    void entries.reload()
    void expenses.reload()
    void shares.reload()
  }
  useRealtime(['partners', 'partner_entries', 'partner_shares', 'expenses', 'games', 'transactions', 'dealer_tips'], reloadAll)

  const p = accounts.data?.find((x) => x.id === id)
  const playersById = useMemo(() => new Map((roster.data ?? []).map((x) => [x.id, x] as const)), [roster.data])
  const partnerNames = useMemo(() => new Map((accounts.data ?? []).map((x) => [x.id, x.name] as const)), [accounts.data])
  const ledgerEntries = useMemo(
    () =>
      p && shares.data && expenses.data && entries.data ? partnerLedger(p.name, shares.data, expenses.data, entries.data, stamps) : undefined,
    [p, shares.data, expenses.data, entries.data, stamps],
  )

  if (accounts.error) return <ErrorBox error={accounts.error} onRetry={accounts.reload} />
  if (!accounts.data) return <Loading />
  if (!p)
    return (
      <Card>
        <Empty icon="briefcase" title="Partner not found">
          <Link to="/partners" className="underline">
            Back to partners
          </Link>
        </Empty>
      </Card>
    )

  return (
    <>
      <div className="flex items-center gap-3">
        <Link to="/partners" className="-ml-2 rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Back to partners">
          <Icon name="back" />
        </Link>
        <Avatar name={p.name} size={46} />
        <div className="min-w-0 flex-1">
          <h1 className="font-display truncate text-[32px] leading-none">{p.name}</h1>
          <div className="mt-1 truncate text-[13px] text-muted">
            {pct(p.share_pct)} share{p.email ? ` · ${p.email}` : ''}
            {!p.active && ' · archived'}
          </div>
        </div>
        {isAdmin && <IconButton icon="edit" label="Edit partner" onClick={() => setEditing(true)} />}
      </div>

      <div className="mt-5">
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            { value: 'ledger', label: 'Ledger' },
            // the history is for the app owner only
            ...(isOwner ? [{ value: 'history' as const, label: 'Change history' }] : []),
          ]}
        />
      </div>

      {tab === 'ledger' && (
        <div className="mt-5">
          <Ledger
            name={p.name}
            entries={ledgerEntries}
            exportName={p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}
            emptyText="Profit shares post here when games close, alongside expenses they paid and every payout."
            actions={
              isAdmin && (
                <Button size="sm" variant="primary" icon="wallet" onClick={() => setRecording(true)}>
                  Record payout / contribution
                </Button>
              )
            }
            onDelete={isAdmin ? (row) => run(() => deletePartnerEntry(row.id), 'Entry deleted').then((ok) => (reloadAll(), ok)) : undefined}
          />
          <p className="mt-1 px-1 text-xs leading-relaxed text-faint">
            Profit shares are posted at {p.name}’s share % when each game ends, so changing the % later never rewrites the past.
          </p>
        </div>
      )}

      {tab === 'history' && isOwner && (
        <div className="mt-5">
          <ActivityList filter={{ partnerId: p.id }} playersById={playersById} partnerNames={partnerNames} live />
        </div>
      )}

      {editing && <PartnerSheet existing={p} onClose={() => setEditing(false)} onSaved={reloadAll} />}
      {recording && <EntrySheet partner={p} onClose={() => setRecording(false)} onSaved={reloadAll} />}
    </>
  )
}
