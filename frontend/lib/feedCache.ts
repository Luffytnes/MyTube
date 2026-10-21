// YouTube.js feeds are stateful — the continuation token lives inside the
// object — but every "Load more" is a separate HTTP request. Without this cache
// page N re-ran the search from scratch and continued it once: YouTube reorders
// fresh searches, so later pages repeated earlier results.

interface Continuable {
  has_continuation?: boolean
  getContinuation: () => Promise<unknown>
}

const TTL_MS = 10 * 60 * 1000
const MAX_ENTRIES = 200
const cache = new Map<string, { feed: unknown; at: number }>()

function remember(key: string, page: number, feed: unknown) {
  cache.set(`${key}#${page}`, { feed, at: Date.now() })
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string)
}

function recall(key: string, page: number): unknown | undefined {
  const hit = cache.get(`${key}#${page}`)
  if (!hit) return undefined
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(`${key}#${page}`)
    return undefined
  }
  return hit.feed
}

/** Page `page` (1-based) of a feed, continuing the cached previous page when
 *  possible. Returns null past the last page. */
export async function feedPage<T>(key: string, page: number, first: () => Promise<T>): Promise<T | null> {
  let current = page
  let feed = recall(key, current)
  while (feed === undefined && current > 1) {
    current--
    feed = recall(key, current)
  }
  if (feed === undefined) {
    feed = await first()
    current = 1
    remember(key, 1, feed)
  }
  while (current < page) {
    const continuable = feed as Continuable
    if (!continuable.has_continuation) return null
    feed = await continuable.getContinuation()
    current++
    remember(key, current, feed)
  }
  return feed as T
}
