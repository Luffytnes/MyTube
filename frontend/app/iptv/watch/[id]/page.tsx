'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Radio } from 'lucide-react'
import { useRegion } from '@/lib/regionContext'
import Hls from 'hls.js'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export default function IPTVWatchPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const { t } = useRegion()
  const channelId = params.id as string
  const name = searchParams.get('name') || 'Channel'
  const icon = searchParams.get('icon') || ''
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let hls: Hls | null = null

    async function startStream() {
      try {
        const res = await fetch(`${API_BASE}/api/iptv/stream/${channelId}`)
        if (!res.ok) throw new Error()
        const { url } = await res.json()
        const video = videoRef.current
        if (!video) return

        if (Hls.isSupported()) {
          hls = new Hls({ enableWorker: true, lowLatencyMode: true })
          hls.loadSource(url)
          hls.attachMedia(video)
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            setLoading(false)
            video.play().catch(() => {})
          })
          hls.on(Hls.Events.ERROR, (_, data) => {
            if (data.fatal) setError(t('iptv_error'))
          })
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = url
          video.addEventListener('loadedmetadata', () => {
            setLoading(false)
            video.play().catch(() => {})
          })
        }
      } catch {
        setError(t('iptv_error'))
        setLoading(false)
      }
    }

    startStream()
    return () => { hls?.destroy() }
  }, [channelId, t])

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-black/80 backdrop-blur-sm">
        <Link href="/iptv" className="p-2 rounded-full hover:bg-white/10 text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        {icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={icon} alt={name} className="w-8 h-8 object-contain rounded" onError={e => { (e.target as HTMLImageElement).style.display='none' }} />
        ) : (
          <Radio className="w-6 h-6 text-white" />
        )}
        <div>
          <p className="text-white font-semibold text-sm">{name}</p>
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs text-gray-400">{t('iptv_live')}</span>
          </div>
        </div>
      </div>

      {/* Video */}
      <div className="flex-1 relative flex items-center justify-center">
        {loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-10 h-10 border-2 border-white border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {error && (
          <div className="text-center text-white">
            <p className="text-lg mb-4">{error}</p>
            <Link href="/iptv" className="px-4 py-2 bg-white/20 rounded-full text-sm hover:bg-white/30 transition-colors">
              {t('nav_back')}
            </Link>
          </div>
        )}
        <video
          ref={videoRef}
          className="w-full max-h-[calc(100vh-120px)]"
          controls
          playsInline
          style={{ display: error ? 'none' : 'block' }}
        />
      </div>
    </div>
  )
}
