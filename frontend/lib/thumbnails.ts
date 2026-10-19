const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export type ThumbnailQuality = 'mq' | 'hq' | 'maxres'

/** Video thumbnail served through the backend proxy, so the browser never contacts Google. */
export function ytThumbnail(videoId: string, quality: ThumbnailQuality = 'hq'): string {
  return `${API_BASE}/api/thumbnail/${videoId}?q=${quality}`
}

const GOOGLE_IMAGE_HOST = /(^|\.)(googleusercontent\.com|ggpht\.com|ytimg\.com|youtube\.com)$/

/** Browser-safe image URL: API-relative paths get the API base, and artwork
 *  hosted by Google (YouTube Music, avatars) goes through the backend proxy.
 *  Applied at render time so URLs already saved in local playlists are covered. */
export function imageSrc(url?: string | null): string | undefined {
  if (!url) return undefined
  if (url.startsWith('/')) return `${API_BASE}${url}`
  try {
    if (GOOGLE_IMAGE_HOST.test(new URL(url).hostname)) {
      return `${API_BASE}/api/podcasts/image/proxy?url=${encodeURIComponent(url)}`
    }
  } catch { /* not a URL: return as-is */ }
  return url
}
