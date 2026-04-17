const STORAGE_KEY = 'mytube-podcast-subscriptions'

export interface PodcastSubscription {
  id: string
  title: string
  author?: string
  thumbnail?: string
}

function load(): PodcastSubscription[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function save(entries: PodcastSubscription[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {}
}

export function getPodcastSubscriptions(): PodcastSubscription[] {
  return load()
}

export function isPodcastSubscribed(id: string): boolean {
  return load().some((e) => e.id === id)
}

export function subscribePodcast(entry: PodcastSubscription) {
  const entries = load().filter((e) => e.id !== entry.id)
  entries.unshift(entry)
  save(entries)
}

export function unsubscribePodcast(id: string) {
  save(load().filter((e) => e.id !== id))
}

export function togglePodcastSubscription(entry: PodcastSubscription): boolean {
  if (isPodcastSubscribed(entry.id)) {
    unsubscribePodcast(entry.id)
    return false
  } else {
    subscribePodcast(entry)
    return true
  }
}
