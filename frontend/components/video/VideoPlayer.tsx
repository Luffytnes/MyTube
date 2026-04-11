'use client'

import {
  useRef,
  useState,
  useEffect,
  useCallback,
  ChangeEvent,
} from 'react'
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Settings,
  Radio,
} from 'lucide-react'
import { formatDuration } from '@/lib/utils'
import { getStreamUrl, getAudioUrl, type VideoFormat } from '@/lib/api'
import { useRegion } from '@/lib/regionContext'
import { getPlaybackSettings } from '@/lib/playbackSettings'
import { savePosition, getPosition } from '@/lib/resumePosition'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface VideoPlayerProps {
  videoId: string
  formats: VideoFormat[]
  title: string
  isLive?: boolean
}

// Quality label for a Shaka variant track
function shakaTrackLabel(track: { height?: number; bandwidth: number }): string {
  if (track.height) return `${track.height}p`
  return `${Math.round(track.bandwidth / 1000)}k`
}

function getBestFormat(formats: VideoFormat[]): VideoFormat | null {
  if (!formats || formats.length === 0) return null
  const { defaultQuality } = getPlaybackSettings()

  if (defaultQuality !== 'auto') {
    const targetHeight = parseInt(defaultQuality.replace('p', ''), 10)
    const getHeight = (f: VideoFormat) =>
      f.height ?? parseInt(f.quality?.replace('p', '') ?? '0', 10)

    const videoFormats = formats.filter((f) => f.hasVideo)
    if (videoFormats.length > 0) {
      const sorted = [...videoFormats].sort((a, b) => {
        const da = Math.abs(getHeight(a) - targetHeight)
        const db = Math.abs(getHeight(b) - targetHeight)
        if (da !== db) return da - db
        if (a.hasAudio && !b.hasAudio) return -1
        if (!a.hasAudio && b.hasAudio) return 1
        return 0
      })
      return sorted[0]
    }
  }

  const combined = formats.filter((f) => f.hasVideo && f.hasAudio)
  if (combined.length > 0) return combined[0]
  const videoOnly = formats.filter((f) => f.hasVideo)
  if (videoOnly.length > 0) return videoOnly[0]
  return formats[0]
}

