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
  RotateCcw,
  RotateCw,
  Check,
} from 'lucide-react'
import { formatDuration } from '@/lib/utils'
import { getStreamUrl, getAudioUrl, getSubtitles, getSubtitleUrl, type VideoFormat, type SubtitleTrack } from '@/lib/api'
import VolumeSlider from '@/components/ui/VolumeSlider'
import { useRegion } from '@/lib/regionContext'
import { getPlaybackSettings, setPlaybackSettings } from '@/lib/playbackSettings'
import { savePosition, getPosition } from '@/lib/resumePosition'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export interface Chapter {
  time: number
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

  const combined = formats.filter((f) => f.hasVideo && f.hasAudio)
  if (combined.length > 0) return combined[0]
  const videoOnly = formats.filter((f) => f.hasVideo)
  if (videoOnly.length > 0) return videoOnly[0]
  return formats[0]
}

// Panel wrapper — Vidking-style dark floating card
function Panel({
  title, icon, children,
}: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="w-64 bg-[#141010] border border-white/[0.07] rounded-xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.07]">
        <div className="w-7 h-7 bg-red-950/70 rounded-lg flex items-center justify-center text-red-500 shrink-0">
          {icon}
        </div>
        <span className="text-white text-sm font-semibold">{title}</span>
      </div>
      <div className="max-h-56 overflow-y-auto">
        {children}
      </div>
    </div>
  )
}

