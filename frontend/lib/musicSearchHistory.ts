const KEY = 'mytube-music-search-history'
const MAX = 20

export interface MusicSearchEntry {
  query: string
  searchedAt: number
}

export function saveMusicSearchQuery(query: string): void {
  try {
    const entries: MusicSearchEntry[] = JSON.parse(localStorage.getItem(KEY) || '[]')
    const filtered = entries.filter((e) => e.query.toLowerCase() !== query.toLowerCase())
    const updated = [{ query, searchedAt: Date.now() }, ...filtered].slice(0, MAX)
    localStorage.setItem(KEY, JSON.stringify(updated))
  } catch {}
}

export function getMusicSearchHistory(): MusicSearchEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch { return [] }
}
