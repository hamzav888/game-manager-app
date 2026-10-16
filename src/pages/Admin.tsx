import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from '../auth'
import { ActivityList } from '../components/ActivityList'
import { Icon } from '../components/Icon'
import { Logo } from '../components/Layout'
import {
  Avatar,
  Badge,
  Button,
  Card,
  Empty,
  ErrorBox,
  Field,
  Loading,
  PageHeader,
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
  adminAddMember,
  adminCreateAccount,
  adminListAccounts,
  adminListOrganizations,
  adminNames,
  adminOrgMembers,
  adminRemoveMember,
  adminRenameOrganization,
  adminSetApproved,
  adminSetPassword,
  adminSetUsername,
  adminUpdateMember,
  createOrganization,
} from '../lib/api'
import { formatStamp, timeAgo } from '../lib/format'
import { useLoader, useRealtime } from '../lib/hooks'
import { isSample } from '../lib/mode'
import type { AdminAccount, AdminOrg, AuditFilter, Member, Role } from '../lib/types'
import { USERNAME_RE, USERNAME_RULE, cleanUsername, loginName } from '../lib/username'

const ROLES: { value: Role; label: string }[] = [
  { value: 'organizer', label: 'Organizer' },
  { value: 'admin', label: 'Admin' },
]

/** 8 easy-to-read characters (no 0/O, 1/l/I). */
function generatePassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint32Array(8))
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

/** "Big Rob" → "bigrob" */
const suggestUsername = (name: string) => name.toLowerCase().replace(/[^a-z0-9._-]/g, '').replace(/^[._-]+/, '').slice(0, 32)

/** How an account is shown: name, or @username. */
const accountName = (a: { display_name: string | null; username: string | null; email: string | null }) =>
  a.display_name || (a.username ? `@${a.username}` : (a.email ?? 'Account'))
const handle = (a: { username: string | null; email: string | null }) => (a.username ? `@${a.username}` : (loginName(a.email) ?? ''))

function PasswordField({ value, onChange, label = 'Password' }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <Field label={label} hint="Any length you like. They can change it later from their account menu.">
      <div className="flex gap-2">
        <TextInput value={value} onChange={(e) => onChange(e.target.value)} autoComplete="new-password" className="font-mono" />
        <Button onClick={() => onChange(generatePassword())}>Generate</Button>
      </div>
    </Field>
  )
}

const loginText = (username: string, password: string) =>
  `Your Poker Ledger login\n${window.location.origin}\nUsername: ${username}\nPassword: ${password}\n(You can change the password after signing in: tap your avatar → Change password.)`

function CredentialsSheet({ username, password, title, onClose }: { username: string; password: string; title: string; onClose: () => void }) {
  const { toast } = useFeedback()
  const text = loginText(username, password)
  return (
    <Sheet open onClose={onClose} title={title} subtitle="Send these to them however you like — text, WhatsApp, in person.">
      <pre className="whitespace-pre-wrap rounded-[12px] border border-line bg-bg p-3 font-mono text-[12.5px] leading-relaxed">{text}</pre>
      <div className="mt-4 flex gap-3">
        <Button
          variant="primary"
          icon="copy"
          className="flex-1"
          onClick={() =>
            navigator.clipboard
              .writeText(text)
              .then(() => toast('Copied'))
              .catch(() => toast('Couldn’t copy — select the text instead', 'error'))
          }
        >
          Copy
        </Button>
        {'share' in navigator && (
          <Button className="flex-1" onClick={() => navigator.share({ title: 'Poker Ledger login', text }).catch(() => undefined)}>
            Share…
          </Button>
        )}
      </div>
      <p className="mt-4 text-xs text-faint">This is the only time the password is shown. If it gets lost, set a new one from their account.</p>
    </Sheet>
  )
}

// ---------------------------------------------------------------- accounts

