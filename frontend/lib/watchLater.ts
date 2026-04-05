const STORAGE_KEY = 'mytube-watch-later'
const MAX_ENTRIES = 500

export interface WatchLaterEntry {
  id: string
  title: string
  channel: string
  channelId: string
  savedAt: string
}

function load(): WatchLaterEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function save(entries: WatchLaterEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {}
}

export function getWatchLater(): WatchLaterEntry[] {
  return load()
}

export function isInWatchLater(id: string): boolean {
  return load().some((e) => e.id === id)
}

export function addToWatchLater(entry: Omit<WatchLaterEntry, 'savedAt'>) {
  const entries = load().filter((e) => e.id !== entry.id)
  entries.unshift({ ...entry, savedAt: new Date().toISOString() })
  save(entries.slice(0, MAX_ENTRIES))
}

export function removeFromWatchLater(id: string) {
  save(load().filter((e) => e.id !== id))
}

export function toggleWatchLater(entry: Omit<WatchLaterEntry, 'savedAt'>): boolean {
  if (isInWatchLater(entry.id)) {
    removeFromWatchLater(entry.id)
    return false
  } else {
    addToWatchLater(entry)
    return true
  }
}

export function clearWatchLater() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {}
}
