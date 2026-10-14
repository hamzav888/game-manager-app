// The organization the app is currently working in. Every list query is
// scoped to it (the database also enforces membership with RLS).

const STORAGE_KEY = 'poker-ledger:org'
let current: string | null = null

export function setCurrentOrg(id: string | null) {
  current = id
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id)
  } catch {
    /* storage unavailable */
  }
}

export function lastUsedOrg(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function orgId(): string {
  if (!current) throw new Error('No organization selected.')
  return current
}
