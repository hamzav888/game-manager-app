// Stand-in for Supabase Realtime in the sample app: the in-browser data layer
// announces which tables changed and subscribed screens refetch.
type Listener = { tables: Set<string>; cb: () => void }
const listeners = new Set<Listener>()

export function emitSampleChange(table: string) {
  for (const l of listeners) if (l.tables.has(table)) l.cb()
}

export function subscribeSample(tables: string[], cb: () => void): () => void {
  const l = { tables: new Set(tables), cb }
  listeners.add(l)
  return () => listeners.delete(l)
}