function CreateAccountSheet({
  orgs,
  onClose,
  onCreated,
}: {
  orgs: AdminOrg[]
  onClose: () => void
  onCreated: (username: string, password: string) => void
}) {
  const { refresh } = useAuth()
  const { busy, run } = useAction()
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [touched, setTouched] = useState(false)
  const [password, setPassword] = useState(generatePassword)
  const [org, setOrg] = useState('')
  const [role, setRole] = useState<Role>('organizer')
  const login = cleanUsername(touched ? username : suggestUsername(name))
  const valid = name.trim() && USERNAME_RE.test(login) && password.length > 0

  const submit = async () => {
    const ok = await run(async () => {
      await adminCreateAccount({ name, username: login, password })
      if (org) await adminAddMember(org, login, role)
    }, 'Account created')
    if (ok) {
      void refresh()
      onCreated(login, password)
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Create an account"
      footer={
        <Button variant="primary" size="lg" className="w-full" disabled={!valid} loading={busy} onClick={submit}>
          Create account
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus placeholder="e.g. Jordan" />
        </Field>
        <Field label="Username (their login)" hint={login && !USERNAME_RE.test(login) ? USERNAME_RULE : 'Only you can create accounts. They sign in with this and the password.'}>
          <TextInput
            value={touched ? username : login}
            onChange={(e) => {
              setTouched(true)
              setUsername(e.target.value)
            }}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="e.g. jordan"
          />
        </Field>
        <PasswordField value={password} onChange={setPassword} />
        <Field label="Add to an organization (optional)">
          <select className={cx(inputCls, 'h-11')} value={org} onChange={(e) => setOrg(e.target.value)}>
            <option value="">Not yet</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
        {org && (
          <Field label="Role there">
            <Segmented value={role} options={ROLES} onChange={setRole} />
          </Field>
        )}
      </div>
    </Sheet>
  )
}

function AccountSheet({ account, onClose, onChanged }: { account: AdminAccount; onClose: () => void; onChanged: () => void }) {
  const { confirm } = useFeedback()
  const { busy, run } = useAction()
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState(account.username ?? '')
  const [shown, setShown] = useState<string | null>(null)
  const name = accountName(account)
  const newLogin = cleanUsername(username)

  if (shown) return <CredentialsSheet title="New password set" username={account.username ?? account.email ?? ''} password={shown} onClose={onClose} />

  return (
    <Sheet open onClose={onClose} title={name} subtitle={handle(account)}>
      <div className="flex flex-wrap gap-2">
        {account.is_owner && <Badge tone="brass">App owner</Badge>}
        {account.approved ? <Badge tone="live">Approved</Badge> : <Badge tone="warn">Waiting for approval</Badge>}
      </div>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted">Organizations</dt>
        <dd>{account.organizations || <span className="text-faint">None yet</span>}</dd>
        <dt className="text-muted">Created</dt>
        <dd>{formatStamp(account.created_at)}</dd>
        <dt className="text-muted">Last signed in</dt>
        <dd>{account.last_sign_in_at ? formatStamp(account.last_sign_in_at) : <span className="text-faint">Never</span>}</dd>
      </dl>

      {!account.approved && (
        <Button
          variant="primary"
          className="mt-5 w-full"
          loading={busy}
          onClick={() => run(() => adminSetApproved(account.id, true), 'Account approved').then((ok) => ok && (onChanged(), onClose()))}
        >
          Approve this account
        </Button>
      )}

      <SectionTitle>Username</SectionTitle>
      <Field label="Their login" hint={newLogin && !USERNAME_RE.test(newLogin) ? USERNAME_RULE : 'They sign in with this. Changing it changes their login.'}>
        <div className="flex gap-2">
          <TextInput value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          {newLogin !== (account.username ?? '') && (
            <Button
              variant="primary"
              disabled={!USERNAME_RE.test(newLogin)}
              loading={busy}
              onClick={() => run(() => adminSetUsername(account.id, newLogin), 'Username changed').then((ok) => ok && onChanged())}
            >
              Save
            </Button>
          )}
        </div>
      </Field>

      <SectionTitle>Set a new password</SectionTitle>
      <PasswordField value={password} onChange={setPassword} label="New password" />
      <Button
        className="mt-3 w-full"
        disabled={password.length === 0}
        loading={busy}
        onClick={() => run(() => adminSetPassword(account.id, password), 'Password updated').then((ok) => ok && setShown(password))}
      >
        Save new password
      </Button>

      {account.approved && !account.is_owner && (
        <button
          type="button"
          className="mt-6 flex items-center gap-1.5 text-sm text-loss/90 hover:text-loss"
          onClick={async () => {
            if (
              await confirm({
                title: `Block ${name}?`,
                message: 'They lose access to every organization right away. Their history stays. You can approve them again later.',
                confirmLabel: 'Block account',
                danger: true,
              })
            )
              await run(() => adminSetApproved(account.id, false), 'Account blocked').then((ok) => ok && (onChanged(), onClose()))
          }}
        >
          <Icon name="lock" className="size-4" /> Block this account
        </button>
      )}

      <SectionTitle>Everything they’ve done</SectionTitle>
      <AdminHistory filter={{ everywhere: true, actorId: account.id }} />
    </Sheet>
  )
}

/** Owner only: the history across every organization, with names. */
function AdminHistory({ filter }: { filter: Omit<AuditFilter, 'beforeId' | 'limit'> }) {
  const book = useLoader(adminNames, [])
  if (book.error) return <ErrorBox error={book.error} onRetry={book.reload} />
  if (!book.data) return <Loading />
  return <ActivityList filter={filter} playersById={new Map()} book={book.data} live />
}

function HistoryTab({ accounts, orgs }: { accounts: AdminAccount[]; orgs: AdminOrg[] }) {
  const [who, setWho] = useState('')
  const [where, setWhere] = useState('')
  const filter: Omit<AuditFilter, 'beforeId' | 'limit'> = {
    ...(who && { actorId: who }),
    ...(where === 'accounts' ? { accountsOnly: true } : where ? { inOrg: where } : { everywhere: true }),
  }
  return (
    <>
      <p className="mt-5 text-sm text-muted">
        Every action by every account, to the second: games, money, members, accounts created or changed, passwords set (never the passwords
        themselves) and sign-ins. Only you can see this, and nobody — including you — can edit or delete it.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <select className={cx(inputCls, 'h-10 text-base sm:text-sm')} value={who} onChange={(e) => setWho(e.target.value)} aria-label="Done by">
          <option value="">Every account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {accountName(a)} {a.username && a.display_name ? `(@${a.username})` : ''}
            </option>
          ))}
        </select>
        <select className={cx(inputCls, 'h-10 text-base sm:text-sm')} value={where} onChange={(e) => setWhere(e.target.value)} aria-label="Where">
          <option value="">Everywhere</option>
          <option value="accounts">Accounts &amp; sign-ins</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-5">
        <AdminHistory filter={filter} />
      </div>
    </>
  )
}

