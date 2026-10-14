import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { useAuth } from '../auth'
import { updateMyProfile } from '../lib/api'
import { updatePassword } from '../lib/authActions'
import { resetSample } from '../lib/api/sample'
import { isSample } from '../lib/mode'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import { Avatar, Badge, Button, Field, Sheet, TextInput, cx, useAction, useFeedback } from './ui'

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Games', icon: 'games' },
  { to: '/players', label: 'Players', icon: 'users' },
  { to: '/partners', label: 'Partners', icon: 'briefcase' },
  { to: '/history', label: 'History', icon: 'history' },
  { to: '/org', label: 'Org', icon: 'sliders' },
]

/** The brand mark: a brass-edged chip. */
export function Logo({ className = 'size-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <circle cx="20" cy="20" r="19.5" fill="#8e6a2c" />
      <circle cx="20" cy="20" r="18" fill="#d6ae62" />
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={i} x="18" y="2.2" width="4" height="4.6" rx="1" fill="#1a1306" transform={`rotate(${i * 45} 20 20)`} />
      ))}
      <circle cx="20" cy="20" r="11.5" fill="#1a1306" />
      <path d="M20 13.2c-2.1 3.1-5.6 5-5.6 8.2 0 2 1.6 3.3 3.2 3.3 1 0 1.7-.5 2.1-1-.3 1.6-.9 2.8-1.9 3.6h4.4c-1-.8-1.6-2-1.9-3.6.4.5 1.1 1 2.1 1 1.6 0 3.2-1.3 3.2-3.3 0-3.2-3.5-5.1-5.6-8.2z" fill="#d6ae62" />
    </svg>
  )
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
  const { me, user, org, orgs, isOwner, switchOrg, signOut, refresh } = useAuth()
  const reset = useResetSample()
  const navigate = useNavigate()
  const { busy, run } = useAction()
  const [changingPassword, setChangingPassword] = useState(false)
  const [name, setName] = useState(me?.display_name ?? '')
  useEffect(() => setName(me?.display_name ?? ''), [me?.display_name, open])
  const display = me?.display_name || me?.email || user?.email || ''
  const others = orgs.filter((o) => o.active && o.id !== org?.id)

  return (
    <Sheet open={open} onClose={onClose} title="Account">
      <div className="flex items-center gap-3 pb-4">
        <Avatar name={display} size={44} />
        <div className="min-w-0">
          <div className="truncate font-medium">{me?.display_name || 'You'}</div>
          <div className="truncate text-sm text-muted">{user?.email}</div>
        </div>
        <div className="ml-auto">
          <Badge tone={me?.role === 'admin' ? 'brass' : 'neutral'}>{me?.role === 'admin' ? 'Admin' : 'Organizer'}</Badge>
        </div>
      </div>

      <Field label="Your name" hint="Shown to your team in the history and ledgers.">
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
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const valid = password.length >= 8 && password === repeat
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
          onClick={() => run(() => updatePassword(password), 'Password changed').then((ok) => ok && onClose())}
        >
          Save new password
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="New password" hint="At least 8 characters.">
          <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus />
        </Field>
        <Field label="Repeat it" hint={repeat && password !== repeat ? 'The two passwords don’t match yet.' : undefined}>
          <TextInput type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" />
        </Field>
      </div>
    </Sheet>
  )
}

export function Layout() {
  const { me, user, org } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const name = me?.display_name || me?.email || user?.email || ''

  return (
    <div className="min-h-dvh">
      {isSample && <SampleBanner />}
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          <NavLink to="/" className="flex min-w-0 items-center gap-2.5">
            <Logo />
            <span className="min-w-0">
              <span className="font-display block text-[22px] leading-none">Poker Ledger</span>
              {org && <span className="block truncate text-[11px] leading-tight text-muted">{org.name}</span>}
            </span>
          </NavLink>
          <nav className="ml-5 hidden gap-0.5 md:flex">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/'}
                className={({ isActive }) =>
                  cx('rounded-lg px-3 py-1.5 text-sm transition-colors', isActive ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink')
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
        <div className="mx-auto grid max-w-3xl grid-cols-5">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                cx('relative flex flex-col items-center gap-1 pb-2 pt-2.5 text-[11px] transition-colors', isActive ? 'text-ink' : 'text-faint')
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute inset-x-5 top-0 h-[2px] rounded-b-full bg-brass" />}
                  <Icon name={n.icon} className={cx('size-[21px]', isActive && 'text-brass')} />
                  <span className={isActive ? 'font-medium' : ''}>{n.label}</span>
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
