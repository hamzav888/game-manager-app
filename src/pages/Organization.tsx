import { useEffect, useState } from 'react'
import { useAuth } from '../auth'
import { Icon } from '../components/Icon'
import {
  Avatar,
  Badge,
  Button,
  Card,
  Field,
  Loading,
  PageHeader,
  PercentInput,
  SectionTitle,
  Segmented,
  Sheet,
  TextInput,
  cx,
  useAction,
  useFeedback,
} from '../components/ui'
import { Link } from 'react-router'
import { addMember, removeMember, updateMember, updateOrganization } from '../lib/api'
import { formatStamp } from '../lib/format'
import type { Member, Role } from '../lib/types'
import { USERNAME_RE, cleanUsername } from '../lib/username'

const ROLES: { value: Role; label: string }[] = [
  { value: 'organizer', label: 'Organizer' },
  { value: 'admin', label: 'Admin' },
]

// ---------------------------------------------------------------- name + house rules

function OrgSettingsCard() {
  const { org, isAdmin, refresh } = useAuth()
  const { busy, run } = useAction()
  const [name, setName] = useState(org?.name ?? '')
  const [tipTax, setTipTax] = useState(String(org?.tip_tax_pct ?? 0))
  const [discount, setDiscount] = useState(String(org?.loss_discount_pct ?? 0))

  useEffect(() => {
    if (!org) return
    setName(org.name)
    setTipTax(String(org.tip_tax_pct))
    setDiscount(String(org.loss_discount_pct))
  }, [org])

  if (!org) return <Loading />
  const t = Number(tipTax || 0)
  const d = Number(discount || 0)
  const ok = (n: number) => Number.isFinite(n) && n >= 0 && n <= 100
  const dirty = name.trim() !== org.name || t !== org.tip_tax_pct || d !== org.loss_discount_pct

  return (
    <Card className="p-4">
      <div className="space-y-4">
        <Field label="Organization name">
          {isAdmin ? <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /> : <div className="font-display text-2xl">{org.name}</div>}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tip tax">
            {isAdmin ? <PercentInput value={tipTax} onChange={setTipTax} /> : <div className="font-display text-3xl">{org.tip_tax_pct}%</div>}
          </Field>
          <Field label="Loss discount">
            {isAdmin ? <PercentInput value={discount} onChange={setDiscount} /> : <div className="font-display text-3xl">{org.loss_discount_pct}%</div>}
          </Field>
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-faint">
        <span className="text-muted">Tip tax</span> is the house’s cut of every dealer tip. <span className="text-muted">Loss discount</span> gives a losing
        player that % of their loss back when they cash out. New games start with these; each game can be adjusted while it’s open.
      </p>
      {isAdmin && dirty && (
        <Button
          variant="primary"
          className="mt-4 w-full"
          disabled={!name.trim() || !ok(t) || !ok(d)}
          loading={busy}
          onClick={() => run(() => updateOrganization({ name: name.trim(), tip_tax_pct: t, loss_discount_pct: d }), 'Saved').then(() => refresh())}
        >
          Save changes
        </Button>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- members

function MemberSheet({ member, onClose }: { member: Member; onClose: () => void }) {
  const { user, isAdmin, refresh } = useAuth()
  const { confirm } = useFeedback()
  const { busy, run } = useAction()
  const [role, setRole] = useState<Role>(member.role)
  const isMe = member.user_id === user?.id
  const name = member.display_name || (member.username ? `@${member.username}` : 'Member')

  const done = async (ok: boolean) => {
    if (!ok) return
    await refresh()
    onClose()
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={name}
      subtitle={member.username ? `@${member.username}` : undefined}
      footer={
        isAdmin && role !== member.role ? (
          <Button variant="primary" size="lg" className="w-full" loading={busy} onClick={async () => done(await run(() => updateMember(member.user_id, { role }), 'Role updated'))}>
            Save role
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <div className="text-sm text-muted">Member since {formatStamp(member.created_at)}</div>
        {isAdmin && (
          <Field label="Role" hint="Admins add and manage members, partners, payouts and house rules, and can reopen or delete games.">
            <Segmented value={role} options={ROLES} onChange={setRole} />
          </Field>
        )}
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        {isAdmin && !isMe && (
          <Button
            onClick={async () =>
              done(await run(() => updateMember(member.user_id, { active: !member.active }), member.active ? 'Access paused' : 'Access restored'))
            }
          >
            {member.active ? 'Pause access' : 'Restore access'}
          </Button>
        )}
        {(isAdmin || isMe) && (
          <Button
            variant="danger"
            icon={isMe ? 'logout' : 'trash'}
            onClick={async () => {
              if (
                await confirm({
                  title: isMe ? 'Leave this organization?' : `Remove ${name}?`,
                  message: isMe
                    ? 'You’ll lose access right away. An admin can add you back.'
                    : 'They lose access immediately. Everything they recorded stays in the history.',
                  confirmLabel: isMe ? 'Leave' : 'Remove',
                  danger: true,
                })
              )
                await done(await run(() => removeMember(member.user_id), isMe ? 'You left the organization' : 'Member removed'))
            }}
          >
            {isMe ? 'Leave organization' : 'Remove'}
          </Button>
        )}
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------- add a member

function AddMemberSheet({ onClose }: { onClose: () => void }) {
  const { refresh, org } = useAuth()
  const { busy, run } = useAction()
  const [login, setLogin] = useState('')
  const [role, setRole] = useState<Role>('organizer')
  const valid = USERNAME_RE.test(cleanUsername(login))

  return (
    <Sheet
      open
      onClose={onClose}
      title="Add a member"
      subtitle={`They need an account first — the app owner creates those. Then they’ll see ${org?.name ?? 'this organization'} when they sign in.`}
      footer={
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          disabled={!valid}
          loading={busy}
          onClick={() => run(() => addMember(cleanUsername(login), role), 'Member added').then((ok) => ok && (void refresh(), onClose()))}
        >
          Add member
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="Their username">
          <TextInput value={login} onChange={(e) => setLogin(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="e.g. jordan" autoFocus />
        </Field>
        <Field label="Role">
          <Segmented value={role} options={ROLES} onChange={setRole} />
        </Field>
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------- page

export function OrganizationPage() {
  const { user, org, orgs, members, isAdmin, isOwner, switchOrg } = useAuth()
  const [openMember, setOpenMember] = useState<Member | null>(null)
  const [adding, setAdding] = useState(false)

  return (
    <>
      <PageHeader title="Organization" sub={org?.name} />

      {isOwner && (
        <Link
          to="/admin"
          className="mt-5 flex items-center gap-3 rounded-[12px] border border-brass/30 bg-brass/[0.06] px-4 py-3 text-sm text-brass hover:bg-brass/[0.1]"
        >
          <Icon name="shield" className="size-4" />
          <span className="flex-1">Create accounts and organizations in Admin</span>
          <Icon name="next" className="size-4" />
        </Link>
      )}

      <SectionTitle>Settings</SectionTitle>
      <OrgSettingsCard />

      <SectionTitle
        action={
          isAdmin && (
            <Button size="sm" icon="plus" onClick={() => setAdding(true)}>
              Add
            </Button>
          )
        }
      >
        Members · {members.length}
      </SectionTitle>
      <Card className="divide-y divide-line overflow-hidden">
        {members.map((m) => (
          <button
            key={m.user_id}
            type="button"
            onClick={() => setOpenMember(m)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/60"
          >
            <Avatar name={m.display_name || m.username || '?'} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">
                {m.display_name || `@${m.username}`}
                {m.user_id === user?.id && <span className="font-normal text-faint"> · you</span>}
              </span>
              <span className="block truncate text-[13px] text-muted">{m.username ? `@${m.username}` : ''}</span>
            </span>
            {!m.active && <Badge tone="warn">Paused</Badge>}
            <Badge tone={m.role === 'admin' ? 'brass' : 'neutral'}>{m.role === 'admin' ? 'Admin' : 'Organizer'}</Badge>
          </button>
        ))}
      </Card>
      <p className="mt-2 px-1 text-[13px] text-faint">
        Only members can see this organization’s games, players, partners and history.
        {!isAdmin && ' Admins manage who’s in.'}
      </p>

      {orgs.filter((o) => o.active).length > 1 && (
        <>
          <SectionTitle>Your organizations</SectionTitle>
          <Card className="divide-y divide-line overflow-hidden">
            {orgs
              .filter((o) => o.active)
              .map((o) => (
                <button
                  key={o.id}
                  type="button"
                  disabled={o.id === org?.id}
                  onClick={() => switchOrg(o.id)}
                  className={cx('flex w-full items-center gap-3 px-4 py-3 text-left', o.id !== org?.id && 'hover:bg-surface-2/60')}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{o.name}</span>
                    <span className="text-xs text-muted">{o.role === 'admin' ? 'Admin' : 'Organizer'}</span>
                  </span>
                  {o.id === org?.id ? <Badge tone="live">Current</Badge> : <Icon name="next" className="size-4 text-faint" />}
                </button>
              ))}
          </Card>
        </>
      )}

      {openMember && <MemberSheet member={openMember} onClose={() => setOpenMember(null)} />}
      {adding && <AddMemberSheet onClose={() => setAdding(false)} />}
    </>
  )
}
