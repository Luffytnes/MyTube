'use client'

import { useState, useEffect, useRef, useCallback, RefObject } from 'react'
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  Loader2, List, X, RotateCcw, RotateCw, Check, Headphones,
  SkipBack, SkipForward, PictureInPicture2,
} from 'lucide-react'
import VolumeSlider from '@/components/ui/VolumeSlider'
import { useExtensions, onExtensionsChange, stepVolume, volumeToSlider } from '@/lib/extensions'
import { claimMediaSession, releaseMediaSession, updateMediaSession } from '@/lib/mediaSession'
import { attachAudioEffects, needsAudioGraph } from '@/lib/audioEffects'
import { useWheelVolume } from '@/lib/useWheelVolume'
import { useRegion } from '@/lib/regionContext'

// Preview frames are generated every 10 s of the film (one image per step)
const PREVIEW_STEP = 10

interface SubCue { start: number; end: number; lines: string[] }

function toSec(ts: string): number {
  const parts = ts.trim().split(':')
  return parts.length === 3
    ? +parts[0] * 3600 + +parts[1] * 60 + parseFloat(parts[2].replace(',', '.'))
    : +parts[0] * 60 + parseFloat(parts[1].replace(',', '.'))
}

function cleanVTTText(text: string): string {
  return text.replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '').trim()
}

function parseVTT(text: string): SubCue[] {
  const cues: SubCue[] = []
  for (const block of text.split(/\n\n+/)) {
    const lines = block.trim().split('\n')
    const ai = lines.findIndex(l => l.includes('-->'))
    if (ai < 0) continue
    const [s, e] = lines[ai].split('-->').map(p => p.trim())
    const textLines = lines.slice(ai + 1).map(cleanVTTText).filter(Boolean)
    if (textLines.length) cues.push({ start: toSec(s), end: toSec(e), lines: textLines })
  }
  return cues
}

