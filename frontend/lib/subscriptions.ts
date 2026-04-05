const STORAGE_KEY = 'mytube-subscriptions'

export interface SubscriptionEntry {
  id: string
  name: string
  thumbnail: string | null
}

function load(): SubscriptionEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function save(entries: SubscriptionEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {}
}

export function getSubscriptions(): SubscriptionEntry[] {
  return load()
}

export function isSubscribed(id: string): boolean {
  return load().some((e) => e.id === id)
}

export function subscribe(entry: SubscriptionEntry) {
  const entries = load().filter((e) => e.id !== entry.id)
  entries.unshift(entry)
  save(entries)
}

export function unsubscribe(id: string) {
  save(load().filter((e) => e.id !== id))
}

export function toggleSubscription(entry: SubscriptionEntry): boolean {
  if (isSubscribed(entry.id)) {
    unsubscribe(entry.id)
    return false
  } else {
    subscribe(entry)
    return true
  }
}
