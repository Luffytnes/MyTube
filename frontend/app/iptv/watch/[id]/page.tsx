'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { ArrowLeft, Radio, Film } from 'lucide-react'
import { useRegion } from '@/lib/regionContext'
import Hls from 'hls.js'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export default function IPTVWatchPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { t } = useRegion()
  const id = params.id as string
  const name = searchParams.get('name') || 'Channel'
  const icon = searchParams.get('icon') || ''
  const type = (searchParams.get('type') || 'live') as 'live' | 'vod'
  const ext = searchParams.get('ext') || 'mp4'
  const media = searchParams.get('media') || 'movie'
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [iconErr, setIconErr] = useState(false)

  useEffect(() => {
    let hls: Hls | null = null
    let aborted = false
    const controller = new AbortController()
    let loadTimeout: ReturnType<typeof setTimeout> | null = null

    function clearLoadTimeout() {
      if (loadTimeout) { clearTimeout(loadTimeout); loadTimeout = null }
    }

    function onReady() {
      clearLoadTimeout()
      setLoading(false)
    }

    function onError() {
      clearLoadTimeout()
      const code = videoRef.current?.error?.code
      // 4 = MEDIA_ERR_SRC_NOT_SUPPORTED (codec/format not playable in this browser)
      setError(code === 4 ? t('iptv_format_unsupported') : t('iptv_error'))
      setLoading(false)
    }

    async function startStream() {
      // Bail out after 30s if the video never fires loadedmetadata/canplay/error
      loadTimeout = setTimeout(() => { setError(t('iptv_error')); setLoading(false) }, 30000)
      try {
        const endpoint = type === 'live'
          ? `${API_BASE}/api/iptv/stream/${id}`
          : `${API_BASE}/api/iptv/vod_stream/${id}?ext=${ext}&media=${media}`
        const res = await fetch(endpoint, { signal: controller.signal })
        if (aborted) return
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (aborted) return
        const url: string = data.url
        const useHls = type === 'live' || data.hls !== false

        const video = videoRef.current
        if (!video || aborted) return

        if (useHls && Hls.isSupported()) {
          hls = new Hls({ enableWorker: true, lowLatencyMode: type === 'live' })
          hls.loadSource(url)
          hls.attachMedia(video)
          hls.on(Hls.Events.MANIFEST_PARSED, () => { onReady(); video.play().catch(() => {}) })
          hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) onError() })
        } else if (useHls && video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = url
          video.addEventListener('loadedmetadata', () => { onReady(); video.play().catch(() => {}) })
          video.addEventListener('error', onError)
        } else {
          video.src = url
          video.addEventListener('loadedmetadata', onReady)
          video.addEventListener('canplay', () => { onReady(); video.play().catch(() => {}) })
          video.addEventListener('error', onError)
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        onError()
      }
    }

    startStream()
    return () => {
      aborted = true
      clearLoadTimeout()
      controller.abort()
      hls?.destroy()
      const video = videoRef.current
      if (video) {
        video.pause()
        video.src = ''
        video.load()
      }
    }
  }, [id, type, ext, media, t])

  const isLive = type === 'live'

  return (
    <div className="min-h-screen bg-yt-bg">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-yt-secondary border-b border-yt-border">
        <button onClick={() => router.back()} className="p-2 rounded-full hover:bg-yt-hover text-yt-text transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        {icon && !iconErr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`${API_BASE}/api/iptv/icon?url=${encodeURIComponent(icon)}`}
            alt={name}
            className="w-8 h-8 object-contain rounded"
            onError={() => setIconErr(true)}
          />
        ) : isLive ? (
          <Radio className="w-6 h-6 text-yt-text" />
        ) : (
          <Film className="w-6 h-6 text-yt-text" />
        )}
        <div>
          <p className="text-yt-text font-semibold text-sm">{name}</p>
          {isLive && (
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs text-yt-text-muted">{t('iptv_live')}</span>
            </div>
          )}
        </div>
      </div>

      {/* Video */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="relative bg-black rounded-xl overflow-hidden" style={{ aspectRatio: '16/9' }}>
          {loading && !error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-10 h-10 border-2 border-white border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {error ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white px-4">
              <p className="text-lg mb-4">{error}</p>
              <button onClick={() => router.back()} className="px-4 py-2 bg-white/20 rounded-full text-sm hover:bg-white/30 transition-colors">
                {t('nav_back')}
              </button>
            </div>
          ) : (
            <video
              ref={videoRef}
              className="w-full h-full"
              controls
              playsInline
            />
          )}
        </div>
      </div>
    </div>
  )
}
