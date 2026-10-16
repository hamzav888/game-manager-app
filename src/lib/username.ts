// Sign-in names. Supabase Auth needs an email address, so a username signs
// in through a hidden one: <username>@poker-ledger.invalid (the same as the
// database's login_email()). ".invalid" can never receive mail.
const DOMAIN = '@poker-ledger.invalid'

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/
export const USERNAME_RULE = 'Up to 32 letters, numbers, dots, dashes or underscores, starting with a letter or number.'

/** "  @Jordan " → "jordan" */
export const cleanUsername = (s: string) => s.trim().replace(/^@/, '').toLowerCase()

export const loginEmail = (username: string) => `${cleanUsername(username)}${DOMAIN}`

/** The username behind a login address, or the address itself for older email logins. */
export const loginName = (email: string | null | undefined): string | null =>
  email ? (email.endsWith(DOMAIN) ? email.slice(0, -DOMAIN.length) : email) : null
