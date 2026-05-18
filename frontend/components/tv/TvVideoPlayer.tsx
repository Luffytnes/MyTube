'use client'

import { useState, useEffect, useRef, useCallback, RefObject } from 'react'
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  Loader2, List, X, RotateCcw, RotateCw, Check, Headphones,
  SkipBack, SkipForward,
} from 'lucide-react'
import VolumeSlider from '@/components/ui/VolumeSlider'

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
  videoRef: RefObject<HTMLVideoElement>
  loading: boolean
  error: string | null
  onErrorBack: () => void
  title?: string
  subUrl?: string | null
  audioTracks?: Track[]
  subTracks?: Track[]
  audioIdx?: number
  subIdx?: number | null
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
}

export default function TvVideoPlayer({
  videoRef, loading, error, onErrorBack,
  title,
  subUrl,
  audioTracks = [], subTracks = [],
  audioIdx = 0, subIdx = null,
  onAudioChange, onSubChange,
  onTimeUpdate,
  queue = [], currentQueueId, queueTitle = 'Liste de lecture',
  onEnded, onPrev, onNext,
  timeOffset = 0, externalDuration, onNeedNewSession,
}: TvVideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
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

  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragging = useRef(false)
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
    const onTime = () => { setCurrentTime(v.currentTime); onTimeUpdate?.() }
    const onDur = () => setDuration(isFinite(v.duration) && v.duration > 0 ? v.duration : 0)
    const onPlay = () => { setPlaying(true); setWaiting(false) }
    const onPause = () => setPlaying(false)
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

  // Fullscreen listener
  useEffect(() => {
    const fn = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', fn)
    return () => document.removeEventListener('fullscreenchange', fn)
  }, [])

  // Subtitle track (imperative)
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    Array.from(v.querySelectorAll('track[kind="subtitles"]')).forEach(t => t.remove())
    Array.from(v.textTracks).forEach(t => { t.mode = 'disabled' })
    if (!subUrl) return
    const el = document.createElement('track')
    el.kind = 'subtitles'
    el.src = subUrl
    el.default = true
    v.appendChild(el)
    const onLoad = () => { el.track.mode = 'showing' }
    el.addEventListener('load', onLoad)
    const timer = setTimeout(() => { el.track.mode = 'showing' }, 300)
    return () => {
      el.removeEventListener('load', onLoad)
      clearTimeout(timer)
      el.remove()
      Array.from(v.textTracks).forEach(t => { t.mode = 'disabled' })
    }
  }, [subUrl, videoRef])

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
      if (e.code === 'ArrowRight') { e.preventDefault(); v.currentTime = Math.min(v.duration || 0, v.currentTime + 10) }
      if (e.code === 'ArrowLeft') { e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - 10) }
      if (e.code === 'KeyM') { e.preventDefault(); v.muted = !v.muted }
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

  function seekTo(clientX: number) {
    const bar = seekRef.current
    const v = videoRef.current
    const displayDur = externalDuration ?? duration
    if (!bar || !v || !displayDur) return
    const { left, width } = bar.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - left) / width))
    const absoluteT = ratio * displayDur
    if (onNeedNewSession) {
      onNeedNewSession(absoluteT)
    } else {
      const clamped = Math.max(0, Math.min(v.duration || displayDur, absoluteT - timeOffset))
      v.currentTime = clamped
      setCurrentTime(clamped)
    }
  }

  function onSeekDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = true
    seekTo(e.clientX)
  }
  function onSeekMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return
    seekTo(e.clientX)
  }
  function onSeekUp(e: React.PointerEvent<HTMLDivElement>) {
    dragging.current = false
    seekTo(e.clientX)
  }

  function skip(sec: number) {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + sec))
    revealControls()
  }

  const displayDur = externalDuration ?? duration
  const displayTime = currentTime + timeOffset
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
          <div className="relative" onClick={e => e.stopPropagation()}>
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
                    setHoverRatio(Math.max(0, Math.min(1, (e.clientX - left) / width)))
                  }}
                  onMouseLeave={() => setHoverRatio(null)}
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
                      className="absolute bottom-full mb-3 pointer-events-none -translate-x-1/2"
                      style={{ left: `${hoverRatio * 100}%` }}
                    >
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
                  <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
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
