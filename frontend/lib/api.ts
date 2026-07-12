const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'
// YouTube.js routes are same-origin Next.js API routes
const YT_API = '/api/yt'

export interface VideoChannel {
  id: string
  name: string
  thumbnail?: string | null
  subscriberCount?: number
}

export interface VideoCard {
  id: string
  title: string
  thumbnail: string
  duration: string
  views: string
  published: string
  channel: VideoChannel
  isLive?: boolean
  isShort?: boolean
}

export interface VideoFormat {
  itag: string
  ext: string
  quality: string
  filesize?: number | null
  hasAudio: boolean
  hasVideo: boolean
  height?: number
  abr?: number
}

export interface RelatedChannel {
  type: 'channel'
  id: string
  title: string
  thumbnail: string | null
  duration: string
  views: string
  published: string
  channel: VideoChannel
}

export interface VideoDetail extends VideoCard {
  description: string
  likes: string
  viewCount: number
  uploadDate: string
  formats: VideoFormat[]
  related: (VideoCard | RelatedChannel)[]
  isLive?: boolean
}

export interface ChannelInfo {
  id: string
  name: string
  description: string
  subscriberCount: number
  videoCount: number
  thumbnail: string | null
  banner: string | null
  hasShorts?: boolean
  hasLive?: boolean
}

export interface ChannelSearchResult {
  type: 'channel'
  id: string
  name: string
  thumbnail: string | null
  description: string
  subscriberText: string
  videoCountText: string
}

export interface PlaylistSearchResult {
  type: 'playlist'
  id: string
  title: string
  thumbnail: string | null
  videoCount: string
  channelName: string
  channelId: string
  firstVideoId: string
}

export interface SearchResult {
  videos: VideoCard[]
  channels: ChannelSearchResult[]
  playlists: PlaylistSearchResult[]
  query: string
  page: number
}

export interface TrendingResult {
  videos: VideoCard[]
}

export interface ChannelVideosResult {
  videos: VideoCard[]
  channelId: string
  page: number
}

function buildThumbnailUrl(videoId: string): string {
  // Use YouTube's CDN directly — faster than proxying through our backend
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
}

function normalizeThumbnail(video: VideoCard): VideoCard {
  return {
    ...video,
    thumbnail: buildThumbnailUrl(video.id),
  }
}

export async function getTrending(region = 'US', category = 'all', lang = 'en'): Promise<TrendingResult> {
  // Use YouTube.js for trending (falls back to Python backend if needed)
  try {
    const params = new URLSearchParams({ category, region, lang })
    const res = await fetch(`${YT_API}/trending?${params}`, { cache: 'no-store' })
    if (!res.ok) throw new Error('yt trending failed')
    const data: TrendingResult = await res.json()
    if (data.videos?.length) return { videos: data.videos.map(normalizeThumbnail) }
  } catch { /* fall through */ }
  // Python backend fallback
  const params = new URLSearchParams({ region, category, lang })
  const res = await fetch(`${API_BASE}/api/trending?${params}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Failed to fetch trending: ${res.statusText}`)
  const data: TrendingResult = await res.json()
  return { videos: data.videos.map(normalizeThumbnail) }
}

export async function searchVideos(q: string, page = 1): Promise<SearchResult> {
  const params = new URLSearchParams({ q, page: String(page) })
  const res = await fetch(`${YT_API}/search?${params}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Search failed: ${res.statusText}`)
  const data: SearchResult = await res.json()
  return {
    ...data,
    videos: data.videos.map(normalizeThumbnail),
    channels: data.channels || [],
    playlists: data.playlists || [],
  }
}

