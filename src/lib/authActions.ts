// Account actions (Supabase Auth). Accounts are created by the app owner;
// people only sign in. Google is optional (VITE_AUTH_GOOGLE=true).
import { supabase } from './supabase'

export const googleEnabled = import.meta.env.VITE_AUTH_GOOGLE === 'true'

function fail(error: { message: string } | null) {
  if (!error) return
  const m = error.message
  if (/invalid login credentials/i.test(m)) throw new Error('Wrong email or password.')
  if (/email not confirmed/i.test(m)) throw new Error('This account still needs its email confirmed. Ask the app owner.')
  if (/rate limit|too many/i.test(m)) throw new Error('Too many attempts. Wait a minute and try again.')
  throw new Error(m)
}

export async function signInWithPassword(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  fail(error)
}

export async function updatePassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password })
  fail(error)
}

export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
  fail(error)
}
