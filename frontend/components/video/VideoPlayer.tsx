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
  SkipBack,
  SkipForward,
  Subtitles,
} from 'lucide-react'
import { formatDuration } from '@/lib/utils'
import { getStreamUrl, getAudioUrl, getSubtitles, getSubtitleUrl, type VideoFormat, type SubtitleTrack } from '@/lib/api'
import { useRegion } from '@/lib/regionContext'
import { getPlaybackSettings, setPlaybackSettings } from '@/lib/playbackSettings'
import { savePosition, getPosition } from '@/lib/resumePosition'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export interface Chapter {
  time: number  // seconds
  title: string
}

interface VideoPlayerProps {
  videoId: string
  formats: VideoFormat[]
  title: string
  isLive?: boolean
  knownDuration?: number
  onEnded?: () => void
  onNext?: () => void
  onPrev?: () => void
  hasNext?: boolean
  hasPrev?: boolean
  chapters?: Chapter[]
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

  // Auto: highest resolution, prefer combined
  const combined = formats.filter((f) => f.hasVideo && f.hasAudio)
  if (combined.length > 0) return combined[0]
  const videoOnly = formats.filter((f) => f.hasVideo)
  if (videoOnly.length > 0) return videoOnly[0]
  return formats[0]
}

export default function VideoPlayer({ videoId, formats, title, isLive, knownDuration, onEnded, onNext, onPrev, hasNext, hasPrev, chapters = [] }: VideoPlayerProps) {
  const { t } = useRegion()
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hlsRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hdHlsRef = useRef<any>(null)
  const effectiveDurationRef = useRef<number>(0)
  const hlsStartOffsetRef = useRef<number>(0)

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
  const [selectedFormat, setSelectedFormat] = useState<VideoFormat | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const savePositionTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([])
  const [selectedSubtitle, setSelectedSubtitle] = useState<string>(() => getPlaybackSettings().subtitleLang)
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false)

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

  // Keep effectiveDurationRef in sync with duration state
  useEffect(() => {
    if (duration > 0) effectiveDurationRef.current = duration
  }, [duration])

  // Load subtitles when videoId changes
  useEffect(() => {
    setSubtitleTracks([])
    const settings = getPlaybackSettings()
    if (settings.subtitleLang !== 'off') {
      getSubtitles(videoId).then(setSubtitleTracks).catch(() => {})
    }
    setSelectedSubtitle(settings.subtitleLang)
  }, [videoId])

  // Reset on videoId change — apply playback settings
  useEffect(() => {
    const settings = getPlaybackSettings()
    setSelectedFormat(getBestFormat(allVideoFormats))
    setError(null)
    setLoading(true)
    setPlaying(false)
    setCurrentTime(0)
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
        const dur = effectiveDurationRef.current || v?.duration || 0
        if (v && !v.paused && dur > 0) {
          const absTime = hlsStartOffsetRef.current + v.currentTime
          savePosition(videoId, absTime, dur)
        }
      }, 5000)
    }
    return () => {
      if (savePositionTimer.current) clearInterval(savePositionTimer.current)
    }
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

  const isVideoOnly = !!(selectedFormat && !selectedFormat.hasAudio)
  const streamUrl = selectedFormat
    ? getStreamUrl(videoId, String(selectedFormat.itag))
    : getStreamUrl(videoId)
  const audioSrc = isVideoOnly ? getAudioUrl(videoId) : null

  // Initialise hls.js HD session from a given start offset (seconds)
  const startHdHls = useCallback((startOffset: number, autoplay: boolean) => {
    const video = videoRef.current
    if (!video || !selectedFormat) return

    if (hdHlsRef.current) {
      hdHlsRef.current.destroy()
      hdHlsRef.current = null
    }

    hlsStartOffsetRef.current = startOffset
    const itag = String(selectedFormat.itag)
    const hlsUrl = `${API_BASE}/api/hls/${videoId}/${itag}/stream.m3u8?start=${Math.floor(startOffset)}`
    setLoading(true)

    import('hls.js').then(({ default: Hls }) => {
      if (!videoRef.current) return


      if (!Hls.isSupported()) {
        setError('Lecture HD non supportée dans ce navigateur.')
        return
      }

      const hls = new Hls({
        enableWorker: false,
        maxBufferLength: 30,
        manifestLoadingMaxRetry: 3,
        manifestLoadingRetryDelay: 1000,
      })
      hdHlsRef.current = hls
      hls.loadSource(hlsUrl)
      hls.attachMedia(video)

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false)
        if (knownDuration) setDuration(knownDuration)
        if (autoplay) safePlay(video)
      })

      hls.on(Hls.Events.ERROR, (_: unknown, data: { fatal: boolean; details: string }) => {
        if (data.fatal) setError(`Erreur HD : ${data.details}`)
      })
    })
  }, [videoId, selectedFormat, knownDuration]) // eslint-disable-line react-hooks/exhaustive-deps

  // HLS transcode for HD (video-only) formats
  useEffect(() => {
    if (isLive) return
    if (hdHlsRef.current) {
      hdHlsRef.current.destroy()
      hdHlsRef.current = null
    }
    if (!isVideoOnly || !selectedFormat) return

    const itag = String(selectedFormat.itag)
    fetch(`${API_BASE}/api/hls/${videoId}/${itag}`, { method: 'DELETE' }).catch(() => {})
    const settings = getPlaybackSettings()
    const resumePos = settings.resumePlayback ? (getPosition(videoId) ?? 0) : 0
    startHdHls(resumePos, settings.autoplay)

    return () => {
      if (hdHlsRef.current) {
        hdHlsRef.current.destroy()
        hdHlsRef.current = null
      }
      fetch(`${API_BASE}/api/hls/${videoId}/${itag}`, { method: 'DELETE' }).catch(() => {})
    }
  }, [isVideoOnly, selectedFormat?.itag, videoId]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Lock body scroll when CSS fullscreen is active on mobile to prevent
  // the page scrolling behind the video.
  useEffect(() => {
    const isTouchDevice = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
    if (isTouchDevice) {
      document.body.style.overflow = fullscreen ? 'hidden' : ''
    }
    return () => { if (isTouchDevice) document.body.style.overflow = '' }
  }, [fullscreen])

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

    // On touch devices (mobile), use CSS-based fullscreen so the user can
    // toggle back to inline — native requestFullscreen on mobile hands control
    // to the browser and removes the ability to exit programmatically.
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    if (isTouchDevice) {
      setFullscreen((prev) => !prev)
      return
    }

    // Desktop: use the native Fullscreen API
    if (!document.fullscreenElement) {
      container.requestFullscreen()
    } else {
      document.exitFullscreen()
    }
  }

  function handleTimeUpdate() {
    const video = videoRef.current
    if (!video) return
    // For HD HLS, currentTime is relative to the session start offset
    const absoluteTime = hlsStartOffsetRef.current + video.currentTime
    setCurrentTime(absoluteTime)
    if (video.buffered.length > 0) setBuffered(hlsStartOffsetRef.current + video.buffered.end(video.buffered.length - 1))
    const audio = audioRef.current
    if (audio && !audio.paused && Math.abs(audio.currentTime - video.currentTime) > 0.3) {
      audio.currentTime = video.currentTime
    }
  }

  function handleLoadedMetadata() {
    const video = videoRef.current
    if (!video) return
    const settings = getPlaybackSettings()
    const dur = (isVideoOnly && knownDuration)
      ? knownDuration
      : (isFinite(video.duration) && video.duration > 0 ? video.duration : (knownDuration ?? 0))
    setDuration(dur)
    setLoading(false)
    video.volume = settings.defaultVolume
    video.playbackRate = settings.defaultSpeed
    setVolume(settings.defaultVolume)
    setSpeed(settings.defaultSpeed)
    if (settings.resumePlayback && !isVideoOnly) {
      const pos = getPosition(videoId)
      const dur = effectiveDurationRef.current || video.duration || 0
      if (pos && pos > 0 && dur > 0 && pos < dur * 0.95) {
        video.currentTime = pos
        if (audioRef.current) audioRef.current.currentTime = pos
      }
    }
  }

  function handleSeek(e: ChangeEvent<HTMLInputElement>) {
    const video = videoRef.current
    if (!video) return
    const dur = effectiveDurationRef.current || video.duration
    const time = (parseFloat(e.target.value) / 100) * dur
    setCurrentTime(time)
    if (isVideoOnly) {
      // Restart ffmpeg from the sought position
      const wasPlaying = !video.paused
      startHdHls(time, wasPlaying)
    } else {
      video.currentTime = time
      if (audioRef.current) audioRef.current.currentTime = time
    }
  }

  function handleVolumeChange(e: ChangeEvent<HTMLInputElement>) {
    const video = videoRef.current
    if (!video) return
    const vol = parseFloat(e.target.value)
    video.volume = vol
    if (audioRef.current) audioRef.current.volume = vol
    setVolume(vol)
    setPlaybackSettings({ defaultVolume: vol })
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
    if (video?.error?.code === 1) return
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
      onTouchStart={(e) => {
        // On mobile: first tap reveals controls without toggling play.
        // Subsequent taps (with controls visible) fire onClick → togglePlay.
        if (!showControls) {
          e.preventDefault()
          resetHideTimer()
        }
      }}
      onClick={togglePlay}
    >
      {/* Hidden audio element — only for video-only formats without HD HLS */}
      {audioSrc && !isVideoOnly && (
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
        src={isLive || isVideoOnly ? undefined : streamUrl}
        className="w-full h-full object-contain"
        title={title}
        autoPlay={getPlaybackSettings().autoplay}
        playsInline
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
        onDurationChange={() => {
          const v = videoRef.current
          if (!v) return
          if (isVideoOnly && knownDuration) {
            // HLS transcode: ignore hls.js partial duration, always use known total
            setDuration(knownDuration)
          } else if (knownDuration && knownDuration > 0) {
            // Prefer known duration when provided — prevents HLS partial-segment flickering
            setDuration(knownDuration)
          } else if (isFinite(v.duration) && v.duration > 0) {
            // Only allow duration to grow: HLS can report decreasing partial values
            // during buffering which causes the displayed duration to flicker.
            setDuration((prev) => Math.max(prev, v.duration))
          }
        }}
        onLoadedMetadata={handleLoadedMetadata}
        onWaiting={() => {
          setLoading(true)
          audioRef.current?.pause()
        }}
        onCanPlay={() => {
          setLoading(false)
          if (videoRef.current && !videoRef.current.paused) safePlay(audioRef.current)
        }}
        loop={getPlaybackSettings().loop}
        onEnded={() => {
          if (getPlaybackSettings().loop) return
          setPlaying(false)
          audioRef.current?.pause()
          onEnded?.()
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
      >
        {selectedSubtitle !== 'off' && (
          <track
            key={selectedSubtitle}
            kind="subtitles"
            src={getSubtitleUrl(videoId, selectedSubtitle)}
            label={selectedSubtitle}
            default
          />
        )}
      </video>

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
            <div className="relative mb-1 group/progress">
              {/* Buffered */}
              <div
                className="absolute top-1/2 -translate-y-1/2 left-0 h-1 bg-white/20 rounded pointer-events-none"
                style={{ width: `${bufferedProgress}%` }}
              />
              {/* Chapter markers */}
              {chapters.length > 0 && duration > 0 && chapters.map((ch, i) => (
                <div
                  key={i}
                  className="absolute top-1/2 -translate-y-1/2 w-0.5 h-3 bg-white/60 pointer-events-none z-20"
                  style={{ left: `${(ch.time / duration) * 100}%` }}
                />
              ))}
              {/* Current chapter name */}
              {chapters.length > 0 && duration > 0 && (() => {
                const ch = [...chapters].reverse().find((c) => c.time <= currentTime)
                return ch ? (
                  <div className="absolute bottom-full left-0 mb-2 text-[11px] text-white/80 bg-black/60 px-2 py-0.5 rounded pointer-events-none whitespace-nowrap max-w-[200px] truncate">
                    {ch.title}
                  </div>
                ) : null
              })()}
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
            {onPrev && (
              <button
                onClick={(e) => { e.stopPropagation(); onPrev() }}
                disabled={!hasPrev}
                className={`p-1 transition-colors ${hasPrev ? 'text-white hover:text-yt-text-secondary' : 'text-white/30 cursor-not-allowed'}`}
                aria-label="Vidéo précédente"
              >
                <SkipBack className="w-5 h-5 fill-white" />
              </button>
            )}

            <button onClick={togglePlay} className="text-white hover:text-yt-text-secondary p-1 transition-colors" aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? <Pause className="w-5 h-5 fill-white" /> : <Play className="w-5 h-5 fill-white ml-0.5" />}
            </button>

            {onNext && (
              <button
                onClick={(e) => { e.stopPropagation(); onNext() }}
                disabled={!hasNext}
                className={`p-1 transition-colors ${hasNext ? 'text-white hover:text-yt-text-secondary' : 'text-white/30 cursor-not-allowed'}`}
                aria-label="Vidéo suivante"
              >
                <SkipForward className="w-5 h-5 fill-white" />
              </button>
            )}

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
                          if (audioRef.current) audioRef.current.playbackRate = s
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

            {/* Quality selector */}
            {!isLive && allVideoFormats.length > 0 && (
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowQualityMenu((v) => !v); setShowSpeedMenu(false) }}
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

            {/* Subtitles selector */}
            {!isLive && (
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (subtitleTracks.length === 0) {
                      getSubtitles(videoId).then((tracks) => {
                        setSubtitleTracks(tracks)
                        setShowSubtitleMenu(true)
                      })
                    } else {
                      setShowSubtitleMenu((v) => !v)
                    }
                    setShowSpeedMenu(false)
                    setShowQualityMenu(false)
                  }}
                  className={`p-1 transition-colors ${selectedSubtitle !== 'off' ? 'text-yt-red' : 'text-white hover:text-yt-text-secondary'}`}
                  aria-label="Subtitles"
                >
                  <Subtitles className="w-4 h-4" />
                </button>
                {showSubtitleMenu && (
                  <div
                    className="absolute bottom-full right-0 mb-2 bg-yt-secondary border border-yt-border rounded-xl shadow-2xl min-w-[160px] py-1 z-50"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p className="text-yt-text-muted text-xs px-4 py-2 border-b border-yt-border">CC / Subtitles</p>
                    <button
                      onClick={() => { setSelectedSubtitle('off'); setShowSubtitleMenu(false) }}
                      className={`w-full text-left px-4 py-2 text-sm transition-colors hover:bg-yt-hover ${selectedSubtitle === 'off' ? 'text-yt-red font-medium' : 'text-yt-text'}`}
                    >
                      {t('settings_playback_subtitle_off')}
                    </button>
                    {subtitleTracks.map((track) => (
                      <button
                        key={track.lang}
                        onClick={() => { setSelectedSubtitle(track.lang); setShowSubtitleMenu(false) }}
                        className={`w-full text-left px-4 py-2 text-sm transition-colors hover:bg-yt-hover flex items-center justify-between gap-2 ${selectedSubtitle === track.lang ? 'text-yt-red font-medium' : 'text-yt-text'}`}
                      >
                        <span>{track.label}</span>
                        {track.auto && <span className="text-[10px] text-yt-text-muted">auto</span>}
                      </button>
                    ))}
                    {subtitleTracks.length === 0 && (
                      <p className="px-4 py-2 text-xs text-yt-text-muted">No subtitles available</p>
                    )}
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
