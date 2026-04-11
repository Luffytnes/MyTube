const KEY = 'mytube-search-history'
const MAX = 20

export interface SearchHistoryEntry {
  query: string
  searchedAt: number
}

export function saveSearchQuery(query: string): void {
  try {
    const { getPlaybackSettings } = require('./playbackSettings')
    if (!getPlaybackSettings().searchHistoryEnabled) return
  } catch {}
  try {
    const entries: SearchHistoryEntry[] = JSON.parse(localStorage.getItem(KEY) || '[]')
    const filtered = entries.filter((e) => e.query.toLowerCase() !== query.toLowerCase())
    const updated = [{ query, searchedAt: Date.now() }, ...filtered].slice(0, MAX)
    localStorage.setItem(KEY, JSON.stringify(updated))
  } catch {}
}

export function getSearchHistory(): SearchHistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch { return [] }
}

export function clearSearchHistory(): void {
  try { localStorage.removeItem(KEY) } catch {}
}

export function removeSearchEntry(query: string): void {
  try {
    const updated = getSearchHistory().filter((e) => e.query !== query)
    localStorage.setItem(KEY, JSON.stringify(updated))
  } catch {}
}
