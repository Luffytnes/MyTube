import { Innertube } from 'youtubei.js'

let _instance: Innertube | null = null
let _promise: Promise<Innertube> | null = null

export async function getInnertube(): Promise<Innertube> {
  if (_instance) return _instance
  if (_promise) return _promise
  _promise = Innertube.create({ generate_session_locally: true }).then(yt => {
    _instance = yt
    _promise = null
    return yt
  })
  return _promise
}

export function fmtDuration(secs: number | undefined): string {
  if (!secs) return ''
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function fmtViews(n: number | undefined): string {
  if (!n) return ''
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B views`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M views`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K views`
  return `${n} views`
}

export function parseCount(text: string): number {
  if (!text) return 0
  const m = text.match(/([\d.,]+)\s*([KMBkmb]?)/i)
  if (!m) return 0
  const n = parseFloat(m[1].replace(/,/g, ''))
  switch (m[2].toUpperCase()) {
    case 'K': return Math.round(n * 1_000)
    case 'M': return Math.round(n * 1_000_000)
    case 'B': return Math.round(n * 1_000_000_000)
    default: return Math.round(n)
  }
}

// Video from search results
export function parseVideoItem(v: any): VideoCard | null {
  try {
    const id = v?.id ?? v?.video_id
    if (!id || typeof id !== 'string') return null
    const title = v?.title?.text ?? ''
    if (!title) return null
    const isLive = v?.badges?.some((b: any) => b?.style === 'BADGE_STYLE_TYPE_LIVE_NOW') ?? false
    return {
      id,
      title,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      duration: v?.duration?.text ?? fmtDuration(v?.duration?.seconds),
      views: v?.short_view_count_text?.text ?? v?.view_count?.text ?? v?.view_count?.simple_text ?? '',
      published: v?.published?.text ?? '',
      isLive,
      channel: { id: v?.author?.id ?? '', name: v?.author?.name ?? '', thumbnail: null },
    }
  } catch { return null }
}

// Video from kids search (CompactVideo)
export function parseCompactVideo(v: any): VideoCard | null {
  try {
    const id = v?.id ?? v?.video_id
    if (!id) return null
    const title = v?.title?.text ?? ''
    if (!title) return null
    return {
      id,
      title,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      duration: v?.duration?.text ?? v?.length_text?.text ?? '',
      views: v?.view_count?.text ?? v?.short_view_count?.text ?? '',
      published: v?.published?.text ?? '',
      channel: {
        id: v?.author?.id ?? '',
        name: v?.author?.name ?? v?.short_byline_text?.runs?.[0]?.text ?? '',
        thumbnail: null,
      },
    }
  } catch { return null }
}

// Video from channel/playlist/watchNext (LockupView)
export function parseLockupView(lv: any): VideoCard | null {
  try {
    const id = lv?.content_id
    if (!id || lv?.content_type !== 'VIDEO') return null
    const title = lv?.metadata?.title?.text ?? ''
    if (!title) return null
    const rows: any[] = lv?.metadata?.metadata?.metadata_rows ?? []
    const getText = (idx: number): string =>
      rows[idx]?.metadata_parts?.[0]?.text?.text ?? ''
    return {
      id,
      title,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      duration: '',
      views: getText(1),
      published: getText(2),
      channel: { id: '', name: getText(0), thumbnail: null },
    }
  } catch { return null }
}

// Short from channel.getShorts() (ShortsLockupView)
export function parseShortsLockup(s: any): VideoCard | null {
  try {
    const videoId = s?.on_tap_endpoint?.payload?.videoId
    if (!videoId) return null
    const title =
      s?.overlay_metadata?.primary_text?.text ??
      s?.accessibility_text?.split(',')?.[0]?.trim() ?? ''
    const views = s?.overlay_metadata?.secondary_text?.text ?? ''
    return {
      id: videoId,
      title,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      duration: '',
      views,
      published: '',
      isShort: true,
      channel: { id: '', name: '', thumbnail: null },
    }
  } catch { return null }
}

// Universal parser
export function parseAnyVideo(item: any): VideoCard | null {
  if (!item) return null
  const type: string = item?.type ?? ''
  if (type === 'ShortsLockupView') return parseShortsLockup(item)
  if (type === 'LockupView' || (item?.content_id && item?.content_type === 'VIDEO')) return parseLockupView(item)
  if (type === 'CompactVideo') return parseCompactVideo(item)
  if (item?.on_tap_endpoint?.payload?.videoId) return parseShortsLockup(item)
  if (item?.id && item?.title?.text) return parseVideoItem(item)
  if (item?.video_id && item?.title?.text) return parseCompactVideo(item)
  return null
}

// Inline type definition (mirrors api.ts VideoCard)
interface VideoCard {
  id: string
  title: string
  thumbnail: string
  duration: string
  views: string
  published: string
  channel: { id: string; name: string; thumbnail: string | null; subscriberCount?: number }
  isLive?: boolean
  isShort?: boolean
}
