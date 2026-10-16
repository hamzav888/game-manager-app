import { useMemo } from 'react'
import { useAuth } from '../auth'
import { listAudit } from './api'
import { useLoader, useRealtime } from './hooks'
import type { AuditEntry, AuditFilter, Stamped } from './types'

/** Who recorded a row and who last changed it. */
export interface RecordStamp {
  createdBy: string | null
  createdAt: string | null
  editedBy: string | null
  editedAt: string | null
  edits: number
}

export function buildStamps(entries: AuditEntry[], actorName: (email: string | null) => string): Map<string, RecordStamp> {
  const map = new Map<string, RecordStamp>()
  // Oldest first, so the last UPDATE wins.
  for (const e of [...entries].sort((a, b) => a.id - b.id)) {
    if (!e.record_id) continue
    const s = map.get(e.record_id) ?? { createdBy: null, createdAt: null, editedBy: null, editedAt: null, edits: 0 }
    if (e.action === 'INSERT') {
      s.createdBy = actorName(e.actor_email)
      s.createdAt = e.occurred_at
    } else if (e.action === 'UPDATE') {
      s.editedBy = actorName(e.actor_email)
      s.editedAt = e.occurred_at
      s.edits += 1
    }
    map.set(e.record_id, s)
  }
  return map
}

export type StampRow = Stamped & { id: string; created_at: string; updated_at?: string | null }

/** Stamps from the rows themselves (created_by / updated_by, set by the database). */
export function stampsFromRows(rows: StampRow[], memberName: (id: string | null | undefined) => string | null): Map<string, RecordStamp> {
  const map = new Map<string, RecordStamp>()
  for (const r of rows) {
    map.set(r.id, {
      createdBy: r.created_by ? (memberName(r.created_by) ?? 'a former member') : null,
      createdAt: r.created_at,
      editedBy: r.updated_at && r.updated_by ? (memberName(r.updated_by) ?? 'a former member') : null,
      editedAt: r.updated_at ?? null,
      edits: r.updated_at ? 1 : 0,
    })
  }
  return map
}

/**
 * Live map of record id → who recorded / edited it. The owner gets it from the
 * full history (every edit counted); everyone else, who can't read the
 * history, gets it from the rows passed in.
 */
export function useRecordStamps(filter: Omit<AuditFilter, 'beforeId' | 'limit'>, rows: StampRow[] = []) {
  const { actorName, memberName, isOwner } = useAuth()
  const key = JSON.stringify(filter)
  const audit = useLoader(() => (isOwner ? listAudit({ ...filter, limit: 1000 }) : Promise.resolve([] as AuditEntry[])), [key, isOwner])
  useRealtime(isOwner ? ['audit_log'] : [], audit.reload)
  return useMemo(
    () => (isOwner ? buildStamps(audit.data ?? [], actorName) : stampsFromRows(rows, memberName)),
    [isOwner, audit.data, actorName, rows, memberName],
  )
}
