import { useCallback, useEffect, useRef, useState } from 'react'
import { subscribeSample } from './api/sampleBus'
import { isSample } from './mode'
import { supabase } from './supabase'

/**
 * Load async data. Keeps the previous data while reloading so live
 * updates don't flash a spinner.
 */
export function useLoader<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const reqId = useRef(0)

  const reload = useCallback(async () => {
    const id = ++reqId.current
    setLoading(true)
    try {
      const d = await fnRef.current()
      if (id === reqId.current) {
        setData(d)
        setError(null)
      }
    } catch (e) {
      if (id === reqId.current) setError(e)
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    setData(undefined)
    void reload()
  }, deps)

  return { data, error, loading, reload, setData }
}

let channelSeq = 0

/**
 * Re-run `onChange` whenever any of the given tables change (from any
 * organizer's device), when the tab becomes visible again, or when the
 * network comes back. Debounced so a burst of changes = one refetch.
 */
export function useRealtime(tables: string[], onChange: () => void) {
  const cb = useRef(onChange)
  cb.current = onChange
  const key = tables.join(',')

  useEffect(() => {
    if (!key) return
    let timer: number | undefined
    const fire = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => cb.current(), 250)
    }
    if (isSample) {
      const unsubscribe = subscribeSample(key.split(','), fire)
      return () => {
        window.clearTimeout(timer)
        unsubscribe()
      }
    }

    const channel = supabase.channel(`live-${++channelSeq}`)
    for (const table of key.split(',')) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, fire)
    }
    channel.subscribe((status) => {
      // Catch up on anything missed while the socket was down.
      if (status === 'SUBSCRIBED') fire()
    })

    const onVisible = () => document.visibilityState === 'visible' && fire()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', fire)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', fire)
      void supabase.removeChannel(channel)
    }
  }, [key])
}
