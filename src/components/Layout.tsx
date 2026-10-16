import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth'
import { changeMyPassword, updateMyProfile } from '../lib/api'
import { resetSample } from '../lib/api/sample'
import { isSample } from '../lib/mode'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import { Avatar, Badge, Button, Field, Sheet, TextInput, cx, useAction, useFeedback } from './ui'

const NAV: { to: string; label: string; icon: IconName; ownerOnly?: boolean; also?: string[] }[] = [
  { to: '/', label: 'Games', icon: 'games' },
  { to: '/players', label: 'People', icon: 'users', also: ['/dealers'] },
  { to: '/partners', label: 'Partners', icon: 'briefcase' },
  // The history is for the app owner's eyes only (the database enforces it).
  { to: '/history', label: 'History', icon: 'history', ownerOnly: true },
  { to: '/org', label: 'Org', icon: 'sliders' },
]

/** The brand mark: fanned cards over the ledger (from branding/poker-ledger-logo.png). */
export function Logo({ className = 'size-8' }: { className?: string }) {
  return <img src="/brand/mark.webp" alt="" width={32} height={32} className={cx('object-contain', className)} draggable={false} />
}

function useResetSample() {
  const { confirm, toast } = useFeedback()
  return async () => {
    if (
      await confirm({
        title: 'Reset the sample?',
        message: 'Every change you made in the sample is thrown away and the original demo data comes back.',
        confirmLabel: 'Reset sample',
      })
    ) {
      resetSample()
      toast('Sample data reset')
    }
  }
}

function SampleBanner() {
  const reset = useResetSample()
  return (
    <div className="border-b border-brass/20 bg-[#17140d]">
      <div className="mx-auto flex h-9 max-w-3xl items-center gap-2.5 px-4 text-xs">
        <span className="font-display text-[15px] italic text-brass">Sample</span>
        <span className="truncate text-muted">Fake data · changes stay in this tab</span>
        <button className="ml-auto shrink-0 text-muted underline-offset-2 hover:text-ink hover:underline" onClick={reset}>
          Reset
        </button>
        <a href="/" className="shrink-0 font-medium text-brass underline-offset-2 hover:underline">
          Real app →
        </a>
      </div>
    </div>
  )
}

function AccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me, user, username, org, orgs, isOwner, switchOrg, signOut, refresh } = useAuth()
  const reset = useResetSample()
  const navigate = useNavigate()
  const { busy, run } = useAction()
  const [changingPassword, setChangingPassword] = useState(false)
  const [name, setName] = useState(me?.display_name ?? '')
  useEffect(() => setName(me?.display_name ?? ''), [me?.display_name, open])
  const display = me?.display_name || username || user?.email || ''
  const others = orgs.filter((o) => o.active && o.id !== org?.id)

  return (
    <Sheet open={open} onClose={onClose} title="Account">
      <div className="flex items-center gap-3 pb-4">
        <Avatar name={display} size={44} />
        <div className="min-w-0">
          <div className="truncate font-medium">{me?.display_name || 'You'}</div>
          <div className="truncate text-sm text-muted">{username ? `@${username}` : user?.email}</div>
        </div>
        <div className="ml-auto">
          <Badge tone={me?.role === 'admin' ? 'brass' : 'neutral'}>{me?.role === 'admin' ? 'Admin' : 'Organizer'}</Badge>
        </div>
      </div>

      <Field label="Your name" hint="Shown to your team on the entries you record.">
        <div className="flex gap-2">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          {name.trim() !== (me?.display_name ?? '') && user && (
            <Button
              variant="primary"
              loading={busy}
              onClick={() => run(() => updateMyProfile(user.id, { display_name: name.trim() || null }), 'Name saved').then(() => refresh())}
            >
              Save
            </Button>
          )}
        </div>
      </Field>

      <div className="mt-5 rounded-[12px] border border-line">
        <div className="flex items-center gap-3 px-3.5 py-3">
          <Icon name="briefcase" className="size-4 text-brass" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-muted">Organization</span>
            <span className="block truncate font-medium">{org?.name}</span>
          </span>
          <Button
            size="sm"
            onClick={() => {
              onClose()
              navigate('/org')
            }}
          >
            Manage
          </Button>
        </div>
        {others.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => {
              onClose()
              switchOrg(o.id)
            }}
            className="flex w-full items-center gap-3 border-t border-line px-3.5 py-2.5 text-left text-sm hover:bg-surface-2/60"
          >
            <span className="flex-1 truncate">Switch to {o.name}</span>
            <Icon name="next" className="size-4 text-faint" />
          </button>
        ))}
      </div>

      {isOwner && (
        <button
          type="button"
          onClick={() => {
            onClose()
            navigate('/admin')
          }}
          className="mt-3 flex w-full items-center gap-3 rounded-[12px] border border-brass/30 bg-brass/[0.06] px-3.5 py-3 text-left text-sm text-brass hover:bg-brass/[0.1]"
        >
          <Icon name="shield" className="size-4" />
          <span className="flex-1">
            <span className="block font-medium">Admin</span>
            <span className="block text-xs text-brass/70">Create accounts and organizations</span>
          </span>
          <Icon name="next" className="size-4" />
        </button>
      )}

      {isSample ? (
        <div className="mt-5 space-y-3">
          <p className="text-sm text-muted">You’re exploring the sample as an admin. Nothing here touches a real database.</p>
          <Button
            className="w-full"
            onClick={() => {
              onClose()
              void reset()
            }}
          >
            Reset sample data
          </Button>
          <Button className="w-full" variant="primary" onClick={() => void signOut()}>
            Go to the real app
          </Button>
        </div>
      ) : (
        <div className="mt-5 flex gap-3">
          <Button className="flex-1" icon="lock" onClick={() => setChangingPassword(true)}>
            Change password
          </Button>
          <Button className="flex-1" icon="logout" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      )}
      {changingPassword && <ChangePasswordSheet onClose={() => setChangingPassword(false)} />}
    </Sheet>
  )
}

