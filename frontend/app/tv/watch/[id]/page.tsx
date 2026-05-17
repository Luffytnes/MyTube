'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { ArrowLeft, Radio, Film, Star } from 'lucide-react'
import { useRegion } from '@/lib/regionContext'
import { toggleTvFavorite, isTvFavorite, type TvFavoriteType } from '@/lib/tvFavorites'
import { saveContinue, getContinueWatching, cleanSeriesIfComplete } from '@/lib/tvContinueWatching'
import TvVideoPlayer from '@/components/tv/TvVideoPlayer'

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
  const playerRef = useRef<any>(null)
  const abortedRef = useRef(false)
  const startOffsetRef = useRef(0)
  const totalDurationRef = useRef(0)

  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [iconErr, setIconErr] = useState(false)
  const [startOffset, setStartOffset] = useState(0)
  const [totalDuration, setTotalDuration] = useState(0)
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
  const positionRef = useRef<number>(0)
  const durationRef = useRef<number>(0)

  function setStartOffsetBoth(val: number) {
    startOffsetRef.current = val
    setStartOffset(val)
  }

  useEffect(() => { setFav(isTvFavorite(id, favType)) }, [id, favType])

  useEffect(() => {
    if (type === 'live') return
    const item = getContinueWatching().find(c => c.id === id)
    resumePositionRef.current = item?.position ?? 0
  }, [id, type])

  useEffect(() => {
    if (type === 'live') return
    fetch(`${API_BASE}/api/iptv/vod_tracks/${id}?ext=${ext}&media=${media}`)
      .then(r => r.json())
      .then((data: TrackList) => { if (data.audio?.length || data.subtitles?.length) setTracks(data) })
      .catch(() => {})
  }, [id, type, ext, media])

  useEffect(() => {
    if (type !== 'live' || !cat) return
    const url = cat === 'tnt'
      ? `${API_BASE}/api/iptv/tnt_channels`
      : `${API_BASE}/api/iptv/channels?category_id=${cat}`
    fetch(url).then(r => r.json()).then((data: QueueChannel[]) => setQueueChannels(Array.isArray(data) ? data : [])).catch(() => {})
  }, [id, cat, type])

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
    const pos = startOffsetRef.current + videoRef.current.currentTime
    const dur = totalDurationRef.current || videoRef.current.duration || 0
    positionRef.current = pos
    durationRef.current = dur
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveContinue({ id, type: 'vod', name, icon, position: positionRef.current, duration: durationRef.current, ext, media,
        ...(seriesId ? { seriesId, season: seriesSeason, seriesName, seriesIcon } : {}) })
      if (seriesId && durationRef.current > 0 && positionRef.current / durationRef.current > 0.95)
        cleanSeriesIfComplete(seriesId, allSeriesEpisodeIdsRef.current)
    }, 5000)
  }, [id, type, name, icon, ext, media, seriesId, seriesSeason, seriesName, seriesIcon])

  const handleNeedNewSession = useCallback(async (absoluteT: number) => {
    const player = playerRef.current
    if (!player || abortedRef.current) return
    const newStart = Math.max(0, Math.floor(absoluteT))
    setStartOffsetBoth(newStart)
    setLoading(true)
    const url = `${API_BASE}/api/iptv/vod_hls2/${id}/playlist.m3u8?ext=${ext}&media=${media}&audio_idx=${audioIdx}&start=${newStart}`
    try {
      await player.load(url)
      if (!abortedRef.current) {
        setLoading(false)
        videoRef.current?.play().catch(() => {})
      }
    } catch (e) {
      console.error('[shaka] seek-to-new-session failed:', e)
      if (!abortedRef.current) setLoading(false)
    }
  }, [id, ext, media, audioIdx])

  useEffect(() => {
    abortedRef.current = false
    setLoading(true)
    setError(null)
    setStartOffsetBoth(0)
    totalDurationRef.current = 0
    setTotalDuration(0)

    let loadTimeout: ReturnType<typeof setTimeout> | null = null
    function clearLoadTimeout() {
      if (loadTimeout) { clearTimeout(loadTimeout); loadTimeout = null }
    }
    function onError() {
      if (abortedRef.current) return
      clearLoadTimeout()
      setError(t('iptv_error'))
      setLoading(false)
    }
    function onReady() {
      clearLoadTimeout()
      setLoading(false)
    }

    let player: any = null

    async function init() {
      const video = videoRef.current
      if (!video || abortedRef.current) return

      loadTimeout = setTimeout(onError, 60000)

      try {
        // Dynamic import — Shaka only runs in the browser
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const shakaModule: any = await import('shaka-player')
        const shaka = shakaModule.default ?? shakaModule
        if (abortedRef.current) return

        shaka.polyfill.installAll()
        if (!shaka.Player.isBrowserSupported()) {
          onError(); return
        }

        player = new shaka.Player()
        playerRef.current = player
        await player.attach(video)
        if (abortedRef.current) return

        player.addEventListener('error', (e: any) => {
          console.error('[shaka]', e.detail)
          onError()
        })

        // One-shot ready handler
        const onCanPlay = () => { onReady(); video.play().catch(() => {}) }
        video.addEventListener('canplay', onCanPlay, { once: true })

        if (type === 'live') {
          await player.load(`${API_BASE}/api/iptv/hls/${id}`)
        } else {
          // Fetch total duration from backend
          try {
            const res = await fetch(`${API_BASE}/api/iptv/vod_stream/${id}?ext=${ext}&media=${media}&audio_idx=${audioIdx}`)
            if (res.ok) {
              const data = await res.json()
              const dur = data.duration ?? 0
              totalDurationRef.current = dur
              setTotalDuration(dur)
            }
          } catch {}
          if (abortedRef.current) return

          // Determine start position (resume or audio-change position)
          const startSec = audioChangePositionRef.current > 0
            ? Math.floor(audioChangePositionRef.current)
            : resumePositionRef.current > 30 ? Math.floor(resumePositionRef.current) : 0
          audioChangePositionRef.current = 0
          setStartOffsetBoth(startSec)

          const hlsUrl = `${API_BASE}/api/iptv/vod_hls2/${id}/playlist.m3u8?ext=${ext}&media=${media}&audio_idx=${audioIdx}&start=${startSec}`
          await player.load(hlsUrl)
        }

        if (!abortedRef.current) video.play().catch(() => {})
      } catch (e: any) {
        if (!abortedRef.current) {
          console.error('[shaka init]', e)
          onError()
        }
      }
    }

    init()

    return () => {
      abortedRef.current = true
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
      player?.destroy().catch?.(() => {})
      playerRef.current = null
      const video = videoRef.current
      if (video) { video.pause(); video.src = '' }
    }
  }, [id, type, ext, media, t, audioIdx])

  const isLive = type === 'live'
  const subUrl = subIdx !== null
    ? `${API_BASE}/api/iptv/vod_subtitle/${id}?ext=${ext}&media=${media}&sub_idx=${subIdx}`
    : null

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
          currentQueueId={id}
          queueTitle={queueTitle}
          onEnded={handleEnded}
          onPrev={handlePrev}
          onNext={handleNext}
          timeOffset={isLive ? 0 : startOffset}
          externalDuration={isLive ? undefined : (totalDuration > 0 ? totalDuration : undefined)}
          onNeedNewSession={isLive ? undefined : handleNeedNewSession}
        />
      </div>
    </div>
  )
}
