import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { createOrganization, listMembers, listMyOrganizations, whoAmI } from './lib/api'
import { SAMPLE_EMAIL, SAMPLE_USER_ID } from './lib/api/sampleSeed'
import { useRealtime } from './lib/hooks'
import { isSample } from './lib/mode'
import { lastUsedOrg, setCurrentOrg } from './lib/org'
import { supabase } from './lib/supabase'
import type { Member, MyOrg } from './lib/types'
import { loginName } from './lib/username'

type AuthState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'error'; error: string }
  /** signed in, but not an active member of any organization */
  | { status: 'no_org' }
  | { status: 'ready' }

interface User {
  id: string
  email: string
}

interface AuthApi {
  state: AuthState
  /** a one-off message for the sign-in screen (e.g. a failed Google sign-in) */
  notice: string | null
  user: User | null
  /** the signed-in account's username */
  username: string | null
  /** the app owner: creates accounts and organizations */
  isOwner: boolean
  /** the owner created or approved this account */
  approved: boolean
  orgs: MyOrg[]
  org: MyOrg | null
  members: Member[]
  me: Member | null
  /** admin of the current organization */
  isAdmin: boolean
  actorName: (email: string | null) => string
  memberName: (userId: string | null | undefined) => string | null
  switchOrg: (id: string) => void
  refresh: () => Promise<void>
  /** owner: create an organization you run yourself */
  createOrg: (name: string) => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthApi | null>(null)

/** Pick up (and strip) an error left in the URL by a failed Google sign-in. */
function readRedirectError(): string | null {
  const url = new URL(window.location.href)
  const hash = new URLSearchParams(url.hash.slice(1))
  const error = url.searchParams.get('error_description') ?? hash.get('error_description')
  if (error || url.searchParams.has('code')) {
    for (const k of ['code', 'error', 'error_code', 'error_description']) url.searchParams.delete(k)
    window.history.replaceState(window.history.state, '', url.pathname + url.search)
  }
  return error
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  // undefined = still checking, null = signed out
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [notice, setNotice] = useState<string | null>(null)
  const [who, setWho] = useState<{ is_owner: boolean; approved: boolean; username: string | null }>({
    is_owner: false,
    approved: false,
    username: null,
  })
  const [orgs, setOrgs] = useState<MyOrg[] | null>(null)
  const [orgId, setOrgId] = useState<string | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  // ---------------------------------------------------------------- session
  useEffect(() => {
    if (started.current) return
    started.current = true
    if (isSample) {
      setUser({ id: SAMPLE_USER_ID, email: SAMPLE_EMAIL })
      return
    }
    const redirectError = readRedirectError()
    supabase.auth.getSession().then(({ data }) => {
      const s = data.session
      setUser(s ? { id: s.user.id, email: s.user.email ?? '' } : null)
      if (!s && redirectError) setNotice(redirectError)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setUser(s ? { id: s.user.id, email: s.user.email ?? '' } : null)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  // ---------------------------------------------------------------- organizations
  const loadOrgs = useCallback(
    async (prefer?: string | null) => {
      const [list, me] = await Promise.all([listMyOrganizations(), whoAmI()])
      setWho(me)
      setOrgs(list)
      const active = list.filter((o) => o.active)
      const pick =
        active.find((o) => o.id === prefer) ?? active.find((o) => o.id === orgId) ?? active.find((o) => o.id === lastUsedOrg()) ?? active[0]
      setCurrentOrg(pick?.id ?? null)
      setOrgId(pick?.id ?? null)
      setMembers(pick ? await listMembers() : [])
    },
    [orgId],
  )

  const userId = user?.id
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    loadOrgs().catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
    // Reload only when the signed-in account changes.
  }, [userId])

  const refresh = useCallback(() => loadOrgs(orgId), [loadOrgs, orgId])
  useRealtime(user ? ['memberships', 'organizations'] : [], () => void refresh())

  // ---------------------------------------------------------------- api
  const api = useMemo<AuthApi>(() => {
    const org = orgs?.find((o) => o.id === orgId) ?? null
    const me = user ? (members.find((m) => m.user_id === user.id) ?? null) : null
    const state: AuthState = error
      ? { status: 'error', error }
      : user === undefined
        ? { status: 'loading' }
        : user === null
          ? { status: 'signed_out' }
          : orgs === null
            ? { status: 'loading' }
            : org
              ? { status: 'ready' }
              : { status: 'no_org' }
    return {
      state,
      notice,
      user: user ?? null,
      username: who.username ?? loginName(user?.email),
      isOwner: who.is_owner,
      approved: who.approved,
      orgs: orgs ?? [],
      org,
      members,
      me,
      isAdmin: org?.role === 'admin',
      actorName: (email) => {
        if (!email) return 'System'
        const m = members.find((x) => x.email === email)
        return m?.display_name || m?.username || loginName(email) || email
      },
      memberName: (id) => {
        const m = members.find((x) => x.user_id === id)
        return m ? m.display_name || m.username || loginName(m.email) : null
      },
      switchOrg: (id) => {
        setCurrentOrg(id)
        setOrgId(id)
        void listMembers().then(setMembers)
        navigate('/')
      },
      refresh,
      createOrg: async (name) => {
        const id = await createOrganization(name)
        await loadOrgs(id)
        navigate('/')
      },
      signOut: async () => {
        if (isSample) {
          window.location.assign('/')
          return
        }
        await supabase.auth.signOut()
        setOrgs(null)
        setOrgId(null)
        setMembers([])
        setCurrentOrg(null)
        setWho({ is_owner: false, approved: false, username: null })
      },
    }
  }, [orgs, orgId, user, members, error, notice, who, refresh, loadOrgs, navigate])

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth outside provider')
  return ctx
}