export default function VideoPlayer({ videoId, formats, title, isLive }: VideoPlayerProps) {
  const { t } = useRegion()
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hlsRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shakaRef = useRef<any>(null)

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolume] = useState(() => getPlaybackSettings().defaultVolume)
  const [muted, setMuted] = useState(false)
  const [speed, setSpeed] = useState(() => getPlaybackSettings().defaultSpeed)
  const [showSpeedMenu, setShowSpeedMenu] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [showQualityMenu, setShowQualityMenu] = useState(false)
  // DASH mode quality tracks from Shaka
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [dashTracks, setDashTracks] = useState<any[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [selectedDashTrack, setSelectedDashTrack] = useState<any>(null)
  const [dashReady, setDashReady] = useState(false)
  // Fallback: use legacy dual-stream when DASH fails
  const [selectedFormat, setSelectedFormat] = useState<VideoFormat | null>(null)
  const [useDash, setUseDash] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const savePositionTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  // One entry per resolution ≥240p, prefer combined (audio+video) at each height.
  const allVideoFormats = (() => {
    const getHeight = (f: VideoFormat) =>
      f.height ?? parseInt(f.quality?.replace('p', '') ?? '0', 10) ?? 0

    const byHeight = new Map<number, VideoFormat>()
    for (const f of formats) {
      if (!f.hasVideo) continue
      const h = getHeight(f)
      if (h < 240) continue
      const existing = byHeight.get(h)
      if (!existing || (!existing.hasAudio && f.hasAudio)) {
        byHeight.set(h, f)
      }
    }
    return Array.from(byHeight.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([, f]) => f)
  })()

  // ── Reset on videoId change ──────────────────────────────────────────────
  useEffect(() => {
    const settings = getPlaybackSettings()
    setSelectedFormat(getBestFormat(allVideoFormats))
    setError(null)
    setLoading(true)
    setPlaying(false)
    setCurrentTime(0)
    setDashReady(false)
    setDashTracks([])
    setSelectedDashTrack(null)
    setUseDash(false)
    setSpeed(settings.defaultSpeed)
    setVolume(settings.defaultVolume)

    const video = videoRef.current
    if (video) {
      video.volume = settings.defaultVolume
      video.playbackRate = settings.defaultSpeed
    }

    if (savePositionTimer.current) clearInterval(savePositionTimer.current)
    if (settings.resumePlayback) {
      savePositionTimer.current = setInterval(() => {
        const v = videoRef.current
        if (v && !v.paused && v.duration > 0) {
          savePosition(videoId, v.currentTime, v.duration)
        }
      }, 5000)
    }
    return () => {
      if (savePositionTimer.current) clearInterval(savePositionTimer.current)
    }
  }, [videoId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── HLS setup for live streams ───────────────────────────────────────────
  useEffect(() => {
    if (!isLive) return
    const video = videoRef.current
    if (!video) return

    let cancelled = false

    async function setupLive() {
      try {
        const res = await fetch(`${API_BASE}/api/live/${videoId}`)
        if (!res.ok) throw new Error('Failed to get live URL')
        const { url: rawUrl, type } = await res.json()
        const url = rawUrl.startsWith('/') ? `${API_BASE}${rawUrl}` : rawUrl
        if (cancelled || !video) return

        if (type === 'mp4' || video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = url
          setLoading(false)
          return
        }

        const { default: Hls } = await import('hls.js')
        if (cancelled) return
        if (!Hls.isSupported()) {
          setError('Live streaming is not supported in this browser.')
          return
        }
        const hls = new Hls({ enableWorker: false })
        hlsRef.current = hls
        hls.loadSource(url)
        hls.attachMedia(video)
        hls.on(Hls.Events.MANIFEST_PARSED, () => { setLoading(false) })
        hls.on(Hls.Events.ERROR, (_: unknown, data: { fatal: boolean; details: string }) => {
          if (data.fatal) setError(`Live stream error: ${data.details}`)
        })
      } catch {
        if (!cancelled) setError('Failed to load live stream.')
      }
    }

    setupLive()
    return () => {
      cancelled = true
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
    }
  }, [videoId, isLive])

  // ── DASH setup via Shaka Player (non-live only) ──────────────────────────
  useEffect(() => {
    if (isLive) return
    const video = videoRef.current as HTMLVideoElement | null
    if (!video) return

    let cancelled = false

    async function setupDash() {
      try {
        // Dynamically import Shaka (browser-only)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const shaka: any = await import('shaka-player')
        if (cancelled) return

        shaka.polyfill.installAll()

        if (!shaka.Player.isBrowserSupported()) {
          // Browser doesn't support DASH MSE — fall back to legacy player
          setUseDash(false)
          return
        }

        // Destroy previous Shaka instance
        if (shakaRef.current) {
          await shakaRef.current.destroy()
          shakaRef.current = null
        }

        const player = new shaka.Player()
        await player.attach(video)
        shakaRef.current = player

        const settings = getPlaybackSettings()

        // Configure ABR based on defaultQuality
        if (settings.defaultQuality !== 'auto') {
          player.configure({ abr: { enabled: false } })
        } else {
          player.configure({ abr: { enabled: true } })
        }

        player.addEventListener('error', (event: { detail: { code: number } }) => {
          console.error('Shaka error', event.detail)
          if (!cancelled) {
            // Fall back to legacy player on Shaka error
            setUseDash(false)
            setError(null)
          }
        })

        const manifestUrl = `${API_BASE}/api/dash/${videoId}.mpd`
        await player.load(manifestUrl)
        if (cancelled) return

        // Re-check video ref after async operations
        const v = videoRef.current
        if (!v) return

        // Apply playback settings
        v.volume = settings.defaultVolume
        v.playbackRate = settings.defaultSpeed
        setVolume(settings.defaultVolume)
        setSpeed(settings.defaultSpeed)

        // Resume position
        if (settings.resumePlayback) {
          const pos = getPosition(videoId)
          if (pos && pos > 0 && v.duration > 0 && pos < v.duration * 0.95) {
            v.currentTime = pos
          }
        }

        // Build quality track list from Shaka variant tracks (video only)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const variants: any[] = player.getVariantTracks()
        // Deduplicate by height, keep highest bandwidth at each height
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const byHeight = new Map<number, any>()
        for (const t of variants) {
          const h = t.height || 0
          if (h < 240) continue
          const existing = byHeight.get(h)
          if (!existing || t.bandwidth > existing.bandwidth) {
            byHeight.set(h, t)
          }
        }
        const tracks = Array.from(byHeight.entries())
          .sort((a, b) => b[0] - a[0])
          .map(([, t]) => t)

        setDashTracks(tracks)

        // Apply preferred quality
        if (settings.defaultQuality !== 'auto' && tracks.length > 0) {
          const targetH = parseInt(settings.defaultQuality.replace('p', ''), 10)
          const best = tracks.reduce((prev, curr) =>
            Math.abs(curr.height - targetH) < Math.abs(prev.height - targetH) ? curr : prev
          )
          player.selectVariantTrack(best, /* clearBuffer */ true)
          setSelectedDashTrack(best)
        } else if (tracks.length > 0) {
          setSelectedDashTrack(tracks[0])
        }

        setUseDash(true)
        setDashReady(true)
        setLoading(false)
      } catch (err) {
        if (!cancelled) {
          console.warn('DASH setup failed, falling back to legacy player', err)
          setUseDash(false)
          setDashReady(false)
          // Don't set error — let the legacy <video src> handle it
        }
      }
    }

    setupDash()

    return () => {
      cancelled = true
      if (shakaRef.current) {
        shakaRef.current.destroy()
        shakaRef.current = null
      }
    }
  }, [videoId, isLive]) // eslint-disable-line react-hooks/exhaustive-deps

  // Legacy dual-stream: src URL derived from selectedFormat
  const isVideoOnly = !useDash && !!(selectedFormat && !selectedFormat.hasAudio)
  const streamUrl = selectedFormat
    ? getStreamUrl(videoId, String(selectedFormat.itag))
    : getStreamUrl(videoId)
  const audioSrc = isVideoOnly ? getAudioUrl(videoId) : null

  const resetHideTimer = useCallback(() => {
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current)
    setShowControls(true)
    hideControlsTimer.current = setTimeout(() => {
      if (playing) setShowControls(false)
    }, 3000)
  }, [playing])

  useEffect(() => {
    return () => { if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current) }
  }, [])

  useEffect(() => {
    function onFsChange() { setFullscreen(!!document.fullscreenElement) }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  useEffect(() => {
    function handleKey(e: globalThis.KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const video = videoRef.current
      if (!video) return
      switch (e.key) {
        case ' ': case 'k': e.preventDefault(); togglePlay(); break
        case 'f': e.preventDefault(); toggleFullscreen(); break
        case 'ArrowRight': e.preventDefault(); video.currentTime = Math.min(video.duration, video.currentTime + 5); break
        case 'ArrowLeft': e.preventDefault(); video.currentTime = Math.max(0, video.currentTime - 5); break
        case 'ArrowUp': e.preventDefault(); video.volume = Math.min(1, video.volume + 0.1); setVolume(video.volume); break
        case 'ArrowDown': e.preventDefault(); video.volume = Math.max(0, video.volume - 0.1); setVolume(video.volume); break
        case 'm': e.preventDefault(); toggleMute(); break
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  const safePlay = (el: HTMLVideoElement | HTMLAudioElement | null) => {
    el?.play().catch(() => {})
  }

  function togglePlay() {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      safePlay(video)
      if (!useDash) safePlay(audioRef.current)
    } else {
      video.pause()
      if (!useDash) audioRef.current?.pause()
    }
    resetHideTimer()
  }

  function toggleMute() {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    if (!useDash && audioRef.current) audioRef.current.muted = video.muted
    setMuted(video.muted)
  }

  function toggleFullscreen() {
    const container = containerRef.current
    if (!container) return
    if (!document.fullscreenElement) {
      container.requestFullscreen()
    } else {
      document.exitFullscreen()
    }
  }

  function handleTimeUpdate() {
    const video = videoRef.current
    if (!video) return
    setCurrentTime(video.currentTime)
    if (video.buffered.length > 0) setBuffered(video.buffered.end(video.buffered.length - 1))
    if (!useDash) {
      const audio = audioRef.current
      if (audio && !audio.paused && Math.abs(audio.currentTime - video.currentTime) > 0.3) {
        audio.currentTime = video.currentTime
      }
    }
  }

  function handleLoadedMetadata() {
    const video = videoRef.current
    if (!video) return
    const settings = getPlaybackSettings()
    setDuration(video.duration)
    if (!useDash) {
      setLoading(false)
      video.volume = settings.defaultVolume
      video.playbackRate = settings.defaultSpeed
      setVolume(settings.defaultVolume)
      setSpeed(settings.defaultSpeed)
      if (settings.resumePlayback) {
        const pos = getPosition(videoId)
        if (pos && pos > 0 && pos < video.duration * 0.95) {
          video.currentTime = pos
          if (audioRef.current) audioRef.current.currentTime = pos
        }
      }
    }
  }

  function handleSeek(e: ChangeEvent<HTMLInputElement>) {
    const video = videoRef.current
    if (!video) return
    const time = (parseFloat(e.target.value) / 100) * video.duration
    video.currentTime = time
    setCurrentTime(time)
  }

  function handleVolumeChange(e: ChangeEvent<HTMLInputElement>) {
    const video = videoRef.current
    if (!video) return
    const vol = parseFloat(e.target.value)
    video.volume = vol
    if (!useDash && audioRef.current) audioRef.current.volume = vol
    setVolume(vol)
    if (vol === 0) {
      video.muted = true
      if (!useDash && audioRef.current) audioRef.current.muted = true
      setMuted(true)
    } else if (muted) {
      video.muted = false
      if (!useDash && audioRef.current) audioRef.current.muted = false
      setMuted(false)
    }
  }

  // Legacy quality selector (used when DASH is not active)
  function selectQuality(fmt: VideoFormat) {
    const video = videoRef.current
    const wasPlaying = video && !video.paused
    const savedTime = video ? video.currentTime : 0
    setSelectedFormat(fmt)
    setShowQualityMenu(false)
    setLoading(true)
    setError(null)
    setTimeout(() => {
      if (video) {
        video.currentTime = savedTime
        if (audioRef.current) audioRef.current.currentTime = savedTime
        if (wasPlaying) {
          safePlay(video)
          safePlay(audioRef.current)
        }
      }
    }, 300)
  }

  // DASH quality selector via Shaka
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function selectDashQuality(track: any) {
    if (!shakaRef.current) return
    shakaRef.current.configure({ abr: { enabled: false } })
    shakaRef.current.selectVariantTrack(track, /* clearBuffer */ true)
    setSelectedDashTrack(track)
    setShowQualityMenu(false)
  }

  function handleVideoError() {
    const video = videoRef.current
    if (video?.error?.code === 1) return
    if (useDash) return  // Shaka handles its own errors
    setError('Failed to load video. Try a different quality.')
    setLoading(false)
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const bufferedProgress = duration > 0 ? (buffered / duration) * 100 : 0

  // Quality label shown in the button
  const qualityLabel = useDash
    ? (selectedDashTrack ? shakaTrackLabel(selectedDashTrack) : 'Auto')
    : (selectedFormat?.quality || 'Auto')

  return (
    <div
      ref={containerRef}
      className={`relative bg-black rounded-xl overflow-hidden select-none ${
        fullscreen ? 'fixed inset-0 z-[100] rounded-none' : 'w-full aspect-video'
      }`}
      onMouseMove={resetHideTimer}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => { if (playing) setShowControls(false) }}
      onClick={togglePlay}
    >
      {/* Hidden audio element for legacy video-only formats */}
      {audioSrc && !useDash && (
        <audio
          ref={audioRef}
          src={audioSrc}
          preload="auto"
          style={{ display: 'none' }}
          onSeeked={() => {}}
        />
      )}

      <video
        ref={videoRef}
        src={isLive || useDash ? undefined : streamUrl}
        className="w-full h-full object-contain"
        title={title}
        autoPlay={getPlaybackSettings().autoplay}
        preload="auto"
        onPlay={() => {
          setPlaying(true)
          if (!useDash) safePlay(audioRef.current)
        }}
        onPause={() => {
          setPlaying(false)
          if (!useDash) audioRef.current?.pause()
        }}
        onSeeked={() => {
          if (!useDash && audioRef.current && videoRef.current) {
            audioRef.current.currentTime = videoRef.current.currentTime
          }
        }}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={() => {
          const video = videoRef.current
          if (video && video.duration > 0) setDuration(video.duration)
        }}
        onWaiting={() => {
          setLoading(true)
          if (!useDash) audioRef.current?.pause()
        }}
        onCanPlay={() => {
          setLoading(false)
          if (!useDash && videoRef.current && !videoRef.current.paused) safePlay(audioRef.current)
        }}
        onError={handleVideoError}
        onVolumeChange={() => {
          const v = videoRef.current
          if (v) {
            setVolume(v.volume)
            setMuted(v.muted)
            if (!useDash && audioRef.current) {
              audioRef.current.volume = v.volume
              audioRef.current.muted = v.muted
            }
          }
        }}
      />

      {/* Live badge */}
      {isLive && (
        <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded pointer-events-none z-10">
          <Radio className="w-3 h-3" />
          LIVE
        </div>
      )}

      {/* DASH badge */}
      {useDash && dashReady && !isLive && (
        <div className="absolute top-3 right-3 flex items-center gap-1 bg-black/60 text-white text-[10px] font-bold px-2 py-0.5 rounded pointer-events-none z-10">
          DASH
        </div>
      )}

      {/* Loading spinner */}
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-12 h-12 border-4 border-yt-border border-t-white rounded-full animate-spin" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-yt-text text-center px-4">
          <p className="text-lg font-medium mb-2">{t('error_playback')}</p>
          <p className="text-sm text-yt-text-secondary mb-4">{error}</p>
          <button
            onClick={(e) => { e.stopPropagation(); setError(null); setLoading(true); videoRef.current?.load() }}
            className="px-4 py-2 bg-yt-red hover:bg-yt-red-hover text-white rounded-lg text-sm transition-colors"
          >
            {t('retry')}
          </button>
        </div>
      )}

      {/* Controls overlay */}
      <div
        className={`absolute inset-0 flex flex-col justify-end transition-opacity duration-200 pointer-events-none ${showControls ? 'opacity-100' : 'opacity-0'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none" />

        <div className="relative z-10 px-3 pb-2 pointer-events-auto">
          {/* Progress bar — hidden for live */}
          {!isLive && (
            <div className="relative mb-1">
              <div
                className="absolute top-1/2 -translate-y-1/2 left-0 h-1 bg-white/20 rounded pointer-events-none"
                style={{ width: `${bufferedProgress}%` }}
              />
              <input
                type="range" min="0" max="100" step="0.1" value={progress}
                onChange={handleSeek}
                className="w-full relative z-10 h-1 accent-yt-red cursor-pointer"
                style={{ background: `linear-gradient(to right, #ff0000 ${progress}%, #3f3f3f ${progress}%)` }}
                aria-label="Video progress"
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <button onClick={togglePlay} className="text-white hover:text-yt-text-secondary p-1 transition-colors" aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? <Pause className="w-5 h-5 fill-white" /> : <Play className="w-5 h-5 fill-white ml-0.5" />}
            </button>

            <button onClick={toggleMute} className="text-white hover:text-yt-text-secondary p-1 transition-colors" aria-label={muted ? 'Unmute' : 'Mute'}>
              {muted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>
            <input
              type="range" min="0" max="1" step="0.05"
              value={muted ? 0 : volume}
              onChange={handleVolumeChange}
              className="volume-slider w-20 h-1 cursor-pointer"
              style={{ background: `linear-gradient(to right, #f1f1f1 ${(muted ? 0 : volume) * 100}%, #3f3f3f ${(muted ? 0 : volume) * 100}%)` }}
              aria-label="Volume"
            />

            <span className="text-white text-xs ml-1 tabular-nums whitespace-nowrap">
              {isLive ? '🔴 LIVE' : `${formatDuration(currentTime)} / ${formatDuration(duration)}`}
            </span>

            <div className="flex-1" />

            {/* Speed selector */}
            {!isLive && (
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowSpeedMenu((v) => !v); setShowQualityMenu(false) }}
                  className="flex items-center gap-1 text-white text-xs hover:text-yt-text-secondary transition-colors px-2 py-1 rounded hover:bg-white/10"
                >
                  {speed === 1 ? '1×' : `${speed}×`}
                </button>
                {showSpeedMenu && (
                  <div
                    className="absolute bottom-full right-0 mb-2 bg-yt-secondary border border-yt-border rounded-xl shadow-2xl min-w-[100px] py-1 z-50"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          const video = videoRef.current
                          if (video) video.playbackRate = s
                          if (!useDash && audioRef.current) audioRef.current.playbackRate = s
                          setSpeed(s)
                          setShowSpeedMenu(false)
                        }}
                        className={`w-full text-left px-4 py-2 text-sm transition-colors hover:bg-yt-hover ${
                          speed === s ? 'text-yt-red font-medium' : 'text-yt-text'
                        }`}
                      >
                        {s === 1 ? '1× (normal)' : `${s}×`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Quality selector — DASH tracks or legacy formats */}
            {!isLive && (useDash ? dashTracks.length > 0 : allVideoFormats.length > 0) && (
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowQualityMenu((v) => !v); setShowSpeedMenu(false) }}
                  className="flex items-center gap-1 text-white text-xs hover:text-yt-text-secondary transition-colors px-2 py-1 rounded hover:bg-white/10"
                >
                  <Settings className="w-4 h-4" />
                  <span className="hidden sm:block">{qualityLabel}</span>
                </button>

                {showQualityMenu && (
                  <div
                    className="absolute bottom-full right-0 mb-2 bg-yt-secondary border border-yt-border rounded-xl shadow-2xl min-w-[180px] py-1 z-50"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p className="text-yt-text-muted text-xs px-4 py-2 border-b border-yt-border">{t('quality')}</p>
                    {useDash
                      ? dashTracks.map((track) => (
                          <button
                            key={track.id}
                            onClick={() => selectDashQuality(track)}
                            className={`w-full text-left px-4 py-2 text-sm transition-colors hover:bg-yt-hover flex items-center justify-between gap-2 ${
                              selectedDashTrack?.id === track.id ? 'text-yt-red font-medium' : 'text-yt-text'
                            }`}
                          >
                            <span>{shakaTrackLabel(track)}</span>
                            <span className="text-yt-text-muted text-xs">
                              {Math.round(track.bandwidth / 1000)}k
                            </span>
                          </button>
                        ))
                      : allVideoFormats.map((fmt) => (
                          <button
                            key={fmt.itag}
                            onClick={() => selectQuality(fmt)}
                            className={`w-full text-left px-4 py-2 text-sm transition-colors hover:bg-yt-hover flex items-center justify-between gap-2 ${
                              selectedFormat?.itag === fmt.itag ? 'text-yt-red font-medium' : 'text-yt-text'
                            }`}
                          >
                            <span>{fmt.quality}</span>
                            {fmt.ext && (
                              <span className="text-yt-text-muted text-xs uppercase">{fmt.ext}</span>
                            )}
                          </button>
                        ))
                    }
                  </div>
                )}
              </div>
            )}

            <button onClick={toggleFullscreen} className="text-white hover:text-yt-text-secondary p-1 transition-colors" aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              {fullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Big play overlay */}
      {!playing && showControls && !loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-16 h-16 bg-black/60 rounded-full flex items-center justify-center">
            <Play className="w-8 h-8 text-white fill-white ml-1" />
          </div>
        </div>
      )}
    </div>
  )
}