export async function getVideo(id: string): Promise<VideoDetail> {
  const res = await fetch(`${YT_API}/video/${id}`, { cache: 'no-store' })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `Failed to fetch video: ${res.statusText}`)
  }
  const raw = await res.json()
  const channelId: string = raw.channelId ?? ''
  return {
    ...raw,
    channel: {
      id: channelId,
      name: raw.channel ?? '',
      thumbnail: channelId ? `/api/channel_thumbnail/${channelId}` : null,
    } as VideoChannel,
    thumbnail: buildThumbnailUrl(id),
    related: (raw.related ?? []).map((item: any) =>
      item.type === 'channel' ? item : normalizeThumbnail(item as VideoCard)
    ),
  }
}

export async function getChannel(id: string): Promise<ChannelInfo> {
  const res = await fetch(`${YT_API}/channel/${id}`, { next: { revalidate: 60 } })
  if (!res.ok) throw new Error(`Failed to fetch channel: ${res.statusText}`)
  return res.json()
}

export async function getChannelVideos(id: string, page = 1): Promise<ChannelVideosResult> {
  const params = new URLSearchParams({ page: String(page) })
  const res = await fetch(`${YT_API}/channel/${id}/videos?${params}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Failed to fetch channel videos: ${res.statusText}`)
  const data: ChannelVideosResult = await res.json()
  return { ...data, videos: data.videos.map(normalizeThumbnail) }
}

export async function getChannelShorts(id: string): Promise<ChannelVideosResult> {
  const res = await fetch(`${YT_API}/channel/${id}/shorts`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Failed to fetch channel shorts: ${res.statusText}`)
  const data = await res.json()
  return { videos: (data.videos ?? []).map(normalizeThumbnail), channelId: id, page: 1 }
}

export async function getChannelLive(id: string): Promise<ChannelVideosResult> {
  const res = await fetch(`${YT_API}/channel/${id}/live`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Failed to fetch channel live streams: ${res.statusText}`)
  const data = await res.json()
  return { videos: (data.videos ?? []).map(normalizeThumbnail), channelId: id, page: 1 }
}

export function getStreamUrl(videoId: string, itag?: string): string {
  const params = itag ? `?itag=${encodeURIComponent(itag)}` : ''
  return `${API_BASE}/api/stream/${videoId}${params}`
}

export function getAudioUrl(videoId: string): string {
  return `${API_BASE}/api/stream/${videoId}/audio`
}

export function getLiveUrl(videoId: string): string {
  return `${API_BASE}/api/live/${videoId}`
}

export function getDownloadUrl(videoId: string, itag: string): string {
  return `${API_BASE}/api/download/${videoId}?itag=${encodeURIComponent(itag)}`
}

export interface SubtitleTrack {
  lang: string
  label: string
  auto: boolean
  url: string
}

export async function getSubtitles(videoId: string): Promise<SubtitleTrack[]> {
  try {
    const res = await fetch(`${API_BASE}/api/subtitles/${videoId}`)
    if (!res.ok) return []
    const data = await res.json()
    return data.subtitles || []
  } catch {
    return []
  }
}

export function getSubtitleUrl(videoId: string, lang: string): string {
  return `${API_BASE}/api/subtitles/${videoId}/${encodeURIComponent(lang)}`
}

export interface PlaylistVideo {
  id: string
  title: string
  duration: string
  thumbnail: string
  channel: string
  channelId: string
}

export interface PlaylistDetail {
  id: string
  title: string
  uploader: string
  videoCount: number
  videos: PlaylistVideo[]
}

export async function getPlaylist(playlistId: string): Promise<PlaylistDetail> {
  const res = await fetch(`${YT_API}/playlist/${playlistId}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Failed to fetch playlist: ${res.statusText}`)
  return res.json()
}

export interface NewsArticle {
  title: string
  link: string
  pubDate: string
  source: string
  description: string
  image: string | null
}

export interface NewsResponse {
  articles: NewsArticle[]
  region: string
  category: string
}

export async function getNews(region: string, category: string): Promise<NewsResponse> {
  const res = await fetch(`${API_BASE}/api/news?region=${region}&category=${category}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Failed to fetch news`)
  return res.json()
}
