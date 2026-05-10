'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { ArrowLeft, Radio, Film, Star } from 'lucide-react'
import { useRegion } from '@/lib/regionContext'
import { toggleTvFavorite, isTvFavorite, type TvFavoriteType } from '@/lib/tvFavorites'
import { saveContinue, getContinueWatching } from '@/lib/tvContinueWatching'
import TvVideoPlayer from '@/components/tv/TvVideoPlayer'
import Hls from 'hls.js'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

interface AudioTrack { index: number; language: string; title: string; codec: string; channels: number }
interface SubTrack { index: number; language: string; title: string; codec: string }
interface TrackList { audio: AudioTrack[]; subtitles: SubTrack[] }
interface QueueChannel { stream_id: number; name: string; stream_icon: string; tnt_name?: string }
interface Episode {
  id: string; title: string; episode_num: number; container_extension: string
  info: { duration?: string; plot?: string; movie_image?: string }
}


export default function TvWatchPage() {
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
  const cat = searchParams.get('cat') || ''
  const seriesId = searchParams.get('series_id') || ''
  const seriesSeason = searchParams.get('season') || ''
  const seriesName = searchParams.get('series_name') || ''
  const seriesIcon = searchParams.get('series_icon') || ''

  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [iconErr, setIconErr] = useState(false)
  const favType: TvFavoriteType = type === 'live' ? 'live' : 'vod'
  const [fav, setFav] = useState(false)
  const [tracks, setTracks] = useState<TrackList | null>(null)
  const [audioIdx, setAudioIdx] = useState(0)
  const [subIdx, setSubIdx] = useState<number | null>(null)
  const [queueChannels, setQueueChannels] = useState<QueueChannel[]>([])
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resumePositionRef = useRef<number>(0)

  useEffect(() => { setFav(isTvFavorite(id, favType)) }, [id, favType])

  // Resume position for VOD
  useEffect(() => {
    if (type === 'live') return
    const item = getContinueWatching().find(c => c.id === id)
    resumePositionRef.current = item?.position ?? 0
  }, [id, type])

  // Audio/subtitle tracks for VOD
  useEffect(() => {
    if (type === 'live') return
    fetch(`${API_BASE}/api/iptv/vod_tracks/${id}?ext=${ext}&media=${media}`)
      .then(r => r.json())
      .then((data: TrackList) => { if (data.audio?.length || data.subtitles?.length) setTracks(data) })
      .catch(() => {})
  }, [id, type, ext, media])

  // Channel queue for live channels
  useEffect(() => {
    if (type !== 'live' || !cat) return
    const url = cat === 'tnt'
      ? `${API_BASE}/api/iptv/tnt_channels`
      : `${API_BASE}/api/iptv/channels?category_id=${cat}`
    fetch(url).then(r => r.json()).then((data: QueueChannel[]) => setQueueChannels(Array.isArray(data) ? data : [])).catch(() => {})
  }, [id, cat, type])

  // Episode list for series
  useEffect(() => {
    if (!seriesId || !seriesSeason) return
    fetch(`${API_BASE}/api/iptv/series_info/${seriesId}`)
      .then(r => r.json())
      .then(data => {
        const eps: Episode[] = data?.episodes?.[seriesSeason] || []
        setEpisodes(eps)
      })
      .catch(() => {})
  }, [seriesId, seriesSeason])

  function toggleFav() {
    const next = toggleTvFavorite({ id, type: favType, name, icon, ext, media })
    setFav(next)
    window.dispatchEvent(new Event('focus'))
  }

  const handleTimeUpdate = useCallback(() => {
    if (type === 'live' || !videoRef.current) return
    const pos = videoRef.current.currentTime
    const dur = videoRef.current.duration || 0
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveContinue({ id, type: 'vod', name, icon, position: pos, duration: dur, ext, media })
    }, 5000)
  }, [id, type, name, icon, ext, media])

  const handleSeekToSaved = useCallback(() => {
    if (resumePositionRef.current > 30 && videoRef.current) {
      videoRef.current.currentTime = resumePositionRef.current
      resumePositionRef.current = 0
    }
  }, [])

  useEffect(() => {
    let hls: Hls | null = null
    let aborted = false
    let mediaSource: MediaSource | null = null
    let objectUrl: string | null = null
    const controller = new AbortController()
    let loadTimeout: ReturnType<typeof setTimeout> | null = null

    function clearLoadTimeout() {
      if (loadTimeout) { clearTimeout(loadTimeout); loadTimeout = null }
    }
    function onReady() { clearLoadTimeout(); setLoading(false) }
    function onError() {
      clearLoadTimeout()
      const code = videoRef.current?.error?.code
      setError(code === 4 ? t('iptv_format_unsupported') : t('iptv_error'))
      setLoading(false)
    }

    // MSE path: lets us set mediaSource.duration so the scrubber shows the total runtime.
    // Falls back to video.src on any failure (sourceopen timeout, appendBuffer error, etc.)
    async function startMSE(video: HTMLVideoElement, url: string, duration: number | null): Promise<boolean> {
      mediaSource = new MediaSource()
      objectUrl = URL.createObjectURL(mediaSource)
      video.src = objectUrl

      try {
        await new Promise<void>((resolve, reject) => {
          mediaSource!.addEventListener('sourceopen', () => resolve(), { once: true })
          setTimeout(() => reject(new Error('sourceopen timeout')), 8000)
        })
      } catch {
        return false  // sourceopen timed out → caller falls back to video.src
      }
      if (aborted) return true

      if (duration && duration > 0) {
        try { mediaSource!.duration = duration } catch {}
      }

      const mimeType = MediaSource.isTypeSupported('video/mp4; codecs="avc1.64001E,mp4a.40.2"')
        ? 'video/mp4; codecs="avc1.64001E,mp4a.40.2"'
        : 'video/mp4'
      const sb = mediaSource!.addSourceBuffer(mimeType)

      video.addEventListener('loadedmetadata', () => { onReady(); handleSeekToSaved() }, { once: true })
      video.addEventListener('canplay', () => { onReady(); video.play().catch(() => {}) }, { once: true })
      video.addEventListener('error', onError, { once: true })

      const resp = await fetch(url, { signal: controller.signal })
      if (aborted) return true
      if (!resp.ok) { onError(); return true }

      const reader = resp.body!.getReader()
      let bytesAppended = 0

      while (true) {
        if (aborted) break
        const { done, value } = await reader.read()
        if (aborted) break
        if (done) {
          if (mediaSource!.readyState === 'open') {
            while (sb.updating) await new Promise(r => sb.addEventListener('updateend', r, { once: true }))
            try { mediaSource!.endOfStream() } catch {}
          }
          break
        }
        while (sb.updating) await new Promise(r => sb.addEventListener('updateend', r, { once: true }))
        try {
          sb.appendBuffer(value)
          bytesAppended += value.byteLength
          await new Promise(r => sb.addEventListener('updateend', r, { once: true }))
        } catch {
          // appendBuffer failed — revoke objectUrl so video.src falls back cleanly
          if (mediaSource!.readyState === 'open') try { mediaSource!.endOfStream('decode') } catch {}
          if (bytesAppended === 0) return false  // nothing appended yet → try video.src
          break  // partial data appended, error event will fire via onError
        }
      }
      return true
    }

    async function startStream() {
      setError(null)
      setLoading(true)
      loadTimeout = setTimeout(() => { setError(t('iptv_error')); setLoading(false) }, 60000)
      try {
        const endpoint = type === 'live'
          ? `${API_BASE}/api/iptv/stream/${id}`
          : `${API_BASE}/api/iptv/vod_stream/${id}?ext=${ext}&media=${media}&audio_idx=${audioIdx}`
        const res = await fetch(endpoint, { signal: controller.signal })
        if (aborted) return
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (aborted) return
        const url: string = data.url
        const duration: number | null = data.duration ?? null
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
          video.addEventListener('loadedmetadata', () => { onReady(); handleSeekToSaved(); video.play().catch(() => {}) }, { once: true })
          video.addEventListener('error', onError, { once: true })
        } else if (typeof MediaSource !== 'undefined') {
          // Try MSE first (allows setting total duration for scrubber bar)
          const mseHandled = await startMSE(video, url, duration)
          if (!mseHandled && !aborted) {
            // MSE failed before appending anything → fall back to direct video.src
            if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null }
            video.src = url
            video.addEventListener('loadedmetadata', () => { onReady(); handleSeekToSaved() }, { once: true })
            video.addEventListener('canplay', () => { onReady(); video.play().catch(() => {}) }, { once: true })
            video.addEventListener('error', onError, { once: true })
          }
        } else {
          video.src = url
          video.addEventListener('loadedmetadata', () => { onReady(); handleSeekToSaved() }, { once: true })
          video.addEventListener('canplay', () => { onReady(); video.play().catch(() => {}) }, { once: true })
          video.addEventListener('error', onError, { once: true })
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
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      controller.abort()
      hls?.destroy()
      if (mediaSource && mediaSource.readyState === 'open') {
        try { mediaSource.endOfStream() } catch {}
      }
      if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null }
      const video = videoRef.current
      if (video) { video.pause(); video.src = ''; video.load() }
    }
  }, [id, type, ext, media, t, audioIdx, handleSeekToSaved])

  const isLive = type === 'live'
  const subUrl = subIdx !== null
    ? `${API_BASE}/api/iptv/vod_subtitle/${id}?ext=${ext}&media=${media}&sub_idx=${subIdx}`
    : null

  // Build playlist for the player
  const queue: { id: string; label: string; sublabel?: string; href: string; icon?: string }[] = isLive
    ? queueChannels.map(ch => ({
        id: String(ch.stream_id),
        label: ch.tnt_name || ch.name,
        href: `/tv/watch/${ch.stream_id}?type=live&cat=${encodeURIComponent(cat)}&name=${encodeURIComponent(ch.name)}&icon=${encodeURIComponent(ch.stream_icon || '')}`,
        icon: ch.stream_icon ? `${API_BASE}/api/iptv/icon?url=${encodeURIComponent(ch.stream_icon)}` : undefined,
      }))
    : [...episodes]
        .sort((a, b) => a.episode_num - b.episode_num)
        .map(ep => {
          const epName = `${seriesName || name} — Ép.${ep.episode_num}${ep.title && ep.title !== String(ep.episode_num) ? ` — ${ep.title}` : ''}`
          return {
            id: ep.id,
            label: `Ép. ${ep.episode_num}${ep.title && ep.title !== String(ep.episode_num) ? ` — ${ep.title}` : ''}`,
            sublabel: ep.info?.duration,
            href: `/tv/watch/${ep.id}?type=vod&media=series&ext=${ep.container_extension || 'mp4'}&name=${encodeURIComponent(epName)}&icon=${encodeURIComponent(seriesIcon || icon)}&series_id=${seriesId}&season=${seriesSeason}&series_name=${encodeURIComponent(seriesName || name)}&series_icon=${encodeURIComponent(seriesIcon || icon)}`,
          }
        })

  const queueTitle = isLive ? 'Chaînes' : seriesSeason ? `Saison ${seriesSeason}` : 'Épisodes'

  return (
    <div className="min-h-screen bg-yt-bg">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-yt-secondary border-b border-yt-border">
        <button onClick={() => router.back()} className="p-2 rounded-full hover:bg-yt-hover text-yt-text transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        {icon && !iconErr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`${API_BASE}/api/iptv/icon?url=${encodeURIComponent(icon)}`} alt={name} className="w-8 h-8 object-contain rounded" onError={() => setIconErr(true)} />
        ) : isLive ? <Radio className="w-6 h-6 text-yt-text" /> : <Film className="w-6 h-6 text-yt-text" />}
        <div className="flex-1 min-w-0">
          <p className="text-yt-text font-semibold text-sm truncate">{name}</p>
          {isLive && (
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs text-yt-text-muted">{t('iptv_live')}</span>
            </div>
          )}
        </div>
        <button
          onClick={toggleFav}
          className={`p-2 rounded-full transition-colors ${fav ? 'text-yt-red' : 'text-yt-text-muted hover:text-yt-text'}`}
          title={fav ? 'Retirer des favoris' : 'Ajouter aux favoris'}
        >
          <Star className={`w-5 h-5 ${fav ? 'fill-current' : ''}`} />
        </button>
      </div>

      {/* Video player — queue panel is inside the player */}
      <div className="max-w-4xl mx-auto px-4 pt-6 pb-2">
        <TvVideoPlayer
          videoRef={videoRef}
          loading={loading}
          error={error}
          onErrorBack={() => router.back()}
          subUrl={subUrl}
          audioTracks={tracks?.audio ?? []}
          subTracks={tracks?.subtitles ?? []}
          audioIdx={audioIdx}
          subIdx={subIdx}
          onAudioChange={setAudioIdx}
          onSubChange={setSubIdx}
          onTimeUpdate={handleTimeUpdate}
          queue={queue}
          currentQueueId={isLive ? id : id}
          queueTitle={queueTitle}
        />
      </div>
    </div>
  )
}
