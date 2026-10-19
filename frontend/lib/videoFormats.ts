import type { VideoFormat } from '@/lib/api'

type Codec = 'avc' | 'vp9' | 'av1'

// YouTube AV1 video-only itags (served as .mp4, like H.264 ones)
const AV1_ITAGS = new Set([
  '394', '395', '396', '397', '398', '399', '400', '401', '402',
  '571', '694', '695', '696', '697', '698', '699', '700', '701', '702',
])

// The backend remuxes adaptive streams to fMP4 HLS, so probe codecs in an MP4 container
const CODEC_PROBES: Record<Exclude<Codec, 'avc'>, string> = {
  vp9: 'video/mp4; codecs="vp09.00.10.08"',
  av1: 'video/mp4; codecs="av01.0.05M.08"',
}

// H.264 decodes everywhere; VP9/AV1 cost less bandwidth but not every device has them
const CODEC_PREFERENCE: Record<Codec, number> = { avc: 0, vp9: 1, av1: 2 }

export function formatHeight(f: VideoFormat): number {
  return f.height || parseInt(f.quality?.replace('p', '') ?? '0', 10) || 0
}

function codecOf(f: VideoFormat): Codec {
  if (f.ext === 'webm') return 'vp9'
  return AV1_ITAGS.has(String(f.itag)) ? 'av1' : 'avc'
}

function canDecode(f: VideoFormat): boolean {
  const codec = codecOf(f)
  if (codec === 'avc') return true
  if (typeof window === 'undefined' || typeof MediaSource === 'undefined') return false
  return MediaSource.isTypeSupported(CODEC_PROBES[codec])
}

function rank(f: VideoFormat): number {
  // YouTube has dropped most pre-muxed formats (e.g. itag 18) that YouTube.js
  // still advertises, so adaptive streams come first at a given height.
  return (f.hasAudio ? 10 : 0) + CODEC_PREFERENCE[codecOf(f)]
}

/** One playable format per height (≥240p), best first. */
export function rankedVideoFormats(formats: VideoFormat[]): VideoFormat[] {
  const byHeight = new Map<number, VideoFormat>()
  for (const f of formats) {
    if (!f.hasVideo) continue
    const h = formatHeight(f)
    if (h < 240) continue
    if (!f.hasAudio && !canDecode(f)) continue
    const existing = byHeight.get(h)
    if (!existing || rank(f) < rank(existing)) byHeight.set(h, f)
  }
  return Array.from(byHeight.entries()).sort((a, b) => b[0] - a[0]).map(([, f]) => f)
}

/** Highest format at or below the target height, else the smallest one above it. */
function closestAtOrBelow(formats: VideoFormat[], targetHeight: number): VideoFormat | null {
  const below = formats.filter((f) => formatHeight(f) <= targetHeight)
  if (below.length) return below.reduce((a, b) => (formatHeight(b) > formatHeight(a) ? b : a))
  if (!formats.length) return null
  return formats.reduce((a, b) => (formatHeight(b) < formatHeight(a) ? b : a))
}

/** Initial format for a quality setting ('auto' means up to 1080p). */
export function pickInitialFormat(ranked: VideoFormat[], defaultQuality: string): VideoFormat | null {
  const target = defaultQuality === 'auto' ? 1080 : parseInt(defaultQuality, 10) || 1080
  return closestAtOrBelow(ranked, target)
}

/** Adaptive replacement for a pre-muxed format the server could not deliver. */
export function adaptiveFallback(formats: VideoFormat[], failed: VideoFormat): VideoFormat | null {
  const adaptive = formats
    .filter((f) => f.hasVideo && !f.hasAudio && formatHeight(f) >= 240 && canDecode(f))
    .sort((a, b) => rank(a) - rank(b))
  return closestAtOrBelow(adaptive, Math.max(formatHeight(failed), 720))
}