function fmt(sec: number): string {
  if (!isFinite(sec) || isNaN(sec) || sec < 0) return '0:00'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

interface Track { index: number; language: string; title: string; codec?: string }

function TrackPanel({
  title, icon, tracks, selected, nullable, onSelect,
}: {
  title: string
  icon: React.ReactNode
  tracks: Track[]
  selected: number | null
  nullable: boolean
  onSelect: (v: number | null) => void
}) {
  return (
    <div className="w-72 bg-[#141010] border border-white/[0.07] rounded-xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.07]">
        <div className="w-7 h-7 bg-red-950/70 rounded-lg flex items-center justify-center text-red-500 shrink-0">
          {icon}
        </div>
        <span className="text-white text-sm font-semibold">{title}</span>
      </div>
      <div className="max-h-60 overflow-y-auto">
        {nullable && (
          <button
            onClick={() => onSelect(null)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                <X className="w-3 h-3 text-white/50" />
              </div>
              <span className={`text-sm ${selected === null ? 'text-white font-medium' : 'text-white/55'}`}>
                Désactivés
              </span>
            </div>
            {selected === null && (
              <div className="w-5 h-5 rounded-full bg-red-600 flex items-center justify-center shrink-0">
                <Check className="w-3 h-3 text-white" />
              </div>
            )}
          </button>
        )}
        {tracks.map(t => {
          const isActive = selected === t.index
          const label = [
            t.language && t.language !== 'und' ? t.language.toUpperCase() : '',
            t.title || '',
          ].filter(Boolean).join(' — ') || `Piste ${t.index + 1}`
          return (
            <button
              key={t.index}
              onClick={() => onSelect(t.index)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
            >
              <span className={`text-sm ${isActive ? 'text-white font-medium' : 'text-white/55'}`}>{label}</span>
              {isActive && (
                <div className="w-5 h-5 rounded-full bg-red-600 flex items-center justify-center shrink-0">
                  <Check className="w-3 h-3 text-white" />
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export interface QueueItem {
  id: string
  label: string
  sublabel?: string
  href: string
  icon?: string
}

export interface TvVideoPlayerProps {
  videoRef: RefObject<HTMLVideoElement | null>
  loading: boolean
  error: string | null
  onErrorBack: () => void
  title?: string
  audioTracks?: Track[]
  subTracks?: Track[]
  audioIdx?: number
  subIdx?: number | null
  subUrl?: string | null
  onAudioChange?: (idx: number) => void
  onSubChange?: (idx: number | null) => void
  onTimeUpdate?: () => void
  queue?: QueueItem[]
  currentQueueId?: string
  queueTitle?: string
  onEnded?: () => void
  onPrev?: () => void
  onNext?: () => void
  timeOffset?: number
  externalDuration?: number
  onNeedNewSession?: (absoluteTime: number) => void
  /** Seek-bar preview image at an absolute time (films and episodes) */
  previewUrl?: (time: number) => string
  /** Media Session (media keys, Control Center) */
  artwork?: string
  artist?: string
  /** Called every few minutes while paused, so the server keeps the film's session */
  onKeepAlive?: () => void
}

export default function TvVideoPlayer({
  videoRef, loading, error, onErrorBack,
  title,
  audioTracks = [], subTracks = [],
  audioIdx = 0, subIdx = null,
  subUrl = null,
  onAudioChange, onSubChange,
  onTimeUpdate,
  queue = [], currentQueueId, queueTitle = 'Liste de lecture',
  onEnded, onPrev, onNext,
  timeOffset = 0, externalDuration, onNeedNewSession,
  previewUrl, artwork, artist, onKeepAlive,
}: TvVideoPlayerProps) {
  const { t } = useRegion()
  const ext = useExtensions()
  const containerRef = useRef<HTMLDivElement>(null)
  const volumeGroupRef = useRef<HTMLDivElement>(null)
  const mediaSessionId = useRef(Symbol('tv-player'))
  const lastSessionUpdate = useRef(0)
  const [pipSupported, setPipSupported] = useState(false)
  const [volumeHud, setVolumeHud] = useState<number | null>(null)
  const volumeHudTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Preview image shown for this step once it has loaded (debounced while moving)
  const [previewStep, setPreviewStep] = useState<number | null>(null)
  const [previewLoaded, setPreviewLoaded] = useState<number | null>(null)
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [waiting, setWaiting] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showQueue, setShowQueue] = useState(false)
  const [openPanel, setOpenPanel] = useState<'audio' | 'sub' | null>(null)
  const [activeCue, setActiveCue] = useState<string[] | null>(null)

  const subCuesRef = useRef<SubCue[]>([])
  const timeOffsetRef = useRef(timeOffset)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragging = useRef(false)
  // Position previewed while dragging; the seek is committed once, on release
  const [scrubTime, setScrubTime] = useState<number | null>(null)
  const showQueueRef = useRef(false)
  const openPanelRef = useRef<'audio' | 'sub' | null>(null)
  const seekRef = useRef<HTMLDivElement>(null)
  const activeQueueItemRef = useRef<HTMLAnchorElement>(null)
  const [hoverRatio, setHoverRatio] = useState<number | null>(null)

  function setOpenPanelBoth(val: 'audio' | 'sub' | null) {
    openPanelRef.current = val
    setOpenPanel(val)
  }

  // Video events
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onTime = () => {
      setCurrentTime(v.currentTime)
      onTimeUpdate?.()
      const t = v.currentTime + timeOffsetRef.current
      const cue = subCuesRef.current.find(c => t >= c.start && t <= c.end) ?? null
      setActiveCue(cue ? cue.lines : null)
    }
    const onDur = () => setDuration(isFinite(v.duration) && v.duration > 0 ? v.duration : 0)
    const onPlay = () => {
      setPlaying(true); setWaiting(false)
      claimSessionRef.current()
      if (needsAudioGraph()) void attachAudioEffects(v)
    }
    const onPause = () => { setPlaying(false); updateMediaSession(mediaSessionId.current, false) }
    const onVol = () => { setVolume(v.volume); setMuted(v.muted) }
    const onProg = () => { if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1)) }
    const onWait = () => setWaiting(true)
    const onCanPlay = () => setWaiting(false)
    const onEnd = () => onEnded?.()
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('durationchange', onDur)
    v.addEventListener('loadedmetadata', onDur)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('volumechange', onVol)
    v.addEventListener('progress', onProg)
    v.addEventListener('waiting', onWait)
    v.addEventListener('canplay', onCanPlay)
    v.addEventListener('ended', onEnd)
    return () => {
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('durationchange', onDur)
      v.removeEventListener('loadedmetadata', onDur)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('volumechange', onVol)
      v.removeEventListener('progress', onProg)
      v.removeEventListener('waiting', onWait)
      v.removeEventListener('canplay', onCanPlay)
      v.removeEventListener('ended', onEnd)
    }
  }, [videoRef, onTimeUpdate, onEnded])

  useEffect(() => { setPipSupported(!!document.pictureInPictureEnabled) }, [])

  // An effect switched on during playback applies at once
  useEffect(() => onExtensionsChange(() => {
    const v = videoRef.current
    if (v && !v.paused && needsAudioGraph()) void attachAudioEffects(v)
  }), [videoRef])

  useEffect(() => {
    const id = mediaSessionId.current
    return () => {
      releaseMediaSession(id)
      if (volumeHudTimer.current) clearTimeout(volumeHudTimer.current)
      if (previewTimer.current) clearTimeout(previewTimer.current)
    }
  }, [])

  // The server drops a film session nobody asked anything for 10 minutes, and a
  // paused player asks nothing: resuming after a long pause then hit 404s
  const keepAliveRef = useRef(onKeepAlive)
  keepAliveRef.current = onKeepAlive
  useEffect(() => {
    const timer = setInterval(() => {
      const v = videoRef.current
      if (v && v.paused && !v.ended) keepAliveRef.current?.()
    }, 4 * 60_000)
    return () => clearInterval(timer)
  }, [videoRef])

  // Position for media keys / Control Center, about once a second
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onTime = () => {
      const now = Date.now()
      if (now - lastSessionUpdate.current < 1000) return
      lastSessionUpdate.current = now
      updateMediaSession(mediaSessionId.current, !v.paused, {
        duration: externalDuration ?? v.duration,
        position: timeOffsetRef.current + v.currentTime,
        playbackRate: v.playbackRate,
      })
    }
    v.addEventListener('timeupdate', onTime)
    return () => v.removeEventListener('timeupdate', onTime)
  }, [videoRef, externalDuration])

  // Fullscreen listener
  useEffect(() => {
    const fn = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', fn)
    return () => document.removeEventListener('fullscreenchange', fn)
  }, [])

  // Keep timeOffsetRef in sync so the stale onTime closure always has the latest offset
  useEffect(() => { timeOffsetRef.current = timeOffset }, [timeOffset])

  // Fetch and parse WebVTT subtitle file when subUrl changes
  useEffect(() => {
    subCuesRef.current = []
    setActiveCue(null)
    if (!subUrl) return
    let cancelled = false
    fetch(subUrl)
      .then(r => r.text())
      .then(text => { if (!cancelled) subCuesRef.current = parseVTT(text) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [subUrl])

  // Scroll to active queue item on open
  useEffect(() => {
    if (showQueue) activeQueueItemRef.current?.scrollIntoView({ block: 'nearest' })
  }, [showQueue])

  function toggleQueue(e: React.MouseEvent) {
    e.stopPropagation()
    const next = !showQueueRef.current
    showQueueRef.current = next
    setShowQueue(next)
    if (next) setOpenPanelBoth(null)
  }

  const revealControls = useCallback(() => {
    setShowControls(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      if (!dragging.current && !showQueueRef.current && !openPanelRef.current) setShowControls(false)
    }, 3000)
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      const v = videoRef.current
      if (!v) return
      if (e.code === 'Space') { e.preventDefault(); v.paused ? v.play().catch(() => {}) : v.pause() }
      if (e.code === 'ArrowRight') { e.preventDefault(); skipRef.current(10) }
      if (e.code === 'ArrowLeft') { e.preventDefault(); skipRef.current(-10) }
      if (e.code === 'KeyM') { e.preventDefault(); v.muted = !v.muted }
      if (e.code === 'ArrowUp') { e.preventDefault(); applyVolumeRef.current(stepVolume(v.volume, 1)) }
      if (e.code === 'ArrowDown') { e.preventDefault(); applyVolumeRef.current(stepVolume(v.volume, -1)) }
      if (e.code === 'KeyF') { e.preventDefault(); handleFullscreen() }
      revealControls()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [videoRef, revealControls])

  function togglePlay(e: React.MouseEvent) {
    e.stopPropagation()
    // Close panels on click
    if (openPanel) { setOpenPanelBoth(null); return }
    if (showQueue) { showQueueRef.current = false; setShowQueue(false); return }
    const v = videoRef.current
    if (!v) return
    v.paused ? v.play().catch(() => {}) : v.pause()
    revealControls()
  }

  function handleFullscreen() {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen().catch(() => {})
    else document.exitFullscreen().catch(() => {})
  }

  function timeAt(clientX: number): number | null {
    const bar = seekRef.current
    const displayDur = externalDuration ?? duration
    if (!bar || !displayDur) return null
    const { left, width } = bar.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - left) / width)) * displayDur
  }

  /** Seek to an absolute time. Inside the part the current session has already
   *  transcoded, seek locally; otherwise ask the page for a new session (which
   *  restarts ffmpeg, so it must not happen on every pointer move). */
  function commitSeek(absoluteT: number) {
    const v = videoRef.current
    if (!v) return
    const displayDur = externalDuration ?? duration
    const target = Math.max(0, displayDur ? Math.min(displayDur, absoluteT) : absoluteT)
    const rel = target - timeOffset
    const seekable = v.seekable
    const seekableEnd = seekable.length ? seekable.end(seekable.length - 1) : 0
    if (!onNeedNewSession || (rel >= 0 && rel <= seekableEnd - 1)) {
      const clamped = Math.max(0, Math.min(v.duration || displayDur, rel))
      v.currentTime = clamped
      setCurrentTime(clamped)
    } else {
      onNeedNewSession(target)
    }
  }

  function onSeekDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = true
    setScrubTime(timeAt(e.clientX))
  }
  function onSeekMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return
    setScrubTime(timeAt(e.clientX))
  }
  function onSeekUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return
    dragging.current = false
    setScrubTime(null)
    const t = timeAt(e.clientX)
    if (t !== null) commitSeek(t)
  }

  function skip(sec: number) {
    const v = videoRef.current
    if (!v) return
    commitSeek(timeOffset + v.currentTime + sec)
    revealControls()
  }

  const skipRef = useRef(skip)
  skipRef.current = skip

  function applyVolume(val: number) {
    const v = videoRef.current
    if (!v) return
    v.volume = val
    v.muted = val === 0
    setVolumeHud(Math.round(volumeToSlider(val) * 100))
    if (volumeHudTimer.current) clearTimeout(volumeHudTimer.current)
    volumeHudTimer.current = setTimeout(() => setVolumeHud(null), 900)
  }
  const applyVolumeRef = useRef(applyVolume)
  applyVolumeRef.current = applyVolume

  function claimSession() {
    claimMediaSession(mediaSessionId.current, {
      title: title ?? '',
      artist: artist ?? 'MyTube TV',
      artwork: artwork ? [{ src: artwork, sizes: '512x512', type: 'image/jpeg' }] : [],
    }, {
      play: () => { videoRef.current?.play().catch(() => {}) },
      pause: () => { videoRef.current?.pause() },
      seekbackward: onNeedNewSession ? () => skipRef.current(-10) : null,
      seekforward: onNeedNewSession ? () => skipRef.current(10) : null,
      seekto: onNeedNewSession ? details => { if (details.seekTime !== undefined) commitSeekRef.current(details.seekTime) } : null,
      previoustrack: onPrev ? () => onPrev() : null,
      nexttrack: onNext ? () => onNext() : null,
    })
  }
  const claimSessionRef = useRef(claimSession)
  claimSessionRef.current = claimSession
  const commitSeekRef = useRef(commitSeek)
  commitSeekRef.current = commitSeek

  async function togglePictureInPicture(e: React.MouseEvent) {
    e.stopPropagation()
    const v = videoRef.current
    if (!v) return
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else await v.requestPictureInPicture()
    } catch { /* refused */ }
  }

  useWheelVolume(volumeGroupRef, () => videoRef.current?.volume ?? volume, applyVolume)
  useWheelVolume(containerRef, () => videoRef.current?.volume ?? volume, applyVolume, isFullscreen)

  /** Show the preview of the step under the pointer, once it stays there briefly
   *  (each image is made by ffmpeg on the server). */
  function hoverPreview(ratio: number | null) {
    if (!previewUrl || !ext.seekPreview) return
    const dur = externalDuration ?? duration
    if (previewTimer.current) clearTimeout(previewTimer.current)
    if (ratio === null || !dur) { setPreviewStep(null); return }
    const step = Math.floor((ratio * dur) / PREVIEW_STEP) * PREVIEW_STEP
    previewTimer.current = setTimeout(() => setPreviewStep(step), 120)
  }

  const displayDur = externalDuration ?? duration
  const displayTime = scrubTime ?? currentTime + timeOffset
  const displayBuffered = buffered + timeOffset
  const playedPct = displayDur > 0 ? Math.min(100, (displayTime / displayDur) * 100) : 0
  const bufPct = displayDur > 0 ? Math.min(100, (displayBuffered / displayDur) * 100) : 0
  const controlsVisible = showControls || !playing || showQueue || openPanel !== null

  const hasAudio = audioTracks.length > 1 && !!onAudioChange
  const hasSub = subTracks.length > 0 && !!onSubChange

  return (
    <div
      ref={containerRef}
      className="relative bg-black rounded-xl overflow-hidden select-none"
      style={{ aspectRatio: '16/9' }}
      onMouseMove={revealControls}
      onMouseLeave={() => { if (playing && !dragging.current) setShowControls(false) }}
      onTouchStart={revealControls}
      onDoubleClick={handleFullscreen}
    >
      <video ref={videoRef} className="w-full h-full" playsInline crossOrigin="anonymous" onClick={togglePlay} />

      {/* Spinner */}
      {(loading || waiting) && !error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Loader2 className="w-12 h-12 text-white/80 animate-spin" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black text-white px-4">
          <p className="text-base mb-4 text-center">{error}</p>
          <button onClick={onErrorBack} className="px-4 py-2 bg-white/20 rounded-full text-sm hover:bg-white/30 transition-colors">
            Retour
          </button>
        </div>
      )}

      {/* Subtitle overlay */}
      {activeCue && (
        <div className="absolute bottom-20 left-0 right-0 flex justify-center pointer-events-none z-20 px-6">
          <div className="bg-black/80 text-white text-sm sm:text-base px-4 py-2 rounded-lg text-center max-w-[85%] leading-snug">
            {activeCue.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        </div>
      )}

      {volumeHud !== null && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-40 pointer-events-none bg-black/70 backdrop-blur-md rounded-full px-4 py-1.5 text-white text-sm font-semibold tabular-nums">
          {t('player_volume')} {volumeHud} %
        </div>
      )}

      {/* Controls overlay */}
      {!error && (
        <div
          className={`absolute inset-0 flex flex-col justify-between transition-opacity duration-300 ${controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          onClick={togglePlay}
        >
          {/* Top gradient + title */}
          <div className="relative pointer-events-none">
            <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/75 to-transparent" />
            {title && (
              <p className="relative text-center text-white font-bold text-sm pt-4 drop-shadow-lg px-10 truncate">
                {title}
              </p>
            )}
          </div>

          {/* Bottom zone */}
          <div className="relative" onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
            {/* Bottom gradient */}
            <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/90 to-transparent pointer-events-none" />

            {/* Floating panels — above controls */}
            <div className="absolute bottom-full right-0 mb-2 px-4 flex flex-col items-end gap-2 z-50">
              {/* Queue panel */}
              {showQueue && queue.length > 0 && (
                <div className="w-64 bg-[#141010] border border-white/[0.07] rounded-xl overflow-hidden shadow-2xl">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.07]">
                    <p className="text-white text-sm font-semibold">{queueTitle}</p>
                    <button onClick={toggleQueue} className="text-white/40 hover:text-white transition-colors ml-2 shrink-0">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="max-h-64 overflow-y-auto py-1">
                    {queue.map(item => {
                      const isActive = item.id === currentQueueId
                      return (
                        <a
                          key={item.id}
                          href={item.href}
                          ref={isActive ? activeQueueItemRef : null}
                          className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${isActive ? 'bg-white/10' : 'hover:bg-white/5'}`}
                        >
                          {item.icon ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={item.icon} alt=""
                              className="w-7 h-7 rounded object-contain bg-white/5 shrink-0"
                              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                            />
                          ) : (
                            <div className={`w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold ${isActive ? 'bg-red-600 text-white' : 'bg-white/10 text-white/60'}`}>
                              {isActive ? <Play className="w-3 h-3 fill-current" /> : item.label.match(/\d+/)?.[0] || '•'}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs font-medium truncate ${isActive ? 'text-red-400' : 'text-white/70'}`}>{item.label}</p>
                            {item.sublabel && <p className="text-[10px] text-white/35">{item.sublabel}</p>}
                          </div>
                          {isActive && (
                            <div className="w-4 h-4 rounded-full bg-red-600 flex items-center justify-center shrink-0">
                              <Check className="w-2.5 h-2.5 text-white" />
                            </div>
                          )}
                        </a>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Audio panel */}
              {openPanel === 'audio' && hasAudio && (
                <TrackPanel
                  title="Audio"
                  icon={<Headphones className="w-4 h-4" />}
                  tracks={audioTracks}
                  selected={audioIdx}
                  nullable={false}
                  onSelect={v => { if (v !== null) onAudioChange!(v); setOpenPanelBoth(null) }}
                />
              )}

              {/* Subtitles panel */}
              {openPanel === 'sub' && hasSub && (
                <TrackPanel
                  title="Sous-titres"
                  icon={<span className="text-[10px] font-bold leading-none">CC</span>}
                  tracks={subTracks}
                  selected={subIdx}
                  nullable={true}
                  onSelect={v => { onSubChange!(v); setOpenPanelBoth(null) }}
                />
              )}
            </div>

            {/* Controls bar */}
            <div className="relative px-4 pb-4 pt-2 space-y-2">
              {/* Seek row */}
              <div className="flex items-center gap-2.5">
                <span className="text-white text-xs tabular-nums shrink-0 w-11 text-right">{fmt(displayTime)}</span>
                <div
                  ref={seekRef}
                  className="relative flex-1 h-1 cursor-pointer"
                  style={{ touchAction: 'none' }}
                  onPointerDown={onSeekDown}
                  onPointerMove={onSeekMove}
                  onPointerUp={onSeekUp}
                  onClick={e => e.stopPropagation()}
                  onMouseMove={e => {
                    const bar = seekRef.current
                    if (!bar) return
                    const { left, width } = bar.getBoundingClientRect()
                    const ratio = Math.max(0, Math.min(1, (e.clientX - left) / width))
                    setHoverRatio(ratio)
                    hoverPreview(ratio)
                  }}
                  onMouseLeave={() => { setHoverRatio(null); hoverPreview(null) }}
                >
                  {/* Extended hit area */}
                  <div className="absolute inset-x-0 -top-3 -bottom-3" />
                  <div className="absolute inset-0 bg-white/20 rounded-full" />
                  <div className="absolute inset-y-0 left-0 bg-white/30 rounded-full" style={{ width: `${bufPct}%` }} />
                  <div className="absolute inset-y-0 left-0 bg-white/90 rounded-full" style={{ width: `${playedPct}%` }} />
                  <div
                    className="absolute w-3 h-3 bg-red-500 rounded-full top-1/2 -translate-y-1/2 shadow-lg"
                    style={{ left: `calc(${playedPct}% - 6px)` }}
                  />
                  {/* Hover time tooltip */}
                  {hoverRatio !== null && displayDur > 0 && (
                    <div
                      className="absolute bottom-full mb-3 pointer-events-none -translate-x-1/2 flex flex-col items-center gap-1 z-20"
                      style={{ left: previewUrl && ext.seekPreview ? `clamp(96px, ${hoverRatio * 100}%, calc(100% - 96px))` : `${hoverRatio * 100}%` }}
                    >
                      {previewUrl && ext.seekPreview && previewStep !== null && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={previewUrl(previewStep)}
                          alt=""
                          width={192}
                          className={`w-48 aspect-video object-cover rounded-lg ring-1 ring-white/25 shadow-2xl bg-black ${previewLoaded === previewStep ? '' : 'hidden'}`}
                          onLoad={() => setPreviewLoaded(previewStep)}
                          onError={() => setPreviewLoaded(null)}
                        />
                      )}
                      <div className="bg-black/85 text-white text-xs px-2 py-1 rounded font-mono whitespace-nowrap">
                        {fmt(hoverRatio * displayDur)}
                      </div>
                    </div>
                  )}
                </div>
                <span className="text-white/40 text-xs tabular-nums shrink-0 w-11">
                  {displayDur > 0 ? fmt(displayDur) : ''}
                </span>
              </div>

              {/* Button row */}
              <div className="flex items-center justify-between">
                {/* Left: Prev ep, Play, Next ep, Rewind, Forward, Volume */}
                <div className="flex items-center gap-0.5">
                  {onPrev && (
                    <button
                      onClick={e => { e.stopPropagation(); onPrev() }}
                      className="w-10 h-10 flex items-center justify-center text-white/70 hover:text-white transition-colors"
                      title="Épisode précédent"
                    >
                      <SkipBack className="w-5 h-5 fill-current" />
                    </button>
                  )}
                  <button
                    onClick={togglePlay}
                    className="w-10 h-10 flex items-center justify-center text-white hover:text-white/70 transition-colors"
                  >
                    {playing
                      ? <Pause className="w-6 h-6 fill-current" />
                      : <Play className="w-6 h-6 fill-current translate-x-0.5" />}
                  </button>
                  {onNext && (
                    <button
                      onClick={e => { e.stopPropagation(); onNext() }}
                      className="w-10 h-10 flex items-center justify-center text-white/70 hover:text-white transition-colors"
                      title="Épisode suivant"
                    >
                      <SkipForward className="w-5 h-5 fill-current" />
                    </button>
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); skip(-10) }}
                    className="w-10 h-10 flex items-center justify-center text-white hover:text-white/70 transition-colors"
                    title="Reculer 10s"
                  >
                    <RotateCcw className="w-5 h-5" />
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); skip(10) }}
                    className="w-10 h-10 flex items-center justify-center text-white hover:text-white/70 transition-colors"
                    title="Avancer 10s"
                  >
                    <RotateCw className="w-5 h-5" />
                  </button>
                  <div ref={volumeGroupRef} className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => { const v = videoRef.current; if (v) v.muted = !v.muted }}
                      className="w-10 h-10 flex items-center justify-center text-white hover:text-white/70 transition-colors"
                    >
                      {muted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                    </button>
                    <VolumeSlider
                      volume={volume}
                      muted={muted}
                      onChange={val => {
                        const v = videoRef.current
                        if (!v) return
                        v.volume = val
                        v.muted = val === 0
                      }}
                      className="hidden sm:flex w-16"
                    />
                  </div>
                </div>

                {/* Right: Audio, CC, Queue, Fullscreen */}
                <div className="flex items-center gap-0.5">
                  {hasAudio && (
                    <button
                      onClick={e => { e.stopPropagation(); setOpenPanelBoth(openPanel === 'audio' ? null : 'audio'); showQueueRef.current = false; setShowQueue(false) }}
                      className={`w-10 h-10 flex items-center justify-center rounded-full transition-colors ${openPanel === 'audio' ? 'bg-red-600 text-white' : 'text-white/80 hover:text-white'}`}
                      title="Piste audio"
                    >
                      <Headphones className="w-5 h-5" />
                    </button>
                  )}
                  {hasSub && (
                    <button
                      onClick={e => { e.stopPropagation(); setOpenPanelBoth(openPanel === 'sub' ? null : 'sub'); showQueueRef.current = false; setShowQueue(false) }}
                      className={`w-10 h-10 flex items-center justify-center rounded-full transition-colors ${openPanel === 'sub' ? 'bg-red-600 text-white' : 'text-white/80 hover:text-white'}`}
                      title="Sous-titres"
                    >
                      <span className="text-xs font-bold leading-none">CC</span>
                    </button>
                  )}
                  {queue.length > 0 && (
                    <button
                      onClick={toggleQueue}
                      className={`w-10 h-10 flex items-center justify-center rounded-full transition-colors ${showQueue ? 'bg-red-600 text-white' : 'text-white/80 hover:text-white'}`}
                      title={queueTitle}
                    >
                      <List className="w-5 h-5" />
                    </button>
                  )}
                  {pipSupported && (
                    <button
                      onClick={togglePictureInPicture}
                      className="w-10 h-10 flex items-center justify-center text-white/80 hover:text-white transition-colors"
                      title={t('player_pip')}
                    >
                      <PictureInPicture2 className="w-5 h-5" />
                    </button>
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); handleFullscreen() }}
                    className="w-10 h-10 flex items-center justify-center text-white/80 hover:text-white transition-colors"
                  >
                    {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
