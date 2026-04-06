const STORAGE_KEY = 'mytube-podcast-subscriptions'

export interface PodcastSubscription {
  browseId: string
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

export function isPodcastSubscribed(browseId: string): boolean {
  return load().some((e) => e.browseId === browseId)
}

export function subscribePodcast(entry: PodcastSubscription) {
  const entries = load().filter((e) => e.browseId !== entry.browseId)
  entries.unshift(entry)
  save(entries)
}

export function unsubscribePodcast(browseId: string) {
  save(load().filter((e) => e.browseId !== browseId))
}

export function togglePodcastSubscription(entry: PodcastSubscription): boolean {
  if (isPodcastSubscribed(entry.browseId)) {
    unsubscribePodcast(entry.browseId)
    return false
  } else {
    subscribePodcast(entry)
    return true
  }
}
