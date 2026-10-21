// shaka.util.Error has no enumerable message, so console.error(err) prints "{}".

export interface ShakaErrorLike {
  severity?: number
  category?: number
  code?: number
  data?: unknown[]
}

/** Shaka also emits "error" for problems it retries on its own (RECOVERABLE = 1). */
export const SHAKA_CRITICAL = 2
export const SHAKA_NETWORK_CATEGORY = 1

const KNOWN: Record<number, string> = {
  1001: 'bad HTTP status',
  1002: 'network error',
  1003: 'request timeout',
  3014: 'MediaSource operation failed',
  3016: 'video element error',
  4000: 'unable to guess manifest type',
  7000: 'load interrupted',
}

export function describeShakaError(err: unknown): string {
  const e = (err ?? {}) as ShakaErrorLike
  const data = Array.isArray(e.data) ? e.data : []
  const label = e.code !== undefined ? KNOWN[e.code] ?? 'see shaka.util.Error.Code' : 'unknown'
  // Network errors carry [uri, status, …]
  const http = e.category === SHAKA_NETWORK_CATEGORY && typeof data[0] === 'string'
    ? ` — ${typeof data[1] === 'number' ? `HTTP ${data[1]} ` : ''}${data[0]}`
    : ''
  return `code ${e.code} (${label}, category ${e.category}, severity ${e.severity})${http}`
}

/** Critical network failure worth one automatic retry (session expired, network blip). */
export function isRetryableShakaError(err: unknown): boolean {
  const e = (err ?? {}) as ShakaErrorLike
  return e.severity === SHAKA_CRITICAL && e.category === SHAKA_NETWORK_CATEGORY
}