// ---------------------------------------------------------------- organizations

function NewOrgSheet({ accounts, onClose, onCreated }: { accounts: AdminAccount[]; onClose: () => void; onCreated: () => void }) {
  const { user, refresh } = useAuth()
  const { busy, run } = useAction()
  const [name, setName] = useState('')
  const [admin, setAdmin] = useState(user?.id ?? '')
  const approved = accounts.filter((a) => a.approved)

  return (
    <Sheet
      open
      onClose={onClose}
      title="New organization"
      subtitle="One poker operation: its own games, players, partners and team."
      footer={
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          disabled={!name.trim() || !admin}
          loading={busy}
          onClick={() =>
            run(() => createOrganization(name, admin), 'Organization created').then((ok) => {
              if (!ok) return
              void refresh()
              onCreated()
            })
          }
        >
          Create organization
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus placeholder="e.g. Riverside Card Club" />
        </Field>
        <Field label="Who runs it?" hint="They become its first admin and can add the rest of their team. Create their account first if needed.">
          <select className={cx(inputCls, 'h-11')} value={admin} onChange={(e) => setAdmin(e.target.value)}>
            {approved.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id === user?.id ? `Me (${handle(a)})` : `${accountName(a)} — ${handle(a)}`}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Sheet>
  )
}

function OrgSheet({ org, accounts, onClose, onChanged }: { org: AdminOrg; accounts: AdminAccount[]; onClose: () => void; onChanged: () => void }) {
  const { user, orgs, switchOrg, refresh } = useAuth()
  const { confirm } = useFeedback()
  const { busy, run } = useAction()
  const members = useLoader(() => adminOrgMembers(org.id), [org.id])
  const [name, setName] = useState(org.name)
  const [adding, setAdding] = useState('')
  const [role, setRole] = useState<Role>('organizer')
  const memberIds = new Set((members.data ?? []).map((m) => m.user_id))
  const candidates = accounts.filter((a) => a.approved && !memberIds.has(a.id))
  const isMine = orgs.some((o) => o.id === org.id && o.active)

  const changed = () => {
    void members.reload()
    void refresh()
    onChanged()
  }

  const memberAction = async (m: Member, action: 'role' | 'pause' | 'remove') => {
    const who = m.display_name || (m.username ? `@${m.username}` : 'this member')
    if (action === 'remove' && !(await confirm({ title: `Remove ${who}?`, message: 'They lose access to this organization. Their history stays.', confirmLabel: 'Remove', danger: true })))
      return
    await run(
      () =>
        action === 'role'
          ? adminUpdateMember(org.id, m.user_id, { role: m.role === 'admin' ? 'organizer' : 'admin' })
          : action === 'pause'
            ? adminUpdateMember(org.id, m.user_id, { active: !m.active })
            : adminRemoveMember(org.id, m.user_id),
      'Saved',
    ).then((ok) => ok && changed())
  }

  return (
    <Sheet open onClose={onClose} title={org.name} subtitle={`Created ${formatStamp(org.created_at)}`}>
      <Field label="Name">
        <div className="flex gap-2">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          {name.trim() !== org.name && (
            <Button variant="primary" loading={busy} onClick={() => run(() => adminRenameOrganization(org.id, name), 'Renamed').then((ok) => ok && changed())}>
              Save
            </Button>
          )}
        </div>
      </Field>

      <SectionTitle>People</SectionTitle>
      {members.error ? (
        <ErrorBox error={members.error} onRetry={members.reload} />
      ) : !members.data ? (
        <Loading />
      ) : (
        <div className="divide-y divide-line rounded-[12px] border border-line">
          {members.data.map((m) => (
            <div key={m.user_id} className="flex items-center gap-3 px-3 py-2.5">
              <Avatar name={m.display_name || m.username || '?'} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {m.display_name || `@${m.username}`}
                  {m.user_id === user?.id && <span className="font-normal text-faint"> · you</span>}
                </span>
                <span className="block truncate text-xs text-muted">{handle(m)}</span>
              </span>
              <button
                type="button"
                onClick={() => void memberAction(m, 'role')}
                className="shrink-0"
                title="Switch role"
              >
                <Badge tone={m.role === 'admin' ? 'brass' : 'neutral'}>{m.role === 'admin' ? 'Admin' : 'Organizer'}</Badge>
              </button>
              <button type="button" onClick={() => void memberAction(m, 'pause')} className="shrink-0 text-xs text-muted underline-offset-2 hover:underline">
                {m.active ? 'Pause' : 'Resume'}
              </button>
              <button type="button" aria-label={`Remove ${m.display_name || m.username}`} onClick={() => void memberAction(m, 'remove')} className="shrink-0 text-faint hover:text-loss">
                <Icon name="x" className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-faint">Tap a role to switch it. Paused people keep their history but can’t open this organization.</p>

      <SectionTitle>Add someone</SectionTitle>
      {candidates.length === 0 ? (
        <p className="text-sm text-muted">Everyone with an approved account is already here. Create a new account first.</p>
      ) : (
        <div className="space-y-3">
          <select className={cx(inputCls, 'h-11')} value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">Choose an account…</option>
            {candidates.map((a) => (
              <option key={a.id} value={a.username ?? a.email ?? ''}>
                {accountName(a)} — {handle(a)}
              </option>
            ))}
          </select>
          <Segmented value={role} options={ROLES} onChange={setRole} />
          <Button
            variant="primary"
            className="w-full"
            disabled={!adding}
            loading={busy}
            onClick={() =>
              run(() => adminAddMember(org.id, adding, role), 'Added').then((ok) => {
                if (!ok) return
                setAdding('')
                changed()
              })
            }
          >
            Add to {org.name}
          </Button>
        </div>
      )}

      {isMine && !isSample && (
        <Button className="mt-6 w-full" icon="next" onClick={() => (onClose(), switchOrg(org.id))}>
          Open this organization
        </Button>
      )}
    </Sheet>
  )
}

// ---------------------------------------------------------------- page

export function AdminPage() {
  const { user, orgs } = useAuth()
  const [tab, setTab] = useState<'orgs' | 'accounts' | 'history'>('orgs')
  const accounts = useLoader(adminListAccounts, [])
  const orgList = useLoader(adminListOrganizations, [])
  const reload = () => {
    void accounts.reload()
    void orgList.reload()
  }
  useRealtime(['memberships', 'organizations'], reload)

  const [creatingAccount, setCreatingAccount] = useState(false)
  const [creatingOrg, setCreatingOrg] = useState(false)
  const [credentials, setCredentials] = useState<{ username: string; password: string } | null>(null)
  const [openAccount, setOpenAccount] = useState<AdminAccount | null>(null)
  const [openOrg, setOpenOrg] = useState<AdminOrg | null>(null)

  const pending = useMemo(() => (accounts.data ?? []).filter((a) => !a.approved), [accounts.data])
  const approved = useMemo(() => (accounts.data ?? []).filter((a) => a.approved), [accounts.data])

  return (
    <>
      <PageHeader title="Admin" sub="Every account, organization and action. Only you see this." />

      {orgs.filter((o) => o.active).length === 0 && (
        <div className="mt-5 rounded-[12px] border border-brass/30 bg-brass/[0.07] px-4 py-3 text-sm text-brass">
          You’re not running any organization yourself yet. Create one with you as its admin to start recording games.
        </div>
      )}

      <div className="mt-5">
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            { value: 'orgs', label: `Organizations${orgList.data ? ` · ${orgList.data.length}` : ''}` },
            { value: 'accounts', label: `Accounts${accounts.data ? ` · ${accounts.data.length}` : ''}` },
            { value: 'history', label: 'History' },
          ]}
        />
      </div>

      {tab === 'orgs' && (
        <>
          <Button variant="primary" size="lg" icon="plus" className="mt-5 w-full" onClick={() => setCreatingOrg(true)} disabled={!accounts.data}>
            New organization
          </Button>
          <div className="mt-4">
            {orgList.error ? (
              <ErrorBox error={orgList.error} onRetry={orgList.reload} />
            ) : !orgList.data ? (
              <Loading />
            ) : orgList.data.length === 0 ? (
              <Card>
                <Empty icon="briefcase" title="No organizations yet">
                  Create one for each poker operation, and choose who runs it.
                </Empty>
              </Card>
            ) : (
              <Card className="divide-y divide-line overflow-hidden">
                {orgList.data.map((o) => (
                  <button key={o.id} type="button" onClick={() => setOpenOrg(o)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-2/60">
                    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-bg text-brass">
                      <Icon name="briefcase" className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{o.name}</span>
                      <span className="block truncate text-[13px] text-muted">
                        {o.members} {o.members === 1 ? 'person' : 'people'}
                        {o.admins && ` · run by ${o.admins}`}
                      </span>
                    </span>
                    {orgs.some((m) => m.id === o.id) && <Badge>You’re in it</Badge>}
                    <Icon name="next" className="size-4 text-faint" />
                  </button>
                ))}
              </Card>
            )}
          </div>
        </>
      )}

      {tab === 'accounts' && (
        <>
          <Button variant="primary" size="lg" icon="plus" className="mt-5 w-full" onClick={() => setCreatingAccount(true)} disabled={!orgList.data}>
            Create an account
          </Button>
          {accounts.error ? (
            <div className="mt-4">
              <ErrorBox error={accounts.error} onRetry={accounts.reload} />
            </div>
          ) : !accounts.data ? (
            <Loading />
          ) : (
            <>
              {pending.length > 0 && (
                <>
                  <SectionTitle>Waiting for approval · {pending.length}</SectionTitle>
                  <AccountList accounts={pending} onOpen={setOpenAccount} me={user?.id} />
                  <p className="mt-2 px-1 text-xs text-faint">
                    Accounts you didn’t create wait here. They can’t see anything until you approve them.
                  </p>
                </>
              )}
              <SectionTitle>Accounts · {approved.length}</SectionTitle>
              <AccountList accounts={approved} onOpen={setOpenAccount} me={user?.id} />
            </>
          )}
        </>
      )}

      {tab === 'history' && (accounts.data && orgList.data ? <HistoryTab accounts={accounts.data} orgs={orgList.data} /> : <Loading />)}

      {creatingOrg && accounts.data && <NewOrgSheet accounts={accounts.data} onClose={() => setCreatingOrg(false)} onCreated={() => (setCreatingOrg(false), reload())} />}
      {creatingAccount && (
        <CreateAccountSheet
          orgs={orgList.data ?? []}
          onClose={() => setCreatingAccount(false)}
          onCreated={(username, password) => {
            setCreatingAccount(false)
            setCredentials({ username, password })
            reload()
          }}
        />
      )}
      {credentials && <CredentialsSheet title="Account created" {...credentials} onClose={() => setCredentials(null)} />}
      {openAccount && <AccountSheet account={openAccount} onClose={() => setOpenAccount(null)} onChanged={reload} />}
      {openOrg && accounts.data && <OrgSheet org={openOrg} accounts={accounts.data} onClose={() => setOpenOrg(null)} onChanged={reload} />}
    </>
  )
}

function AccountList({ accounts, onOpen, me }: { accounts: AdminAccount[]; onOpen: (a: AdminAccount) => void; me?: string }) {
  return (
    <Card className="divide-y divide-line overflow-hidden">
      {accounts.map((a) => (
        <button key={a.id} type="button" onClick={() => onOpen(a)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/60">
          <Avatar name={a.display_name || a.username || '?'} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">
              {accountName(a)}
              {a.id === me && <span className="font-normal text-faint"> · you</span>}
            </span>
            <span className="block truncate text-[13px] text-muted">
              {handle(a)}
              {a.organizations && ` · ${a.organizations}`}
            </span>
          </span>
          <span className="shrink-0 text-right text-[11px] text-faint">
            {a.is_owner ? <Badge tone="brass">Owner</Badge> : a.last_sign_in_at ? timeAgo(a.last_sign_in_at) : 'never signed in'}
          </span>
        </button>
      ))}
    </Card>
  )
}

/** The owner's view when they aren't in any organization yet. */
export function AdminStandalone({ children }: { children?: ReactNode }) {
  const { signOut, user, username } = useAuth()
  return (
    <div className="min-h-dvh">
      <header className="pt-safe sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          <Logo />
          <span className="font-display text-[22px] leading-none">Poker Ledger</span>
          <span className="ml-auto truncate text-xs text-muted">{username ? `@${username}` : user?.email}</span>
          <Button size="sm" icon="logout" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-6">{children ?? <AdminPage />}</main>
    </div>
  )
}