function PanelItem({
  label, sublabel, active, onClick,
}: { label: string; sublabel?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
    >
      <div className="text-left">
        <span className={`text-sm ${active ? 'text-white font-medium' : 'text-white/55'}`}>{label}</span>
        {sublabel && <span className="text-[10px] text-white/35 ml-2">{sublabel}</span>}
      </div>
      {active && (
        <div className="w-5 h-5 rounded-full bg-red-600 flex items-center justify-center shrink-0 ml-2">
          <Check className="w-3 h-3 text-white" />
        </div>
      )}
    </button>
  )
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
  const justShowedControlsRef = useRef(false)
  const seekBarRef = useRef<HTMLDivElement>(null)
  const seekDragging = useRef(false)
  const hlsRestartRef = useRef(0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const startHdHlsRef = useRef<((startOffset: number, autoplay: boolean, isErrorRestart?: boolean) => void) | null>(null)

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolume] = useState(() => getPlaybackSettings().defaultVolume)
  const [muted, setMuted] = useState(false)
  const [speed, setSpeed] = useState(() => getPlaybackSettings().defaultSpeed)
  const [showSpeedMenu, setShowSpeedMenu] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [showQualityMenu, setShowQualityMenu] = useState(false)
  const [selectedFormat, setSelectedFormat] = useState<VideoFormat | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const savePositionTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([])
  const [selectedSubtitle, setSelectedSubtitle] = useState<string>(() => getPlaybackSettings().subtitleLang)
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false)
  const [scrubRatio, setScrubRatio] = useState<number | null>(null)
  const [hoverRatio, setHoverRatio] = useState<number | null>(null)
  const [subCues, setSubCues] = useState<Array<{ start: number; end: number; lines: string[] }>>([])
  const [activeCue, setActiveCue] = useState<string[] | null>(null)

  const allVideoFormats = (() => {
    const getHeight = (f: VideoFormat) =>
      f.height ?? parseInt(f.quality?.replace('p', '') ?? '0', 10) ?? 0
    const byHeight = new Map<number, VideoFormat>()
    for (const f of formats) {
      if (!f.hasVideo) continue
      const h = getHeight(f)
      if (h < 240) continue
      const existing = byHeight.get(h)
      if (!existing || (!existing.hasAudio && f.hasAudio)) byHeight.set(h, f)
    }
    return Array.from(byHeight.entries()).sort((a, b) => b[0] - a[0]).map(([, f]) => f)
  })()

  useEffect(() => {
    if (duration > 0) effectiveDurationRef.current = duration
  }, [duration])

  useEffect(() => {
    setSubtitleTracks([])
    const settings = getPlaybackSettings()
    if (settings.subtitleLang !== 'off') {
      getSubtitles(videoId).then(setSubtitleTracks).catch(() => {})
    }
    setSelectedSubtitle(settings.subtitleLang)
  }, [videoId])

  // Fetch + parse subtitle VTT
  useEffect(() => {
    setSubCues([])
    setActiveCue(null)
    if (selectedSubtitle === 'off') return
    let cancelled = false
    function toSec(t: string): number {
      const parts = t.trim().split(':').map(Number)
      return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1]
    }
    fetch(getSubtitleUrl(videoId, selectedSubtitle))
      .then(r => r.ok ? r.text() : Promise.reject())
      .then(text => {
        if (cancelled) return
        const cues: Array<{ start: number; end: number; lines: string[] }> = []
        for (const block of text.split(/\n{2,}/)) {
          const lines = block.trim().split('\n')
          const ti = lines.findIndex(l => l.includes('-->'))
          if (ti === -1) continue
          const [sPart, ePart] = lines[ti].split('-->').map(p => p.trim().split(/\s/)[0])
          const start = toSec(sPart), end = toSec(ePart)
          const rawTxt = lines.slice(ti + 1).filter(l => l.trim() && !l.startsWith('NOTE')).join('\n')
          const txt = rawTxt.replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '').trim()
          if (txt && !isNaN(start) && !isNaN(end)) cues.push({ start, end, lines: txt.split('\n') })
        }
        setSubCues(cues)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [videoId, selectedSubtitle]) // eslint-disable-line react-hooks/exhaustive-deps

  // Update active cue on timeupdate
  useEffect(() => {
    if (subCues.length === 0) { setActiveCue(null); return }
    const video = videoRef.current
    if (!video) return
    const onTime = () => {
      const t = hlsStartOffsetRef.current + (videoRef.current?.currentTime ?? 0)
      const cue = subCues.find(c => t >= c.start && t < c.end) ?? null
      setActiveCue(cue ? cue.lines : null)
    }
    video.addEventListener('timeupdate', onTime)
    return () => video.removeEventListener('timeupdate', onTime)
  }, [subCues]) // eslint-disable-line react-hooks/exhaustive-deps

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
    if (video) { video.volume = settings.defaultVolume; video.playbackRate = settings.defaultSpeed }
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
    return () => { if (savePositionTimer.current) clearInterval(savePositionTimer.current) }
  }, [videoId]) // eslint-disable-line react-hooks/exhaustive-deps

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
          video.src = url; setLoading(false); return
        }
        const { default: Hls } = await import('hls.js')
        if (cancelled) return
        if (!Hls.isSupported()) { setError('Live streaming is not supported in this browser.'); return }
        const hls = new Hls({ enableWorker: false })
        hlsRef.current = hls
        hls.loadSource(url); hls.attachMedia(video)
        hls.on(Hls.Events.MANIFEST_PARSED, () => { setLoading(false) })
        hls.on(Hls.Events.ERROR, (_: unknown, data: { fatal: boolean; details: string }) => {
          if (data.fatal) setError(`Live stream error: ${data.details}`)
        })
      } catch { if (!cancelled) setError('Failed to load live stream.') }
    }
    setupLive()
    return () => {
      cancelled = true
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null }
    }
  }, [videoId, isLive])

  const isVideoOnly = !!(selectedFormat && !selectedFormat.hasAudio)
  const streamUrl = selectedFormat ? getStreamUrl(videoId, String(selectedFormat.itag)) : getStreamUrl(videoId)
  const audioSrc = isVideoOnly ? getAudioUrl(videoId) : null

  const startHdHls = useCallback((startOffset: number, autoplay: boolean, isErrorRestart = false) => {
    const video = videoRef.current
    if (!video || !selectedFormat) return
    if (!isErrorRestart) hlsRestartRef.current = 0
    const hadPreviousSession = !!hdHlsRef.current
    if (hdHlsRef.current) { hdHlsRef.current.destroy(); hdHlsRef.current = null }
    if (hadPreviousSession || isErrorRestart) { video.removeAttribute('src'); video.load() }
    hlsStartOffsetRef.current = startOffset
    const itag = String(selectedFormat.itag)
    const hlsUrl = `${API_BASE}/api/hls/${videoId}/${itag}/stream.m3u8?start=${Math.floor(startOffset)}`
    setLoading(true)
    import('hls.js').then(({ default: Hls }) => {
      if (!videoRef.current) return
      if (!Hls.isSupported()) { setError('Lecture HD non supportée dans ce navigateur.'); return }
      let restartQueued = false
      let sessionErrors = 0
      let playStarted = false
      let autoplayFallback: ReturnType<typeof setTimeout> | null = null
      const hls = new Hls({ enableWorker: false, maxBufferLength: 30, manifestLoadingMaxRetry: 3, manifestLoadingRetryDelay: 1000 })
      hdHlsRef.current = hls
      hls.loadSource(hlsUrl); hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false)
        if (knownDuration) setDuration(knownDuration)
        if (autoplay) {
          // Safety net: if audio segment never arrives within 3s, play anyway
          autoplayFallback = setTimeout(() => {
            if (!playStarted) { playStarted = true; safePlay(video) }
          }, 3000)
        }
      })
      hls.on(Hls.Events.BUFFER_APPENDED, (_, data: any) => {
        // Wait for audio data in buffer before starting — avoids video-without-audio at startup
        if (autoplay && !playStarted && (data.type === 'audio' || data.type === 'audiovideo')) {
          playStarted = true
          if (autoplayFallback) { clearTimeout(autoplayFallback); autoplayFallback = null }
          safePlay(video)
        }
      })
      hls.on(Hls.Events.ERROR, (_: unknown, data: { fatal: boolean; type: string; details: string }) => {
        if (!data.fatal || restartQueued) return
        sessionErrors++
        if (sessionErrors === 1 && data.type === 'mediaError') {
          hls.recoverMediaError()
        } else if (hlsRestartRef.current < 2) {
          restartQueued = true
          hlsRestartRef.current++
          if (autoplayFallback) { clearTimeout(autoplayFallback); autoplayFallback = null }
          hls.destroy()
          hdHlsRef.current = null
          const currentPos = hlsStartOffsetRef.current + (videoRef.current?.currentTime ?? 0)
          fetch(`${API_BASE}/api/hls/${videoId}/${itag}`, { method: 'DELETE' }).catch(() => {})
          startHdHlsRef.current?.(currentPos, autoplay, true)
        } else {
          setError(`Erreur HD : ${data.details}`)
        }
      })
    })
  }, [videoId, selectedFormat, knownDuration]) // eslint-disable-line react-hooks/exhaustive-deps
  startHdHlsRef.current = startHdHls

  useEffect(() => {
    if (isLive) return
    if (hdHlsRef.current) { hdHlsRef.current.destroy(); hdHlsRef.current = null }
    if (!isVideoOnly || !selectedFormat) return
    const itag = String(selectedFormat.itag)
    fetch(`${API_BASE}/api/hls/${videoId}/${itag}`, { method: 'DELETE' }).catch(() => {})
    const settings = getPlaybackSettings()
    const resumePos = settings.resumePlayback ? (getPosition(videoId) ?? 0) : 0
    startHdHls(resumePos, settings.autoplay)
    return () => {
      if (hdHlsRef.current) { hdHlsRef.current.destroy(); hdHlsRef.current = null }
      fetch(`${API_BASE}/api/hls/${videoId}/${itag}`, { method: 'DELETE' }).catch(() => {})
    }
  }, [isVideoOnly, selectedFormat?.itag, videoId]) // eslint-disable-line react-hooks/exhaustive-deps

  const resetHideTimer = useCallback(() => {
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current)
    setShowControls(true)
    hideControlsTimer.current = setTimeout(() => { if (playing) setShowControls(false) }, 3000)
  }, [playing])

  useEffect(() => { return () => { if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current) } }, [])

  useEffect(() => { setIsMobile('ontouchstart' in window || navigator.maxTouchPoints > 0) }, [])

  useEffect(() => {
    function onFsChange() {
      const isFs = !!(document.fullscreenElement || (document as { webkitFullscreenElement?: Element }).webkitFullscreenElement)
      setFullscreen(isFs)
    }
    document.addEventListener('fullscreenchange', onFsChange)
    document.addEventListener('webkitfullscreenchange', onFsChange)
    const video = videoRef.current
    function onIosBegin() { setFullscreen(true) }
    function onIosEnd() { setFullscreen(false) }
    video?.addEventListener('webkitbeginfullscreen', onIosBegin)
    video?.addEventListener('webkitendfullscreen', onIosEnd)
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange)
      document.removeEventListener('webkitfullscreenchange', onFsChange)
      video?.removeEventListener('webkitbeginfullscreen', onIosBegin)
      video?.removeEventListener('webkitendfullscreen', onIosEnd)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isMobile) document.body.style.overflow = fullscreen ? 'hidden' : ''
    return () => { if (isMobile) document.body.style.overflow = '' }
  }, [fullscreen, isMobile])

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

  const safePlay = (el: HTMLVideoElement | HTMLAudioElement | null) => { el?.play().catch(() => {}) }

  function togglePlay() {
    const video = videoRef.current
    if (!video) return
    if (video.paused) { safePlay(video); safePlay(audioRef.current) }
    else { video.pause(); audioRef.current?.pause() }
    resetHideTimer()
  }

  function toggleMute() {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    if (audioRef.current) audioRef.current.muted = video.muted
    setMuted(video.muted)
  }

  async function toggleFullscreen() {
    const container = containerRef.current
    const video = videoRef.current
    if (!container) return
    type DocExt = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void }
    type VidExt = HTMLVideoElement & { webkitEnterFullscreen?: () => void; webkitExitFullscreen?: () => void }
    const doc = document as DocExt
    const vid = video as VidExt | null
    const isCurrentlyFullscreen = !!(document.fullscreenElement || doc.webkitFullscreenElement || fullscreen)
    if (isCurrentlyFullscreen) {
      setFullscreen(false)
      if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen().catch(() => {})
      else if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) doc.webkitExitFullscreen()
      else vid?.webkitExitFullscreen?.()
      return
    }
    if (container.requestFullscreen && document.fullscreenEnabled) {
      try { await container.requestFullscreen(); return } catch { /* fall through */ }
    }
    if (vid?.webkitEnterFullscreen) { vid.webkitEnterFullscreen(); return }
    setFullscreen(true)
  }

  function handleTimeUpdate() {
    const video = videoRef.current
    if (!video) return
    const absoluteTime = hlsStartOffsetRef.current + video.currentTime
    setCurrentTime(absoluteTime)
    if (video.buffered.length > 0) setBuffered(hlsStartOffsetRef.current + video.buffered.end(video.buffered.length - 1))
    const audio = audioRef.current
    if (audio && !audio.paused && Math.abs(audio.currentTime - absoluteTime) > 0.3) audio.currentTime = absoluteTime
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

  function handleVolumeChange(e: ChangeEvent<HTMLInputElement>) {
    const video = videoRef.current
    if (!video) return
    const vol = parseFloat(e.target.value)
    video.volume = vol
    if (audioRef.current) audioRef.current.volume = vol
    setVolume(vol)
    setPlaybackSettings({ defaultVolume: vol })
    if (vol === 0) { video.muted = true; if (audioRef.current) audioRef.current.muted = true; setMuted(true) }
    else if (muted) { video.muted = false; if (audioRef.current) audioRef.current.muted = false; setMuted(false) }
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
        if (wasPlaying) { safePlay(video); safePlay(audioRef.current) }
      }
    }, 300)
  }

  function handleVideoError() {
    const video = videoRef.current
    if (video?.error?.code === 1) return
    setError('Failed to load video. Try a different quality.')
    setLoading(false)
  }

  // Seek bar (pointer-based)
  function getSeekRatio(clientX: number): number {
    const bar = seekBarRef.current
    if (!bar) return 0
    const { left, width } = bar.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - left) / width))
  }

  function seekToRatio(ratio: number) {
    const video = videoRef.current
    if (!video) return
    const dur = effectiveDurationRef.current || video.duration
    const time = ratio * dur
    setCurrentTime(time)
    if (isVideoOnly) {
      const wasPlaying = !video.paused
      startHdHls(time, wasPlaying)
    } else {
      video.currentTime = time
      if (audioRef.current) audioRef.current.currentTime = time
    }
  }

  function onSeekPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    seekDragging.current = true
    const ratio = getSeekRatio(e.clientX)
    setScrubRatio(ratio)
    if (!isVideoOnly) seekToRatio(ratio)
  }

  function onSeekPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!seekDragging.current) return
    const ratio = getSeekRatio(e.clientX)
    setScrubRatio(ratio)
    if (!isVideoOnly) seekToRatio(ratio)
  }

  function onSeekPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    seekDragging.current = false
    const ratio = getSeekRatio(e.clientX)
    setScrubRatio(null)
    seekToRatio(ratio)
  }

  const displayRatio = scrubRatio !== null ? scrubRatio : (duration > 0 ? currentTime / duration : 0)
  const displayProgress = displayRatio * 100
  const bufferedProgress = duration > 0 ? (buffered / duration) * 100 : 0
  const displayTimeVal = scrubRatio !== null ? scrubRatio * duration : currentTime
  const hoverTimeVal = hoverRatio !== null ? hoverRatio * duration : 0
  const anyMenuOpen = showSpeedMenu || showQualityMenu || showSubtitleMenu

  // Current chapter at hover/current time
  const hoverChapter = chapters.length > 0 && duration > 0
    ? [...chapters].reverse().find(c => c.time <= hoverTimeVal)
    : null

  return (
    <div
      ref={containerRef}
      className={`relative bg-black rounded-xl overflow-hidden select-none ${
        fullscreen ? 'fixed inset-0 z-[100] rounded-none' : 'w-full aspect-video'
      }`}
      onMouseMove={resetHideTimer}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => { if (playing && !anyMenuOpen) setShowControls(false) }}
      onTouchStart={() => {
        if (!showControls) { justShowedControlsRef.current = true; resetHideTimer() }
      }}
      onClick={() => {
        if (justShowedControlsRef.current) { justShowedControlsRef.current = false; return }
        if (anyMenuOpen) { setShowSpeedMenu(false); setShowQualityMenu(false); setShowSubtitleMenu(false); return }
        togglePlay()
      }}
    >
      {/* Hidden audio — video-only formats (unused: HLS stream already muxes audio via ffmpeg) */}
      {audioSrc && !isVideoOnly && (
        <audio ref={audioRef} src={audioSrc} preload="auto" style={{ display: 'none' }} />
      )}

      <video
        ref={videoRef}
        src={isLive || isVideoOnly ? undefined : streamUrl}
        className="w-full h-full object-contain"
        title={title}
        autoPlay={getPlaybackSettings().autoplay}
        playsInline
        preload="auto"
        onPlay={() => { setPlaying(true); safePlay(audioRef.current) }}
        onPause={() => { setPlaying(false); audioRef.current?.pause() }}
        onSeeked={() => { if (audioRef.current && videoRef.current) audioRef.current.currentTime = hlsStartOffsetRef.current + videoRef.current.currentTime }}
        onTimeUpdate={handleTimeUpdate}
        onDurationChange={() => {
          const v = videoRef.current
          if (!v) return
          if (isVideoOnly && knownDuration) setDuration(knownDuration)
          else if (knownDuration && knownDuration > 0) setDuration(knownDuration)
          else if (isFinite(v.duration) && v.duration > 0) setDuration(prev => Math.max(prev, v.duration))
        }}
        onLoadedMetadata={handleLoadedMetadata}
        onWaiting={() => { setLoading(true); audioRef.current?.pause() }}
        onCanPlay={() => { setLoading(false); if (videoRef.current && !videoRef.current.paused) safePlay(audioRef.current) }}
        loop={getPlaybackSettings().loop}
        onEnded={() => { if (getPlaybackSettings().loop) return; setPlaying(false); audioRef.current?.pause(); onEnded?.() }}
        onError={handleVideoError}
        onVolumeChange={() => {
          const v = videoRef.current
          if (v) {
            setVolume(v.volume); setMuted(v.muted)
            if (audioRef.current) { audioRef.current.volume = v.volume; audioRef.current.muted = v.muted }
          }
        }}
      >
      </video>

      {/* Loading spinner */}
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-white text-center px-4">
          <p className="text-base font-medium mb-2">{t('error_playback')}</p>
          <p className="text-sm text-white/60 mb-4">{error}</p>
          <button
            onClick={e => { e.stopPropagation(); setError(null); setLoading(true); videoRef.current?.load() }}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm transition-colors"
          >
            {t('retry')}
          </button>
        </div>
      )}

      {/* Subtitle overlay */}
      {activeCue && !error && (
        <div className="absolute bottom-20 left-0 right-0 flex justify-center pointer-events-none z-20 px-6">
          <div className="bg-black/80 text-white text-sm sm:text-base px-4 py-2 rounded-lg text-center max-w-[85%] leading-snug">
            {activeCue.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        </div>
      )}

      {/* Controls overlay */}
      {!error && (
        <div
          className={`absolute inset-0 flex flex-col justify-between transition-opacity duration-200 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          onClick={e => e.stopPropagation()}
        >
          {/* Top: gradient + title */}
          <div className="relative pointer-events-none">
            <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/75 to-transparent" />
            <p className="relative text-center text-white font-bold text-sm pt-4 drop-shadow-lg px-10 truncate">
              {title}
            </p>
          </div>

          {/* Bottom zone */}
          <div className="relative" onClick={e => e.stopPropagation()}>
            {/* Bottom gradient */}
            <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/90 to-transparent pointer-events-none" />

            {/* Floating panels */}
            <div className="absolute bottom-full right-0 mb-2 px-4 flex flex-col items-end gap-2 z-50">
              {showSpeedMenu && (
                <Panel title="Vitesse" icon={<span className="text-xs font-bold">{speed}×</span>}>
                  {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(s => (
                    <PanelItem
                      key={s}
                      label={s === 1 ? '1× (normal)' : `${s}×`}
                      active={speed === s}
                      onClick={() => {
                        const video = videoRef.current
                        if (video) video.playbackRate = s
                        if (audioRef.current) audioRef.current.playbackRate = s
                        setSpeed(s)
                        setShowSpeedMenu(false)
                      }}
                    />
                  ))}
                </Panel>
              )}
              {showQualityMenu && allVideoFormats.length > 0 && (
                <Panel title="Qualité" icon={<Settings className="w-4 h-4" />}>
                  {allVideoFormats.map(fmt => (
                    <PanelItem
                      key={fmt.itag}
                      label={fmt.quality || 'Auto'}
                      sublabel={fmt.ext?.toUpperCase()}
                      active={selectedFormat?.itag === fmt.itag}
                      onClick={() => selectQuality(fmt)}
                    />
                  ))}
                </Panel>
              )}
              {showSubtitleMenu && (
                <Panel title="Sous-titres" icon={<span className="text-[10px] font-bold">CC</span>}>
                  <PanelItem
                    label={t('settings_playback_subtitle_off')}
                    active={selectedSubtitle === 'off'}
                    onClick={() => { setSelectedSubtitle('off'); setShowSubtitleMenu(false) }}
                  />
                  {subtitleTracks.map(track => (
                    <PanelItem
                      key={track.lang}
                      label={track.label}
                      sublabel={track.auto ? 'auto' : undefined}
                      active={selectedSubtitle === track.lang}
                      onClick={() => { setSelectedSubtitle(track.lang); setShowSubtitleMenu(false) }}
                    />
                  ))}
                  {subtitleTracks.length === 0 && (
                    <p className="px-4 py-3 text-xs text-white/40">Aucun sous-titre disponible</p>
                  )}
                </Panel>
              )}
            </div>

            {/* Controls bar */}
            <div className="relative px-4 pb-4 pt-2 space-y-2 pointer-events-auto">
              {/* Seek row */}
              {!isLive ? (
                <div className="flex items-center gap-2.5">
                  <span className="text-white text-xs tabular-nums shrink-0 w-11 text-right">
                    {formatDuration(displayTimeVal)}
                  </span>
                  <div
                    ref={seekBarRef}
                    className="relative flex-1 h-1 cursor-pointer"
                    style={{ touchAction: 'none' }}
                    onPointerDown={onSeekPointerDown}
                    onPointerMove={onSeekPointerMove}
                    onPointerUp={onSeekPointerUp}
                    onMouseMove={e => setHoverRatio(getSeekRatio(e.clientX))}
                    onMouseLeave={() => setHoverRatio(null)}
                  >
                    {/* Extended hit area */}
                    <div className="absolute inset-x-0 -top-3 -bottom-3" />
                    {/* Track */}
                    <div className="absolute inset-0 bg-white/20 rounded-full" />
                    {/* Buffer */}
                    <div className="absolute inset-y-0 left-0 bg-white/30 rounded-full" style={{ width: `${bufferedProgress}%` }} />
                    {/* Played */}
                    <div className="absolute inset-y-0 left-0 bg-white/90 rounded-full" style={{ width: `${displayProgress}%` }} />
                    {/* Chapter markers */}
                    {chapters.map((ch, i) => (
                      <div
                        key={i}
                        className="absolute top-1/2 -translate-y-1/2 w-0.5 h-3 bg-white/50 pointer-events-none z-10"
                        style={{ left: `${(ch.time / duration) * 100}%` }}
                      />
                    ))}
                    {/* Thumb */}
                    <div
                      className="absolute w-3 h-3 bg-red-500 rounded-full top-1/2 -translate-y-1/2 shadow-lg"
                      style={{ left: `calc(${displayProgress}% - 6px)` }}
                    />
                    {/* Hover time tooltip */}
                    {hoverRatio !== null && duration > 0 && (
                      <div
                        className="absolute bottom-full mb-3 pointer-events-none -translate-x-1/2 flex flex-col items-center gap-1"
                        style={{ left: `${hoverRatio * 100}%` }}
                      >
                        {hoverChapter && (
                          <div className="bg-black/80 text-white/70 text-[10px] px-2 py-0.5 rounded whitespace-nowrap max-w-[160px] truncate">
                            {hoverChapter.title}
                          </div>
                        )}
                        <div className="bg-black/85 text-white text-xs px-2 py-1 rounded font-mono whitespace-nowrap">
                          {formatDuration(hoverTimeVal)}
                        </div>
                      </div>
                    )}
                  </div>
                  <span className="text-white/40 text-xs tabular-nums shrink-0 w-11">
                    {duration > 0 ? formatDuration(duration) : ''}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-white text-xs font-medium">LIVE</span>
                </div>
              )}

              {/* Button row */}
              <div className="flex items-center justify-between">
                {/* Left */}
                <div className="flex items-center gap-0.5">
                  {onPrev && (
                    <button
                      onClick={e => { e.stopPropagation(); onPrev() }}
                      disabled={!hasPrev}
                      className={`w-10 h-10 flex items-center justify-center transition-colors ${hasPrev ? 'text-white hover:text-white/70' : 'text-white/25 cursor-not-allowed'}`}
                    >
                      <SkipBack className="w-5 h-5 fill-current" />
                    </button>
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); togglePlay() }}
                    className="w-10 h-10 flex items-center justify-center text-white hover:text-white/70 transition-colors"
                  >
                    {playing
                      ? <Pause className="w-6 h-6 fill-current" />
                      : <Play className="w-6 h-6 fill-current translate-x-0.5" />}
                  </button>
                  {onNext && (
                    <button
                      onClick={e => { e.stopPropagation(); onNext() }}
                      disabled={!hasNext}
                      className={`w-10 h-10 flex items-center justify-center transition-colors ${hasNext ? 'text-white hover:text-white/70' : 'text-white/25 cursor-not-allowed'}`}
                    >
                      <SkipForward className="w-5 h-5 fill-current" />
                    </button>
                  )}
                  {!isLive && (
                    <>
                      <button
                        onClick={e => { e.stopPropagation(); const v = videoRef.current; if (v) v.currentTime = Math.max(0, v.currentTime - 10) }}
                        className="w-10 h-10 flex items-center justify-center text-white hover:text-white/70 transition-colors"
                        title="Reculer 10s"
                      >
                        <RotateCcw className="w-5 h-5" />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); const v = videoRef.current; if (v) v.currentTime = Math.min(v.duration || 0, v.currentTime + 10) }}
                        className="w-10 h-10 flex items-center justify-center text-white hover:text-white/70 transition-colors"
                        title="Avancer 10s"
                      >
                        <RotateCw className="w-5 h-5" />
                      </button>
                    </>
                  )}
                  <div className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={toggleMute}
                      className="w-10 h-10 flex items-center justify-center text-white hover:text-white/70 transition-colors"
                    >
                      {muted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                    </button>
                    {(!isMobile || fullscreen) && (
                      <VolumeSlider
                        volume={volume}
                        muted={muted}
                        onChange={v => handleVolumeChange({ target: { value: String(v) } } as React.ChangeEvent<HTMLInputElement>)}
                        className="hidden sm:flex w-16"
                      />
                    )}
                  </div>
                </div>

                {/* Right */}
                <div className="flex items-center gap-0.5">
                  {!isLive && (!isMobile || fullscreen) && (
                    <button
                      onClick={e => { e.stopPropagation(); setShowSpeedMenu(v => !v); setShowQualityMenu(false); setShowSubtitleMenu(false) }}
                      className={`w-10 h-10 flex items-center justify-center rounded-full transition-colors text-xs font-bold ${showSpeedMenu ? 'bg-red-600 text-white' : 'text-white/80 hover:text-white'}`}
                      title="Vitesse"
                    >
                      {speed === 1 ? '1×' : `${speed}×`}
                    </button>
                  )}
                  {!isLive && (!isMobile || fullscreen) && (
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        if (subtitleTracks.length === 0) {
                          getSubtitles(videoId).then(tracks => { setSubtitleTracks(tracks); setShowSubtitleMenu(true) })
                        } else {
                          setShowSubtitleMenu(v => !v)
                        }
                        setShowSpeedMenu(false); setShowQualityMenu(false)
                      }}
                      className={`w-10 h-10 flex items-center justify-center rounded-full transition-colors ${showSubtitleMenu || selectedSubtitle !== 'off' ? 'bg-red-600 text-white' : 'text-white/80 hover:text-white'}`}
                      title="Sous-titres"
                    >
                      <span className="text-xs font-bold leading-none">CC</span>
                    </button>
                  )}
                  {!isLive && allVideoFormats.length > 0 && (!isMobile || fullscreen) && (
                    <button
                      onClick={e => { e.stopPropagation(); setShowQualityMenu(v => !v); setShowSpeedMenu(false); setShowSubtitleMenu(false) }}
                      className={`w-10 h-10 flex items-center justify-center rounded-full transition-colors ${showQualityMenu ? 'bg-red-600 text-white' : 'text-white/80 hover:text-white'}`}
                      title="Qualité"
                    >
                      <Settings className="w-5 h-5" />
                    </button>
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); toggleFullscreen() }}
                    className="w-10 h-10 flex items-center justify-center text-white/80 hover:text-white transition-colors"
                  >
                    {fullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

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
