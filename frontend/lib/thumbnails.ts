const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export type ThumbnailQuality = 'mq' | 'hq' | 'maxres'

/** Video thumbnail served through the backend proxy, so the browser never contacts Google. */
export function ytThumbnail(videoId: string, quality: ThumbnailQuality = 'hq'): string {
  return `${API_BASE}/api/thumbnail/${videoId}?q=${quality}`
}
