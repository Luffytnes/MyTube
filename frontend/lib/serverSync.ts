'use client'

/** Keeps a copy of the saved data (history, likes, playlists, settings…) on
 *  the MyTube server. LibreWolf and other private browsers wipe site data when
 *  they close; the next visit restores it from that copy.
 *
 *  Every write to one of SYNCED_KEYS is noticed (localStorage.setItem is
 *  wrapped, so the existing stores need no change) and sent shortly after.
 *  On load, entries the server has seen change since this browser last synced
 *  are written back, then the page reloads once so everything shows them. */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export const SYNCED_KEYS = [
  'mytube-history', 'mytube-search-history', 'mytube-watch-later', 'mytube-likes',
  'mytube-queue', 'mytube-resume-positions', 'mytube-saved-playlists', 'mytube-subscriptions',
  'mytube-playback-settings', 'mytube-music-playlists', 'mytube-music-search-history',
  'mytube-podcast-subscriptions', 'mytube-extensions', 'mytube-theme', 'mytube-region',
  'tv_favorites', 'tv_continue_watching',
] as const

const SYNCED = new Set<string>(SYNCED_KEYS)
const META_KEY = 'mytube-sync-meta'    // key → server version this browser holds
const DIRTY_KEY = 'mytube-sync-dirty'  // keys changed here and not sent yet
const RELOADED_AT = 'mytube-sync-reloaded-at'
const FLUSH_DELAY = 2000

let started = false
let hooked = false
// Writes that must not count as changes (they come from the sync itself)
let rawSet: (key: string, value: string) => void = () => {}
let rawRemove: (key: string) => void = () => {}
const pending = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
let serverKnown = false

function readJSON<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? '') as T } catch { return fallback }
}

function saveDirty(): void {
  try { rawSet(DIRTY_KEY, JSON.stringify(Array.from(pending))) } catch { /* storage full */ }
}

function markDirty(key: string): void {
  pending.add(key)
  saveDirty()
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => { void flush() }, FLUSH_DELAY)
}

async function flush(keepalive = false): Promise<void> {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  // Until the server copy is read, sending could overwrite newer data with stale ones
  if (!serverKnown || pending.size === 0) return
  const meta = readJSON<Record<string, number>>(META_KEY, {})
  for (const key of Array.from(pending)) {
    try {
      const res = await fetch(`${API_BASE}/api/userdata/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: localStorage.getItem(key) }),
        keepalive,
      })
      if (!res.ok) continue
      meta[key] = (await res.json()).updated
      pending.delete(key)
    } catch { /* server unreachable: kept dirty, sent next time */ }
  }
  try { rawSet(META_KEY, JSON.stringify(meta)) } catch { /* storage full */ }
  saveDirty()
}

// Settings: on a browser that never synced them, the saved choices win
const SETTINGS_KEYS = new Set(['mytube-playback-settings', 'mytube-extensions', 'mytube-theme', 'mytube-region'])

function identity(item: unknown): string {
  if (item && typeof item === 'object') {
    const o = item as Record<string, unknown>
    const id = o.id ?? o.videoId ?? o.query
    if (id !== undefined) return `${o.type ?? ''}:${String(id)}`
  }
  return JSON.stringify(item)
}

/** First sync of a key in this browser while both sides hold data (a wiped
 *  browser saved something before the server copy was read, or a second
 *  browser): keep both instead of letting one erase the other. */
function merge(key: string, server: string, local: string): string {
  if (SETTINGS_KEYS.has(key)) return server
  try {
    const a = JSON.parse(server)
    const b = JSON.parse(local)
    if (Array.isArray(a) && Array.isArray(b)) {
      const known = new Set(a.map(identity))
      // Items only this browser has are the latest ones (e.g. the video just opened)
      return JSON.stringify([...b.filter(item => !known.has(identity(item))), ...a])
    }
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      return JSON.stringify({ ...a, ...b })
    }
  } catch { /* not JSON */ }
  return server
}

async function pull(): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/userdata`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`userdata ${res.status}`)
  const { entries } = await res.json() as { entries: Record<string, { value: string | null; updated: number }> }
  const meta = readJSON<Record<string, number>>(META_KEY, {})
  let restored = false
  for (const key of SYNCED_KEYS) {
    const server = entries[key]
    const local = localStorage.getItem(key)
    const known = meta[key]
    if (known === undefined && server?.value != null && local !== null && local !== server.value) {
      const merged = merge(key, server.value, local)
      rawSet(key, merged)
      meta[key] = server.updated
      if (merged !== server.value) pending.add(key)
      else pending.delete(key)
      restored = true
      continue
    }
    if (pending.has(key)) continue  // changed here since the last sync: this browser's version wins
    if (server && server.updated > (known ?? 0)) {
      if (server.value !== local) {
        if (server.value === null) rawRemove(key)
        else rawSet(key, server.value)
        restored = true
      }
      meta[key] = server.updated
    } else if (local !== null && (!server || server.updated < (known ?? 0))) {
      // Never sent from here, or the server lost it (new install): send ours
      pending.add(key)
    }
  }
  rawSet(META_KEY, JSON.stringify(meta))
  saveDirty()
  return restored
}

/** Wrap localStorage writes. Runs when this module loads, before any page
 *  component can save something, so no write goes unnoticed. */
function installStorageHook(): void {
  const proto = Storage.prototype
  const originalSet = proto.setItem
  const originalRemove = proto.removeItem
  rawSet = (key, value) => originalSet.call(localStorage, key, value)
  rawRemove = key => originalRemove.call(localStorage, key)
  proto.setItem = function (this: Storage, key: string, value: string) {
    originalSet.call(this, key, value)
    if (this === window.localStorage && SYNCED.has(key)) markDirty(key)
  }
  proto.removeItem = function (this: Storage, key: string) {
    originalRemove.call(this, key)
    if (this === window.localStorage && SYNCED.has(key)) markDirty(key)
  }
  for (const key of readJSON<string[]>(DIRTY_KEY, [])) if (SYNCED.has(key)) pending.add(key)
  hooked = true
}

if (typeof window !== 'undefined') {
  try { installStorageHook() } catch { /* storage disabled: nothing to sync */ }
}

export function startServerSync(): void {
  if (started || !hooked) return
  started = true
  window.addEventListener('pagehide', () => { void flush(true) })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flush(true) })

  let attempts = 0
  const sync = () => {
    pull()
      .then(restored => {
        serverKnown = true
        void flush()
        if (!restored) return
        // At most one reload every 30 s, whatever happens
        const last = Number(sessionStorage.getItem(RELOADED_AT) || 0)
        if (Date.now() - last > 30_000) {
          sessionStorage.setItem(RELOADED_AT, String(Date.now()))
          window.location.reload()
        }
      })
      .catch(() => { if (++attempts < 5) setTimeout(sync, 15_000 * attempts) })
  }
  sync()
}
