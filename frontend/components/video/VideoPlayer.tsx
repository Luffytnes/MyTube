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

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface VideoPlayerProps {
  videoId: string
  formats: VideoFormat[]
  title: string
  isLive?: boolean
}

function getBestFormat(formats: VideoFormat[]): VideoFormat | null {
  if (!formats || formats.length === 0) return null
  // Prefer combined (video+audio) at highest resolution
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

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [showQualityMenu, setShowQualityMenu] = useState(false)
  const [selectedFormat, setSelectedFormat] = useState<VideoFormat | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // One entry per resolution ≥240p, prefer combined (audio+video) at each height.
  // Video-only formats are included — they'll use the mux endpoint server-side.
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

  // Reset on videoId change — no localStorage persistence
  useEffect(() => {
    setSelectedFormat(getBestFormat(allVideoFormats))
    setError(null)
    setLoading(true)
    setPlaying(false)
    setCurrentTime(0)
  }, [videoId]) // eslint-disable-line react-hooks/exhaustive-deps

  // HLS setup for live streams
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
        // Backend may return a relative path — resolve it against API_BASE
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
      } catch (e) {
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

  const isVideoOnly = !!(selectedFormat && !selectedFormat.hasAudio)
  const streamUrl = selectedFormat
    ? getStreamUrl(videoId, String(selectedFormat.itag))
    : getStreamUrl(videoId)
  // Audio-only stream URL — used when the selected format has no audio track
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
      safePlay(audioRef.current)
    } else {
      video.pause()
      audioRef.current?.pause()
    }
    resetHideTimer()
  }

  function toggleMute() {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    if (audioRef.current) audioRef.current.muted = video.muted
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
    // Drift correction for dual-stream mode
    const audio = audioRef.current
    if (audio && !audio.paused && Math.abs(audio.currentTime - video.currentTime) > 0.3) {
      audio.currentTime = video.currentTime
    }
  }

  function handleLoadedMetadata() {
    const video = videoRef.current
    if (!video) return
    setDuration(video.duration)
    setLoading(false)
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
    if (audioRef.current) audioRef.current.volume = vol
    setVolume(vol)
    if (vol === 0) {
      video.muted = true
      if (audioRef.current) audioRef.current.muted = true
      setMuted(true)
    } else if (muted) {
      video.muted = false
      if (audioRef.current) audioRef.current.muted = false
      setMuted(false)
    }
  }

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

  function handleVideoError() {
    const video = videoRef.current
    // MEDIA_ERR_ABORTED (code 1) = src changed while loading, not a real error
    if (video?.error?.code === 1) {
      return
    }
    setError('Failed to load video. Try a different quality.')
    setLoading(false)
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const bufferedProgress = duration > 0 ? (buffered / duration) * 100 : 0

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
      {/* Hidden audio element for video-only (DASH) formats */}
      {audioSrc && (
        <audio
          ref={audioRef}
          src={audioSrc}
          preload="auto"
          style={{ display: 'none' }}
          onSeeked={() => {}} // seek driven by video element
        />
      )}

      <video
        ref={videoRef}
        src={isLive ? undefined : streamUrl}
        className="w-full h-full object-contain"
        title={title}
        autoPlay
        preload="auto"
        onPlay={() => {
          setPlaying(true)
          safePlay(audioRef.current)
        }}
        onPause={() => {
          setPlaying(false)
          audioRef.current?.pause()
        }}
        onSeeked={() => {
          if (audioRef.current && videoRef.current) {
            audioRef.current.currentTime = videoRef.current.currentTime
          }
        }}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onWaiting={() => {
          setLoading(true)
          audioRef.current?.pause()
        }}
        onCanPlay={() => {
          setLoading(false)
          if (videoRef.current && !videoRef.current.paused) safePlay(audioRef.current)
        }}
        onError={handleVideoError}
        onVolumeChange={() => {
          const v = videoRef.current
          if (v) {
            setVolume(v.volume)
            setMuted(v.muted)
            if (audioRef.current) {
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

            {/* Quality selector */}
            {!isLive && allVideoFormats.length > 0 && (
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowQualityMenu((v) => !v) }}
                  className="flex items-center gap-1 text-white text-xs hover:text-yt-text-secondary transition-colors px-2 py-1 rounded hover:bg-white/10"
                >
                  <Settings className="w-4 h-4" />
                  <span className="hidden sm:block">{selectedFormat?.quality || 'Auto'}</span>
                </button>

                {showQualityMenu && (
                  <div
                    className="absolute bottom-full right-0 mb-2 bg-yt-secondary border border-yt-border rounded-xl shadow-2xl min-w-[180px] py-1 z-50"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p className="text-yt-text-muted text-xs px-4 py-2 border-b border-yt-border">{t('quality')}</p>
                    {allVideoFormats.map((fmt) => (
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
                    ))}
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
