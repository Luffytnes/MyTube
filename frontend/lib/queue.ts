export interface QueueItem {
  id: string
  title: string
  thumbnail: string
  duration: string
  channel: string
  channelId: string
}

const KEY = 'mytube-queue'

function load(): QueueItem[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch {
    return []
  }
}

function save(items: QueueItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items))
  } catch {}
}

export function getQueue(): QueueItem[] {
  return load()
}

export function addToQueue(item: QueueItem): void {
  const q = load().filter((i) => i.id !== item.id)
  save([...q, item])
}

export function removeFromQueue(id: string): QueueItem[] {
  const updated = load().filter((i) => i.id !== id)
  save(updated)
  return updated
}

export function clearQueue(): void {
  save([])
}

export function isInQueue(id: string): boolean {
  return load().some((i) => i.id === id)
}

export function shiftQueue(): QueueItem | null {
  const q = load()
  if (q.length === 0) return null
  const [first, ...rest] = q
  save(rest)
  return first
}

export function moveUp(id: string): QueueItem[] {
  const q = load()
  const idx = q.findIndex((i) => i.id === id)
  if (idx <= 0) return q
  const updated = [...q]
  ;[updated[idx - 1], updated[idx]] = [updated[idx], updated[idx - 1]]
  save(updated)
  return updated
}

export function moveDown(id: string): QueueItem[] {
  const q = load()
  const idx = q.findIndex((i) => i.id === id)
  if (idx < 0 || idx >= q.length - 1) return q
  const updated = [...q]
  ;[updated[idx], updated[idx + 1]] = [updated[idx + 1], updated[idx]]
  save(updated)
  return updated
}
