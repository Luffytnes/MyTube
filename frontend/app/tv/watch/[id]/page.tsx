'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { ArrowLeft, Radio, Film, Star } from 'lucide-react'
import { useRegion } from '@/lib/regionContext'
import { toggleTvFavorite, isTvFavorite, type TvFavoriteType } from '@/lib/tvFavorites'
import { saveContinue, getContinueWatching, cleanSeriesIfComplete } from '@/lib/tvContinueWatching'
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
  const allSeriesEpisodeIdsRef = useRef<string[]>([])
  const resumePositionRef = useRef<number>(0)
  const audioChangePositionRef = useRef<number>(0)
  const positionRef = useRef<number>(0)   // last known currentTime — survives ref detach on unmount
  const durationRef = useRef<number>(0)

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
        const allIds = Object.values(data?.episodes || {}).flat().map((e: unknown) => (e as Episode).id)
        allSeriesEpisodeIdsRef.current = allIds
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
    positionRef.current = pos
    durationRef.current = dur
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      const pos = positionRef.current
      const dur = durationRef.current
      saveContinue({ id, type: 'vod', name, icon, position: pos, duration: dur, ext, media,
        ...(seriesId ? { seriesId, season: seriesSeason, seriesName, seriesIcon } : {}) })
      if (seriesId && dur > 0 && pos / dur > 0.95)
        cleanSeriesIfComplete(seriesId, allSeriesEpisodeIdsRef.current)
    }, 5000)
  }, [id, type, name, icon, ext, media])

  const handleSeekToSaved = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    const pos = audioChangePositionRef.current > 0
      ? audioChangePositionRef.current
      : resumePositionRef.current > 30 ? resumePositionRef.current : 0
    if (pos > 0) {
      v.currentTime = pos
      audioChangePositionRef.current = 0
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
      if (aborted) return
      clearLoadTimeout()
      const code = videoRef.current?.error?.code
      setError(code === 4 ? t('iptv_format_unsupported') : t('iptv_error'))
      setLoading(false)
    }

    // MSE path: sets mediaSource.duration for the scrubber and handles seeking.
    // Falls back to video.src if MSE is unavailable or fails before first append.
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
        return false
      }
      if (aborted) return true

      if (duration && duration > 0) {
        try { mediaSource!.duration = duration } catch {}
      }

      const mimeType = MediaSource.isTypeSupported('video/mp4; codecs="avc1.64001E,mp4a.40.2"')
        ? 'video/mp4; codecs="avc1.64001E,mp4a.40.2"'
        : 'video/mp4'
      const sb = mediaSource!.addSourceBuffer(mimeType)

      let eos = false
      let readerRef: ReadableStreamDefaultReader<Uint8Array> | null = null
      let nextSeek: number | null = null

      // SourceBuffer async decode errors: suppress the cascading video 'error' event
      sb.addEventListener('error', () => {
        eos = true
        readerRef?.cancel().catch(() => {})
      })

      video.addEventListener('loadedmetadata', () => { onReady(); handleSeekToSaved() }, { once: true })
      video.addEventListener('canplay', () => { onReady(); video.play().catch(() => {}) }, { once: true })
      video.addEventListener('error', () => { if (!eos) onError() }, { once: true })

      function onSeeking() {
        const target = video.currentTime
        let inBuffer = false
        for (let i = 0; i < video.buffered.length; i++) {
          if (target >= video.buffered.start(i) - 0.5 && target <= video.buffered.end(i) + 0.5) {
            inBuffer = true; break
          }
        }
        if (!inBuffer) {
          nextSeek = target
          readerRef?.cancel().catch(() => {})
        }
      }
      video.addEventListener('seeking', onSeeking)

      // Fetch from startSec (0=start, >0=seek). Returns false only on first-append failure.
      // ffmpeg resets PTS to 0 after -ss seek, so we set timestampOffset to shift
      // the MSE timeline to the correct position.
      async function doFetch(startSec: number): Promise<boolean> {
        const durParam = duration && duration > 0 ? `&duration=${Math.floor(duration)}` : ''
        const fetchUrl = startSec > 0 ? `${url}&start=${Math.floor(startSec)}${durParam}` : url
        const resp = await fetch(fetchUrl, { signal: controller.signal }).catch(() => null)
        if (!resp || aborted) return true
        if (!resp.ok) { onError(); return true }

        const reader = resp.body!.getReader()
        readerRef = reader
        let bytesAppended = 0

        // Shift MSE timeline: backend re-encodes from PTS=0, timestampOffset places it at startSec
        while (sb.updating) await new Promise(r => sb.addEventListener('updateend', r, { once: true }))
        try { sb.timestampOffset = startSec } catch {}

        while (true) {
          if (aborted || nextSeek !== null) break
          let done: boolean; let value: Uint8Array | undefined
          try { ;({ done, value } = await reader.read()) } catch { break }
          if (aborted || nextSeek !== null) break

          if (done) {
            // If the backend stream ended before the episode is fully buffered,
            // continue fetching from the current buffer end without clearing the buffer.
            // This handles: long pause → TCP timeout, ffmpeg early exit, IPTV server EOF.
            const buffEnd = sb.buffered.length > 0 ? sb.buffered.end(sb.buffered.length - 1) : startSec
            const epEnd = duration && duration > 0 ? duration : 0
            // Re-fetch when: duration known + far from end, OR duration unknown + got significant data
            const shouldRefetch = !aborted && bytesAppended > 512 * 1024 && (
              epEnd > 0 ? buffEnd < epEnd - 30 : buffEnd > startSec + 30
            )
            if (shouldRefetch) {
              readerRef = null
              return doFetch(Math.floor(buffEnd))
            }
            if (mediaSource!.readyState === 'open') {
              while (sb.updating) await new Promise(r => sb.addEventListener('updateend', r, { once: true }))
              eos = true
              try { mediaSource!.endOfStream() } catch {}
            }
            break
          }

          while (sb.updating) await new Promise(r => sb.addEventListener('updateend', r, { once: true }))
          if (aborted || nextSeek !== null) break

          // Evict buffered data >30 s behind playhead to prevent QuotaExceededError
          const ct = video.currentTime
          if (sb.buffered.length > 0 && sb.buffered.start(0) < ct - 30) {
            try {
              sb.remove(sb.buffered.start(0), Math.max(sb.buffered.start(0) + 1, ct - 20))
              await new Promise(r => sb.addEventListener('updateend', r, { once: true }))
            } catch {}
          }

          if (aborted || nextSeek !== null) break
          while (sb.updating) await new Promise(r => sb.addEventListener('updateend', r, { once: true }))

          try {
            sb.appendBuffer(value!)
            bytesAppended += value!.byteLength
            await new Promise(r => sb.addEventListener('updateend', r, { once: true }))
          } catch {
            if (bytesAppended === 0 && startSec === 0) {
              // Nothing appended yet — genuine start failure, fall back to direct src
              if (mediaSource!.readyState === 'open') try { mediaSource!.endOfStream('decode') } catch {}
              return false
            }
            // Data was already streaming — stop silently (video stalls, no error overlay)
            break
          }
        }

        readerRef = null
        reader.cancel().catch(() => {})

        if (!aborted && nextSeek !== null) {
          const seekTo = nextSeek
          nextSeek = null
          while (sb.updating) await new Promise(r => sb.addEventListener('updateend', r, { once: true }))
          try {
            if (sb.buffered.length > 0) {
              sb.remove(0, Infinity)
              await new Promise(r => sb.addEventListener('updateend', r, { once: true }))
            }
          } catch {}
          if (!aborted) return doFetch(seekTo)
        }
        return true
      }

      const ok = await doFetch(0)
      video.removeEventListener('seeking', onSeeking)
      return ok
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
      if (type !== 'live') {
        const pos = positionRef.current
        const dur = durationRef.current
        if (pos > 0) audioChangePositionRef.current = pos
        saveContinue({ id, type: 'vod', name, icon, position: pos, duration: dur, ext, media,
        ...(seriesId ? { seriesId, season: seriesSeason, seriesName, seriesIcon } : {}) })
        if (seriesId && dur > 0 && pos / dur > 0.95)
          cleanSeriesIfComplete(seriesId, allSeriesEpisodeIdsRef.current)
      }
      controller.abort()
      hls?.destroy()
      if (mediaSource && mediaSource.readyState === 'open') {
        try { mediaSource.endOfStream() } catch {}
      }
      if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null }
      const video = videoRef.current
      if (video) { video.pause(); video.src = '' }
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

  const currentQueueIdx = queue.findIndex(q => q.id === id)

  const handleEnded = useCallback(() => {
    if (isLive || !queue.length) return
    const next = queue[currentQueueIdx + 1]
    if (next) router.push(next.href)
  }, [isLive, queue, currentQueueIdx, router])

  const handlePrev = !isLive && currentQueueIdx > 0
    ? () => router.push(queue[currentQueueIdx - 1].href)
    : undefined

  const handleNext = !isLive && currentQueueIdx < queue.length - 1
    ? () => router.push(queue[currentQueueIdx + 1].href)
    : undefined

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
          onEnded={handleEnded}
          onPrev={handlePrev}
          onNext={handleNext}
        />
      </div>
    </div>
  )
}
