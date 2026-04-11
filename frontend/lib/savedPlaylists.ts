const STORAGE_KEY = 'mytube-saved-playlists'

export interface SavedPlaylist {
  id: string          // YouTube playlist ID (PLxxx)
  title: string
  thumbnail: string | null
  videoCount: string
  channelName: string
  channelId: string
  firstVideoId: string
  savedAt: number
}

function load(): SavedPlaylist[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

function save(entries: SavedPlaylist[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {}
}

export function getSavedPlaylists(): SavedPlaylist[] {
  return load()
}

export function isPlaylistSaved(id: string): boolean {
  return load().some((p) => p.id === id)
}

export function savePlaylist(entry: Omit<SavedPlaylist, 'savedAt'>): void {
  const entries = load().filter((p) => p.id !== entry.id)
  entries.unshift({ ...entry, savedAt: Date.now() })
  save(entries)
}

export function removeSavedPlaylist(id: string): void {
  save(load().filter((p) => p.id !== id))
}

export function toggleSavedPlaylist(entry: Omit<SavedPlaylist, 'savedAt'>): boolean {
  if (isPlaylistSaved(entry.id)) {
    removeSavedPlaylist(entry.id)
    return false
  } else {
    savePlaylist(entry)
    return true
  }
}
