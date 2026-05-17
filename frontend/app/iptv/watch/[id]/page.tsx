'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { ArrowLeft, Radio, Film } from 'lucide-react'
import { useRegion } from '@/lib/regionContext'

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
  const playerRef = useRef<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [iconErr, setIconErr] = useState(false)

  useEffect(() => {
    let aborted = false
    let player: any = null

    async function init() {
      const video = videoRef.current
      if (!video) return

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const shakaModule: any = await import('shaka-player')
        const shaka = shakaModule.default ?? shakaModule
        if (aborted) return
        shaka.polyfill.installAll()

        player = new shaka.Player()
        playerRef.current = player
        await player.attach(video)
        if (aborted) return

        player.addEventListener('error', () => {
          if (!aborted) { setError(t('iptv_error')); setLoading(false) }
        })

        video.addEventListener('canplay', () => {
          setLoading(false)
          video.play().catch(() => {})
        }, { once: true })

        if (type === 'live') {
          await player.load(`${API_BASE}/api/iptv/hls/${id}`)
        } else {
          const res = await fetch(`${API_BASE}/api/iptv/vod_stream/${id}?ext=${ext}&media=${media}`)
          if (!res.ok || aborted) throw new Error('stream info failed')
          const data = await res.json()
          if (aborted) return
          const hlsUrl = `${API_BASE}/api/iptv/vod_hls2/${id}/playlist.m3u8?ext=${ext}&media=${media}&audio_idx=0&start=0`
          // Try HLS first, fall back to direct URL from backend if not available
          try {
            await player.load(hlsUrl)
          } catch {
            await player.load(data.url)
          }
        }
        if (!aborted) video.play().catch(() => {})
      } catch (e) {
        if (!aborted) { setError(t('iptv_error')); setLoading(false) }
      }
    }

    init()

    return () => {
      aborted = true
      player?.destroy().catch?.(() => {})
      playerRef.current = null
      const video = videoRef.current
      if (video) { video.pause(); video.src = '' }
    }
  }, [id, type, ext, media, t])

  const isLive = type === 'live'

  return (
    <div className="min-h-screen bg-yt-bg">
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
            <video ref={videoRef} className="w-full h-full" controls playsInline />
          )}
        </div>
      </div>
    </div>
  )
}
