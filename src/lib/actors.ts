import { useMemo } from 'react'
import { useAuth } from '../auth'
import { listAudit } from './api'
import { useLoader, useRealtime } from './hooks'
import type { AuditEntry, AuditFilter } from './types'

/** Who recorded a row and who last changed it, from the audit log. */
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

/** Live map of record id → who recorded / edited it, for the rows matching `filter`. */
export function useRecordStamps(filter: Omit<AuditFilter, 'beforeId' | 'limit'>) {
  const { actorName } = useAuth()
  const key = JSON.stringify(filter)
  const audit = useLoader(() => listAudit({ ...filter, limit: 1000 }), [key])
  useRealtime(['audit_log'], audit.reload)
  return useMemo(() => buildStamps(audit.data ?? [], actorName), [audit.data, actorName])
}
