const KEY = 'mytube-resume-positions'
const MAX_ENTRIES = 500
// Save position only if at least this many seconds in and not near the end
const MIN_SECONDS = 10
const END_THRESHOLD = 0.95 // 95% watched = don't resume

interface PositionEntry {
  position: number
  duration: number
  savedAt: number
}

function load(): Record<string, PositionEntry> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    return {}
  }
}

function save(data: Record<string, PositionEntry>) {
  try {
    // Keep only the MAX_ENTRIES most recent
    const entries = Object.entries(data).sort((a, b) => b[1].savedAt - a[1].savedAt)
    const trimmed = Object.fromEntries(entries.slice(0, MAX_ENTRIES))
    localStorage.setItem(KEY, JSON.stringify(trimmed))
  } catch {}
}

export function savePosition(videoId: string, position: number, duration: number) {
  if (duration <= 0 || position < MIN_SECONDS) return
  if (duration > 0 && position / duration > END_THRESHOLD) {
    clearPosition(videoId)
    return
  }
  const data = load()
  data[videoId] = { position, duration, savedAt: Date.now() }
  save(data)
}

export function getPosition(videoId: string): number | null {
  try {
    const entry = load()[videoId]
    if (!entry) return null
    return entry.position
  } catch {
    return null
  }
}

export function clearPosition(videoId: string) {
  try {
    const data = load()
    delete data[videoId]
    save(data)
  } catch {}
}
