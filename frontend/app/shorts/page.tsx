'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRegion } from '@/lib/regionContext'
import { getVideo } from '@/lib/api'
import type { VideoCard, VideoDetail } from '@/lib/api'
import { ChevronUp, ChevronDown, Volume2, VolumeX, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import type { Translations } from '@/lib/translations'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

const CATEGORIES: { key: string; labelKey: keyof Translations }[] = [
  { key: 'all', labelKey: 'cat_all' },
  { key: 'funny', labelKey: 'cat_entertainment' },
  { key: 'gaming', labelKey: 'cat_gaming' },
  { key: 'music', labelKey: 'cat_music' },
  { key: 'food', labelKey: 'cat_food' },
  { key: 'sports', labelKey: 'cat_sports' },
]

interface ShortPlayerProps {
  short: VideoCard
  detail: VideoDetail | null
  loadingDetail: boolean
  muted: boolean
  onToggleMute: () => void
}

function ShortPlayer({ short, detail, loadingDetail, muted, onToggleMute }: ShortPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const mutedRef = useRef(muted)
  mutedRef.current = muted

  // No itag: let yt-dlp pick the best available format (avoids "format not available" errors)
  const videoUrl = detail ? `${API_BASE}/api/stream/${detail.id}` : null
  // Correct backend route is /api/stream/{id}/audio (not /api/audio/{id})
  const audioUrl = detail ? `${API_BASE}/api/stream/${detail.id}/audio` : null

  useEffect(() => {
    const video = videoRef.current
    if (!video || !videoUrl) return
    video.play().catch(() => {})
  }, [videoUrl])

  useEffect(() => {
    const video = videoRef.current
    const audio = audioRef.current
    if (!video || !audio) return

    function onPlay() {
      const a = audioRef.current
      if (a && !mutedRef.current) a.play().catch(() => {})
    }
    function onPause() {
      const a = audioRef.current
      if (a) a.pause()
    }
    function onTimeUpdate() {
      const a = audioRef.current
      const v = videoRef.current
      if (a && v && !mutedRef.current && Math.abs(a.currentTime - v.currentTime) > 0.5) {
        a.currentTime = v.currentTime
      }
    }
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('timeupdate', onTimeUpdate)
    return () => {
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('timeupdate', onTimeUpdate)
    }
  }, [videoUrl, audioUrl])

  // Synchronous in onClick: gesture context required for audio unlock on first play
  function handleToggleMute() {
    const video = videoRef.current
    const audio = audioRef.current
    const newMuted = !muted
    if (audio) {
      if (!newMuted) {
        if (video) audio.currentTime = video.currentTime
        audio.play().catch(e => console.error('[Shorts] audio.play failed:', (e as Error).name, (e as Error).message))
      } else {
        audio.pause()
      }
    }
    onToggleMute()
  }

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      {/* Blurred background */}
      <img
        src={`https://i.ytimg.com/vi/${short.id}/hqdefault.jpg`}
        alt=""
        className="absolute inset-0 w-full h-full object-cover blur-xl scale-110 opacity-30 pointer-events-none"
        aria-hidden
      />

      {/* Thumbnail placeholder while loading */}
      {(loadingDetail || !videoUrl) && (
        <img
          src={`https://i.ytimg.com/vi/${short.id}/hqdefault.jpg`}
          alt={short.title}
          className="absolute inset-0 w-full h-full object-contain z-10"
        />
      )}

      {/* Loading spinner */}
      {loadingDetail && (
        <div className="absolute inset-0 flex items-center justify-center z-20">
          <div className="w-10 h-10 border-4 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      )}

      {/* Video always muted (autoplay policy). Sound comes from the <audio> element below */}
      {videoUrl && (
        <video
          ref={videoRef}
          src={videoUrl}
          className="absolute inset-0 w-full h-full object-contain z-10"
          loop
          playsInline
          autoPlay
          muted
        />
      )}

      {/* Separate audio (video-only streams). preload="auto" so it's buffered by unmute time */}
      {audioUrl && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio ref={audioRef} src={audioUrl} loop preload="auto" />
      )}

      {/* Mute button — prominent when muted (autoplay requires it) */}
      <button
        onClick={handleToggleMute}
        className={`absolute top-4 right-4 p-2.5 rounded-full text-white z-30 transition-colors ${
          muted ? 'bg-white/20 ring-2 ring-white/60 animate-pulse' : 'bg-black/60 hover:bg-black/80'
        }`}
      >
        {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
      </button>

      {/* Bottom info overlay */}
      <div className="absolute bottom-0 left-0 right-0 z-30 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pt-16 pb-5">
        <div className="flex items-end justify-between gap-3">
          <div className="flex-1 min-w-0">
            <Link href={`/watch/${short.id}`} className="block group">
              <h2 className="text-white font-semibold text-sm leading-snug line-clamp-3 group-hover:underline">
                {short.title}
              </h2>
            </Link>
            {short.channel.name && (
              <Link
                href={short.channel.id ? `/channel/${short.channel.id}` : '#'}
                className="mt-1.5 text-white/70 text-xs hover:text-white transition-colors block truncate"
              >
                {short.channel.name}
              </Link>
            )}
            {short.views && (
              <p className="mt-0.5 text-white/50 text-xs">{short.views}</p>
            )}
          </div>
          <Link
            href={`/watch/${short.id}`}
            className="flex-shrink-0 p-2 bg-black/50 rounded-full text-white/70 hover:text-white hover:bg-black/70 transition-colors"
            title="Regarder en plein écran"
          >
            <ExternalLink className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function ShortsPage() {
  const { t, region, lang } = useRegion()
  const [activeCategory, setActiveCategory] = useState('all')
  const [shorts, setShorts] = useState<VideoCard[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [muted, setMuted] = useState(true)
  const [currentDetail, setCurrentDetail] = useState<VideoDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const detailCache = useRef<Map<string, VideoDetail>>(new Map())
  const touchStartY = useRef(0)
  const shortsRef = useRef<VideoCard[]>([])
  shortsRef.current = shorts

  const loadDetail = useCallback(async (videoId: string, setActive: boolean) => {
    if (detailCache.current.has(videoId)) {
      if (setActive) { setCurrentDetail(detailCache.current.get(videoId)!); setLoadingDetail(false) }
      return
    }
    if (setActive) { setLoadingDetail(true); setCurrentDetail(null) }
    try {
      const d = await getVideo(videoId)
      detailCache.current.set(videoId, d)
      if (setActive) setCurrentDetail(d)
    } catch { /* ignore */ } finally {
      if (setActive) setLoadingDetail(false)
    }
  }, [])

  const load = useCallback(async (category: string) => {
    setLoadingList(true)
    setCurrentIndex(0)
    setCurrentDetail(null)
    detailCache.current.clear()
    try {
      const params = new URLSearchParams({ category, region: region.code, lang })
      const res = await fetch(`/api/yt/shorts?${params}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      const list: VideoCard[] = data.videos ?? []
      setShorts(list)
      if (list[0]) loadDetail(list[0].id, true)
      if (list[1]) loadDetail(list[1].id, false)
    } catch {
      setShorts([])
    } finally {
      setLoadingList(false)
    }
  }, [region.code, lang, loadDetail])

  useEffect(() => { load('all') }, [load])

  // Load detail when index changes
  useEffect(() => {
    const list = shortsRef.current
    if (!list[currentIndex]) return
    loadDetail(list[currentIndex].id, true)
    if (list[currentIndex + 1]) loadDetail(list[currentIndex + 1].id, false)
  }, [currentIndex, loadDetail])

  const goNext = useCallback(() => {
    setCurrentIndex(i => Math.min(i + 1, shortsRef.current.length - 1))
  }, [])

  const goPrev = useCallback(() => {
    setCurrentIndex(i => Math.max(i - 1, 0))
  }, [])

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') { e.preventDefault(); goNext() }
      if (e.key === 'ArrowUp') { e.preventDefault(); goPrev() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goNext, goPrev])

  return (
    <div className="flex flex-col" style={{ height: 'calc(100dvh - 56px)' }}>
      {/* Category chips */}
      <div className="flex-shrink-0 bg-yt-bg border-b border-yt-border/40 px-4 py-2 flex items-center gap-3">
        <h1 className="text-yt-text font-semibold flex-shrink-0 text-base">{t('nav_shorts')}</h1>
        <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {CATEGORIES.map(({ key, labelKey }) => (
            <button
              key={key}
              onClick={() => { setActiveCategory(key); load(key) }}
              className={`flex-shrink-0 px-3 py-1 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                activeCategory === key ? 'bg-yt-text text-yt-bg' : 'bg-yt-secondary text-yt-text hover:bg-yt-hover'
              }`}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {loadingList ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-10 h-10 border-4 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        ) : shorts.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-yt-text-muted">{t('shorts_empty')}</p>
          </div>
        ) : (
          <>
            {/* Video column */}
            <div
              className="flex-1 relative min-w-0"
              onTouchStart={e => { touchStartY.current = e.touches[0].clientY }}
              onTouchEnd={e => {
                const dy = touchStartY.current - e.changedTouches[0].clientY
                if (dy > 60) goNext()
                else if (dy < -60) goPrev()
              }}
            >
              {shorts[currentIndex] && (
                <ShortPlayer
                  key={shorts[currentIndex].id}
                  short={shorts[currentIndex]}
                  detail={currentDetail}
                  loadingDetail={loadingDetail}
                  muted={muted}
                  onToggleMute={() => setMuted(m => !m)}
                />
              )}
            </div>

            {/* Navigation sidebar */}
            <div className="flex-shrink-0 flex flex-col items-center justify-center gap-1 px-2 w-14 bg-yt-bg border-l border-yt-border/40">
              <button
                onClick={goPrev}
                disabled={currentIndex === 0}
                className={`p-2.5 rounded-full transition-colors ${
                  currentIndex === 0
                    ? 'text-yt-text-muted cursor-not-allowed opacity-30'
                    : 'text-yt-text hover:bg-yt-hover'
                }`}
                aria-label="Précédent"
              >
                <ChevronUp className="w-6 h-6" />
              </button>

              <div className="flex flex-col items-center py-1">
                <span className="text-yt-text text-xs font-semibold tabular-nums">{currentIndex + 1}</span>
                <div className="w-4 h-px bg-yt-border my-0.5" />
                <span className="text-yt-text-muted text-xs tabular-nums">{shorts.length}</span>
              </div>

              <button
                onClick={goNext}
                disabled={currentIndex === shorts.length - 1}
                className={`p-2.5 rounded-full transition-colors ${
                  currentIndex === shorts.length - 1
                    ? 'text-yt-text-muted cursor-not-allowed opacity-30'
                    : 'text-yt-text hover:bg-yt-hover'
                }`}
                aria-label="Suivant"
              >
                <ChevronDown className="w-6 h-6" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
