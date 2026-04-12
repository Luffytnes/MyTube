export interface HistoryEntry {
  id: string
  title: string
  channel: string
  channelId: string
  watchedAt: number
}

const HISTORY_KEY = 'mytube-history'
const MAX_HISTORY = 200

export function saveToHistory(entry: Omit<HistoryEntry, 'watchedAt'>): void {
  try {
    const { getPlaybackSettings } = require('./playbackSettings')
    if (!getPlaybackSettings().historyEnabled) return
  } catch {}
  try {
    const existing: HistoryEntry[] = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
    const filtered = existing.filter((h) => h.id !== entry.id)
    const updated = [{ ...entry, watchedAt: Date.now() }, ...filtered].slice(0, MAX_HISTORY)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated))
  } catch {}
}

export function getHistory(): HistoryEntry[] {
  try {
    const all: HistoryEntry[] = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
    // Apply TTL filtering
    try {
      const { getPlaybackSettings } = require('./playbackSettings')
      const ttl = getPlaybackSettings().historyTTL as number
      if (ttl > 0) {
        const cutoff = Date.now() - ttl * 24 * 60 * 60 * 1000
        const filtered = all.filter((h) => h.watchedAt >= cutoff)
        if (filtered.length !== all.length) {
          localStorage.setItem(HISTORY_KEY, JSON.stringify(filtered))
          return filtered
        }
      }
    } catch {}
    return all
  } catch { return [] }
}

export function clearHistory(): void {
  try { localStorage.removeItem(HISTORY_KEY) } catch {}
}

export function removeFromHistory(id: string): HistoryEntry[] {
  try {
    const updated = getHistory().filter((h) => h.id !== id)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated))
    return updated
  } catch { return [] }
}
