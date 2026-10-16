// Account actions (Supabase Auth). Accounts are created by the app owner;
// people only sign in, with a username. Google is optional (VITE_AUTH_GOOGLE=true).
import { loginEmail } from './username'
import { supabase } from './supabase'

export const googleEnabled = import.meta.env.VITE_AUTH_GOOGLE === 'true'

function fail(error: { message: string } | null) {
  if (!error) return
  const m = error.message
  if (/invalid login credentials/i.test(m)) throw new Error('Wrong username or password.')
  if (/email not confirmed/i.test(m)) throw new Error('This account isn’t switched on yet. Ask the app owner.')
  if (/rate limit|too many/i.test(m)) throw new Error('Too many attempts. Wait a minute and try again.')
  throw new Error(m)
}

/**
 * Sign in with a username (or, for older accounts, an email). Usernames sign
 * in through a hidden address, <username>@poker-ledger.invalid.
 */
export async function signInWithPassword(login: string, password: string) {
  const l = login.trim().replace(/^@/, '')
  const { error } = await supabase.auth.signInWithPassword({ email: l.includes('@') ? l.toLowerCase() : loginEmail(l), password })
  fail(error)
}

export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
  fail(error)
}
