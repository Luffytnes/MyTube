'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { ArrowLeft, Radio, Film } from 'lucide-react'
import { useRegion } from '@/lib/regionContext'
import TvVideoPlayer from '@/components/tv/TvVideoPlayer'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

interface AudioTrack { index: number; language: string; title: string; codec: string; channels: number }
interface SubTrack { index: number; language: string; title: string; codec: string }
interface TrackList { audio: AudioTrack[]; subtitles: SubTrack[] }

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
  const abortedRef = useRef(false)
  const audioChangePositionRef = useRef<number>(0)
  const positionRef = useRef<number>(0)
  const startOffsetRef = useRef(0)
  const audioIdxRef = useRef(0)
  const [startOffset, setStartOffset] = useState(0)

  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [iconErr, setIconErr] = useState(false)
  const [tracks, setTracks] = useState<TrackList | null>(null)
  const [audioIdx, setAudioIdx] = useState(0)
  const [subIdx, setSubIdx] = useState<number | null>(null)

  // Fetch audio/subtitle tracks for VOD
  useEffect(() => {
    if (type === 'live') return
    fetch(`${API_BASE}/api/iptv/vod_tracks/${id}?ext=${ext}&media=${media}`)
      .then(r => r.json())
      .then((data: TrackList) => { if (data.audio?.length || data.subtitles?.length) setTracks(data) })
      .catch(() => {})
  }, [id, type, ext, media])

  useEffect(() => {
    abortedRef.current = false
    setLoading(true)
    setError(null)
    audioIdxRef.current = 0
    setAudioIdx(0)

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const shakaModule: any = await import('shaka-player')
        const shaka = shakaModule.default ?? shakaModule
        if (abortedRef.current) return

        shaka.polyfill.installAll()
        if (!shaka.Player.isBrowserSupported()) { onError(); return }

        player = new shaka.Player()
        playerRef.current = player
        await player.attach(video)
        if (abortedRef.current) return

        player.addEventListener('error', (e: any) => {
          console.error('[shaka]', e.detail)
          onError()
        })

        const onCanPlay = () => { onReady(); video.play().catch(() => {}) }
        video.addEventListener('canplay', onCanPlay, { once: true })

        if (type === 'live') {
          await player.load(`${API_BASE}/api/iptv/hls/${id}`)
        } else {
          const startSec = audioChangePositionRef.current > 0 ? Math.floor(audioChangePositionRef.current) : 0
          audioChangePositionRef.current = 0
          startOffsetRef.current = startSec
          setStartOffset(startSec)
          const hlsUrl = `${API_BASE}/api/iptv/vod_hls2/${id}/playlist.m3u8?ext=${ext}&media=${media}&audio_idx=${audioIdxRef.current}&start=${startSec}`
          try {
            await player.load(hlsUrl)
          } catch {
            const res = await fetch(`${API_BASE}/api/iptv/vod_stream/${id}?ext=${ext}&media=${media}`)
            if (res.ok) {
              const data = await res.json()
              await player.load(data.url)
            } else {
              throw new Error('stream failed')
            }
          }
        }

        if (!abortedRef.current) video.play().catch(() => {})
      } catch (e: any) {
        if (!abortedRef.current) { console.error('[shaka init]', e); onError() }
      }
    }

    init()

    return () => {
      abortedRef.current = true
      clearLoadTimeout()
      if (type !== 'live') {
        const pos = positionRef.current
        if (pos > 0) audioChangePositionRef.current = pos
      }
      player?.destroy().catch?.(() => {})
      playerRef.current = null
      const video = videoRef.current
      if (video) { video.pause(); video.src = '' }
    }
  }, [id, type, ext, media, t])

  const handleAudioChange = useCallback(async (newIdx: number) => {
    if (type === 'live') return
    const player = playerRef.current
    const video = videoRef.current
    if (!player || !video) return
    audioIdxRef.current = newIdx
    setAudioIdx(newIdx)
    const startSec = Math.floor(Math.max(0, positionRef.current))
    startOffsetRef.current = startSec
    setStartOffset(startSec)
    setLoading(true)
    const url = `${API_BASE}/api/iptv/vod_hls2/${id}/playlist.m3u8?ext=${ext}&media=${media}&audio_idx=${newIdx}&start=${startSec}`
    try {
      await player.load(url)
      if (!abortedRef.current) { setLoading(false); video.play().catch(() => {}) }
    } catch {
      if (!abortedRef.current) setLoading(false)
    }
  }, [id, type, ext, media])

  const subUrl = type !== 'live' && subIdx !== null
    ? `${API_BASE}/api/iptv/vod_subtitle/${id}?ext=${ext}&media=${media}&sub_idx=${subIdx}`
    : null

  const handleTimeUpdate = useCallback(() => {
    if (type === 'live' || !videoRef.current) return
    positionRef.current = startOffsetRef.current + videoRef.current.currentTime
  }, [type])

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
        <div className="flex-1 min-w-0">
          <p className="text-yt-text font-semibold text-sm truncate">{name}</p>
          {isLive && (
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs text-yt-text-muted">{t('iptv_live')}</span>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 pt-6 pb-2">
        <TvVideoPlayer
          videoRef={videoRef}
          loading={loading}
          error={error}
          onErrorBack={() => router.back()}
          title={name}
          audioTracks={tracks?.audio ?? []}
          subTracks={tracks?.subtitles ?? []}
          audioIdx={audioIdx}
          subIdx={subIdx}
          subUrl={subUrl}
          onAudioChange={handleAudioChange}
          onSubChange={setSubIdx}
          onTimeUpdate={handleTimeUpdate}
          timeOffset={startOffset}
        />
      </div>
    </div>
  )
}
