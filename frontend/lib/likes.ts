const STORAGE_KEY = 'mytube-likes'
const MAX_ENTRIES = 1000

export interface LikeEntry {
  id: string
  title: string
  channel: string
  channelId: string
  likedAt: string
}

function load(): LikeEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function save(entries: LikeEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {}
}

export function getLikes(): LikeEntry[] {
  return load()
}

export function isLiked(id: string): boolean {
  return load().some((e) => e.id === id)
}

export function addLike(entry: Omit<LikeEntry, 'likedAt'>) {
  const entries = load().filter((e) => e.id !== entry.id)
  entries.unshift({ ...entry, likedAt: new Date().toISOString() })
  save(entries.slice(0, MAX_ENTRIES))
}

export function removeLike(id: string) {
  save(load().filter((e) => e.id !== id))
}

export function toggleLike(entry: Omit<LikeEntry, 'likedAt'>): boolean {
  if (isLiked(entry.id)) {
    removeLike(entry.id)
    return false
  } else {
    addLike(entry)
    return true
  }
}

export function clearLikes() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {}
}