function ChangePasswordSheet({ onClose }: { onClose: () => void }) {
  const { busy, run } = useAction()
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const valid = current.length > 0 && password.length > 0 && password === repeat
  return (
    <Sheet
      open
      onClose={onClose}
      title="Change password"
      footer={
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          disabled={!valid}
          loading={busy}
          onClick={() => run(() => changeMyPassword(current, password), 'Password changed').then((ok) => ok && onClose())}
        >
          Save new password
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="Current password">
          <TextInput type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" autoFocus />
        </Field>
        <Field label="New password" hint="Any length you like.">
          <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Repeat it" hint={repeat && password !== repeat ? 'The two passwords don’t match yet.' : undefined}>
          <TextInput type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" />
        </Field>
      </div>
    </Sheet>
  )
}

export function Layout() {
  const { me, user, username, org, isOwner } = useAuth()
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const name = me?.display_name || username || user?.email || ''
  const nav = NAV.filter((n) => !n.ownerOnly || isOwner)
  const isActive = (n: (typeof NAV)[number], active: boolean) => active || !!n.also?.some((p) => pathname.startsWith(p))

  return (
    <div className="min-h-dvh">
      <header className="pt-safe sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-xl">
        {isSample && <SampleBanner />}
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          <NavLink to="/" className="flex min-w-0 items-center gap-2.5">
            <Logo />
            <span className="min-w-0">
              <span className="font-display block text-[22px] leading-none">Poker Ledger</span>
              {org && <span className="block truncate text-[11px] leading-tight text-muted">{org.name}</span>}
            </span>
          </NavLink>
          <nav className="ml-5 hidden gap-0.5 md:flex">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/'}
                className={({ isActive: a }) =>
                  cx('rounded-lg px-3 py-1.5 text-sm transition-colors', isActive(n, a) ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink')
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <button className="ml-auto shrink-0 rounded-full" onClick={() => setMenuOpen(true)} aria-label="Account">
            <Avatar name={name} size={32} />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-32 pt-6 md:pb-16">
        <Outlet />
      </main>

      <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-[#0f0f0d]/95 backdrop-blur-xl md:hidden">
        <div className={cx('mx-auto grid max-w-3xl', nav.length === 5 ? 'grid-cols-5' : 'grid-cols-4')}>
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive: a }) =>
                cx('relative flex flex-col items-center gap-1 pb-2 pt-2.5 text-[11px] transition-colors', isActive(n, a) ? 'text-ink' : 'text-faint')
              }
            >
              {({ isActive: a }) => (
                <>
                  {isActive(n, a) && <span className="absolute inset-x-5 top-0 h-[2px] rounded-b-full bg-brass" />}
                  <Icon name={n.icon} className={cx('size-[21px]', isActive(n, a) && 'text-brass')} />
                  <span className={isActive(n, a) ? 'font-medium' : ''}>{n.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      <AccountSheet open={menuOpen} onClose={() => setMenuOpen(false)} />
    </div>
  )
}
