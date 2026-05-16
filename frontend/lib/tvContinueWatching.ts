const KEY = 'tv_continue_watching'
const MAX_ITEMS = 20
const MIN_POSITION_SEC = 1       // save after 1 second
const COMPLETE_RATIO = 0.95      // considered finished at 95%

export interface ContinueItem {
  id: string
  type: 'vod'
  name: string
  icon: string
  position: number   // seconds
  duration: number   // seconds (0 = unknown)
  ext: string
  media: string
  // Series context — present only when the episode belongs to a series
  seriesId?: string
  season?: string
  seriesName?: string
  seriesIcon?: string
  updatedAt: number
}

export function getContinueWatching(): ContinueItem[] {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}

export function saveContinue(item: Omit<ContinueItem, 'updatedAt'>): void {
  if (item.position < MIN_POSITION_SEC) return
  if (item.duration > 0 && item.position / item.duration > COMPLETE_RATIO) {
    if (item.seriesId) {
      // Series episode: mark complete (full bar on thumbnail) but keep in store
      const list = getContinueWatching().filter(c => c.id !== item.id)
      list.unshift({ ...item, position: item.duration, updatedAt: Date.now() })
      localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ITEMS)))
    } else {
      // Film: remove completely
      removeContinue(item.id)
    }
    return
  }
  const list = getContinueWatching().filter(c => c.id !== item.id)
  list.unshift({ ...item, updatedAt: Date.now() })
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ITEMS)))
}

export function removeContinue(id: string): void {
  const list = getContinueWatching().filter(c => c.id !== id)
  localStorage.setItem(KEY, JSON.stringify(list))
}

export function removeContinueSeries(seriesId: string): void {
  const list = getContinueWatching().filter(c => c.seriesId !== seriesId)
  localStorage.setItem(KEY, JSON.stringify(list))
}

export function cleanSeriesIfComplete(seriesId: string, allEpisodeIds: string[]): void {
  if (!allEpisodeIds.length) return
  const list = getContinueWatching()
  const map = new Map(list.filter(c => c.seriesId === seriesId).map(c => [c.id, c]))
  const allDone = allEpisodeIds.every(epId => {
    const e = map.get(epId)
    return e && e.duration > 0 && e.position >= e.duration * COMPLETE_RATIO
  })
  if (allDone) {
    localStorage.setItem(KEY, JSON.stringify(list.filter(c => c.seriesId !== seriesId)))
  }
}
