import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useAuth } from '../auth'
import { Icon } from '../components/Icon'
import { Logo } from '../components/Layout'
import { Button, Card, Field, Spinner, TextInput } from '../components/ui'
import { googleEnabled, signInWithGoogle, signInWithPassword } from '../lib/authActions'
import { SAMPLE_BASE } from '../lib/mode'

function Shell({ children, compact }: { children: ReactNode; compact?: boolean }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        {compact ? (
          <div className="mb-5 flex items-center justify-center gap-2.5">
            <Logo className="size-9" />
            <span className="font-display text-[26px] leading-none">Poker Ledger</span>
          </div>
        ) : (
          <section className="table-felt px-6 pb-7 pt-7 text-center text-felt-ink">
            <img
              src="/brand/logo.webp"
              alt="Poker Ledger"
              width={640}
              height={545}
              className="mx-auto h-auto w-[13.5rem] drop-shadow-[0_14px_28px_rgba(0,0,0,0.55)]"
              draggable={false}
            />
            <h1 className="font-display mx-auto mt-5 max-w-[16rem] text-[30px] leading-[1.05] text-ink">The cage, in your pocket.</h1>
            <p className="mx-auto mt-2 max-w-[17rem] text-sm opacity-75">
              Buy-ins, cash-outs, rake and partner splits for the people who run the game.
            </p>
          </section>
        )}
        {children}
      </div>
    </div>
  )
}

function SampleLink() {
  return (
    <a href={SAMPLE_BASE} className="mt-5 flex items-center justify-center gap-1.5 text-sm text-brass transition-colors hover:text-ink">
      Explore the sample with fake data <Icon name="next" className="size-4" />
    </a>
  )
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' }) {
  return (
    <div
      className={
        tone === 'error'
          ? 'rounded-[12px] border border-loss/30 bg-loss/[0.07] px-3.5 py-2.5 text-sm text-loss'
          : 'rounded-[12px] border border-brass/30 bg-brass/[0.07] px-3.5 py-2.5 text-sm text-brass'
      }
    >
      {children}
    </div>
  )
}

export function LoginPage() {
  const { notice } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = email.trim().length > 0 && password.length > 0

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      await signInWithPassword(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <Shell>
      <Card className="mt-6 p-5">
        <h2 className="font-display text-[26px] leading-tight">Sign in</h2>
        <form className="mt-4 space-y-3.5" onSubmit={submit}>
          {notice && <Notice tone="error">{notice}</Notice>}
          {error && <Notice tone="error">{error}</Notice>}
          <Field label="Username">
            <TextInput
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
            />
          </Field>
          <Field label="Password">
            <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </Field>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!valid}>
            Sign in
          </Button>
        </form>
        <p className="mt-3 text-center text-sm text-muted">Need an account or a new password? Ask the person who runs the app.</p>

        {googleEnabled && (
          <>
            <div className="my-4 flex items-center gap-3 text-xs text-faint">
              <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
            </div>
            <Button size="lg" className="w-full font-medium" onClick={() => signInWithGoogle().catch((e) => setError(e instanceof Error ? e.message : String(e)))}>
              <GoogleMark /> Continue with Google
            </Button>
          </>
        )}
      </Card>
      <SampleLink />
    </Shell>
  )
}

/** Signed in, but not in any organization (and not the owner). */
export function OnboardingPage() {
  const { user, username, approved, orgs, refresh, signOut } = useAuth()
  const paused = orgs.filter((o) => !o.active)
  return (
    <Shell compact>
      <Card className="space-y-3 p-5">
        <h1 className="font-display text-[30px] leading-[1.05]">{approved ? 'Almost there' : 'Waiting for approval'}</h1>
        <p className="text-sm text-muted">
          Signed in as <span className="text-ink">{username ?? user?.email}</span>.{' '}
          {approved
            ? 'Your account is ready, but you haven’t been added to an organization yet. Ask the app owner or your organization’s admin to add you.'
            : 'The app owner needs to approve this account before it can be added to an organization.'}
        </p>
        {paused.length > 0 && (
          <Notice tone="error">Your access to {paused.map((o) => o.name).join(', ')} is paused. Ask an admin there to restore it.</Notice>
        )}
        <div className="flex gap-3 pt-1">
          <Button className="flex-1" onClick={() => void refresh()}>
            Check again
          </Button>
          <Button className="flex-1" icon="logout" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </Card>
    </Shell>
  )
}

export function ErrorPage({ error }: { error: string }) {
  const { signOut } = useAuth()
  return (
    <Shell compact>
      <Card className="space-y-4 p-5 text-center">
        <p className="font-medium text-loss">Couldn’t reach the database</p>
        <p className="text-sm text-muted">{error}</p>
        <div className="flex gap-3">
          <Button className="flex-1" onClick={() => window.location.reload()}>
            Retry
          </Button>
          <Button className="flex-1" icon="logout" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </Card>
    </Shell>
  )
}

export function SetupPage() {
  return (
    <Shell>
      <Card className="mt-6 space-y-2.5 p-5 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <Icon name="lock" className="size-4 text-warn" /> Connect Supabase to go live
        </p>
        <p className="text-muted">
          Set <code className="text-ink">VITE_SUPABASE_URL</code> and <code className="text-ink">VITE_SUPABASE_ANON_KEY</code> (in{' '}
          <code className="text-ink">.env.local</code>, or your host’s environment variables) and rebuild. SETUP.md walks through it.
        </p>
      </Card>
      <a
        href={SAMPLE_BASE}
        className="mt-3 flex h-12 items-center justify-center gap-2 rounded-[10px] bg-brass font-semibold text-brass-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] transition-colors hover:bg-[#e2bd76]"
      >
        Explore the sample <Icon name="next" className="size-4" />
      </a>
    </Shell>
  )
}

export function BootLoading() {
  return (
    <div className="flex min-h-dvh items-center justify-center gap-3 text-muted">
      <Spinner /> Loading…
    </div>
  )
}
