'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Radio, Film } from 'lucide-react'
import { useRegion } from '@/lib/regionContext'
import Hls from 'hls.js'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export default function IPTVWatchPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const { t } = useRegion()
  const id = params.id as string
  const name = searchParams.get('name') || 'Channel'
  const icon = searchParams.get('icon') || ''
  const type = (searchParams.get('type') || 'live') as 'live' | 'vod'
  const ext = searchParams.get('ext') || 'mp4'
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [iconErr, setIconErr] = useState(false)

  useEffect(() => {
    let hls: Hls | null = null

    async function startStream() {
      try {
        const endpoint = type === 'live'
          ? `${API_BASE}/api/iptv/stream/${id}`
          : `${API_BASE}/api/iptv/vod_stream/${id}?ext=${ext}`
        const res = await fetch(endpoint)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        const url: string = data.url
        // For live: always HLS. For vod: depends on server support (data.hls).
        const useHls = type === 'live' || data.hls !== false

        const video = videoRef.current
        if (!video) return

        if (useHls && Hls.isSupported()) {
          hls = new Hls({ enableWorker: true, lowLatencyMode: type === 'live' })
          hls.loadSource(url)
          hls.attachMedia(video)
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            setLoading(false)
            video.play().catch(() => {})
          })
          hls.on(Hls.Events.ERROR, (_, d) => {
            if (d.fatal) { setError(t('iptv_error')); setLoading(false) }
          })
        } else if (useHls && video.canPlayType('application/vnd.apple.mpegurl')) {
          // Safari native HLS
          video.src = url
          video.addEventListener('loadedmetadata', () => { setLoading(false); video.play().catch(() => {}) })
          video.addEventListener('error', () => { setError(t('iptv_error')); setLoading(false) })
        } else {
          // Direct file (vod_proxy — MP4/MKV streamed through backend)
          video.src = url
          video.addEventListener('loadedmetadata', () => setLoading(false))
          video.addEventListener('canplay', () => { setLoading(false); video.play().catch(() => {}) })
          video.addEventListener('error', () => { setError(t('iptv_error')); setLoading(false) })
        }
      } catch {
        setError(t('iptv_error'))
        setLoading(false)
      }
    }

    startStream()
    return () => { hls?.destroy() }
  }, [id, type, ext, t])

  const isLive = type === 'live'

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-black/80 backdrop-blur-sm">
        <Link href="/iptv" className="p-2 rounded-full hover:bg-white/10 text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        {icon && !iconErr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`${API_BASE}/api/iptv/icon?url=${encodeURIComponent(icon)}`}
            alt={name}
            className="w-8 h-8 object-contain rounded"
            onError={() => setIconErr(true)}
          />
        ) : isLive ? (
          <Radio className="w-6 h-6 text-white" />
        ) : (
          <Film className="w-6 h-6 text-white" />
        )}
        <div>
          <p className="text-white font-semibold text-sm">{name}</p>
          {isLive && (
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs text-gray-400">{t('iptv_live')}</span>
            </div>
          )}
        </div>
      </div>

      {/* Video */}
      <div className="flex-1 relative flex items-center justify-center bg-black">
        {loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-10 h-10 border-2 border-white border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {error && (
          <div className="text-center text-white px-4">
            <p className="text-lg mb-4">{error}</p>
            <Link href="/iptv" className="px-4 py-2 bg-white/20 rounded-full text-sm hover:bg-white/30 transition-colors">
              {t('nav_back')}
            </Link>
          </div>
        )}
        <video
          ref={videoRef}
          className="w-full max-h-[calc(100vh-60px)]"
          controls
          playsInline
          style={{ display: error ? 'none' : 'block' }}
        />
      </div>
    </div>
  )
}
