'use client'

import { useState, useEffect, useRef, useCallback, RefObject } from 'react'
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, ChevronUp, Loader2, List, X } from 'lucide-react'

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

function TrackMenu<T extends Track>({
  label, tracks, value, onChange, nullable,
}: {
  label: string; tracks: T[]; value: number | null
  onChange: (v: number | null) => void; nullable: boolean
}) {
  const [open, setOpen] = useState(false)
  const current = value !== null ? tracks.find(t => t.index === value) : null
  const display = current
    ? (current.language && current.language !== 'und' ? current.language.toUpperCase() : current.title || `${value! + 1}`)
    : (nullable ? 'Off' : 'Auto')

  return (
    <div className="relative" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-0.5 px-2 py-1 rounded text-white/80 hover:text-white hover:bg-white/10 text-xs font-medium transition-colors"
      >
        {label}
        {display && <span className="text-white/50 ml-1">{display}</span>}
        <ChevronUp className="w-3 h-3 text-white/40" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 bottom-full mb-1.5 z-[61] min-w-[160px] bg-black/90 backdrop-blur border border-white/20 rounded-xl overflow-hidden shadow-2xl">
            {nullable && (
              <button
                onClick={() => { onChange(null); setOpen(false) }}
                className={`w-full text-left px-3 py-2 text-xs transition-colors hover:bg-white/10 ${value === null ? 'text-yt-red font-semibold' : 'text-white/70'}`}
              >
                Désactivés
              </button>
            )}
            {tracks.map(t => {
              const lbl = [
                t.language && t.language !== 'und' ? t.language.toUpperCase() : '',
                t.title || '',
              ].filter(Boolean).join(' — ') || `Piste ${t.index + 1}`
              return (
                <button
                  key={t.index}
                  onClick={() => { onChange(t.index); setOpen(false) }}
                  className={`w-full text-left px-3 py-2 text-xs transition-colors hover:bg-white/10 ${value === t.index ? 'text-yt-red font-semibold' : 'text-white/70'}`}
                >
                  {lbl}
                </button>
              )
            })}
          </div>
        </>
      )}
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
}

export default function TvVideoPlayer({
  videoRef, loading, error, onErrorBack, subUrl,
  audioTracks = [], subTracks = [],
  audioIdx = 0, subIdx = null,
  onAudioChange, onSubChange,
  onTimeUpdate,
  queue = [], currentQueueId, queueTitle = 'Liste de lecture',
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
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragging = useRef(false)
  const showQueueRef = useRef(false)
  const seekRef = useRef<HTMLDivElement>(null)
  const activeQueueItemRef = useRef<HTMLAnchorElement>(null)

  // Wire video events
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
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('durationchange', onDur)
    v.addEventListener('loadedmetadata', onDur)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('volumechange', onVol)
    v.addEventListener('progress', onProg)
    v.addEventListener('waiting', onWait)
    v.addEventListener('canplay', onCanPlay)
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
    }
  }, [videoRef, onTimeUpdate])

  // Fullscreen listener
  useEffect(() => {
    const fn = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', fn)
    return () => document.removeEventListener('fullscreenchange', fn)
  }, [])

  // Imperatively manage subtitle track — JSX <track> doesn't reliably set mode='showing'
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    // Remove any existing subtitle tracks from a previous selection
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
    // Fallback: force mode after a short delay in case 'load' already fired
    const timer = setTimeout(() => { el.track.mode = 'showing' }, 300)
    return () => {
      el.removeEventListener('load', onLoad)
      clearTimeout(timer)
      el.remove()
      Array.from(v.textTracks).forEach(t => { t.mode = 'disabled' })
    }
  }, [subUrl, videoRef])

  // Scroll to active queue item when panel opens
  useEffect(() => {
    if (showQueue) activeQueueItemRef.current?.scrollIntoView({ block: 'nearest' })
  }, [showQueue])

  function toggleQueue(e: React.MouseEvent) {
    e.stopPropagation()
    showQueueRef.current = !showQueueRef.current
    setShowQueue(showQueueRef.current)
  }

  const revealControls = useCallback(() => {
    setShowControls(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      if (!dragging.current && !showQueueRef.current) setShowControls(false)
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
    if (!bar || !v || !duration) return
    const { left, width } = bar.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - left) / width))
    v.currentTime = ratio * duration
    setCurrentTime(ratio * duration)
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

  const playedPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0
  const bufPct = duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0
  const controlsVisible = showControls || !playing || showQueue

  return (
    <div
      ref={containerRef}
      className="relative bg-black rounded-xl overflow-hidden"
      style={{ aspectRatio: '16/9' }}
      onMouseMove={revealControls}
      onMouseLeave={() => { if (playing && !dragging.current) setShowControls(false) }}
      onTouchStart={revealControls}
    >
      {/* Video — no native controls */}
      <video ref={videoRef} className="w-full h-full" playsInline crossOrigin="anonymous" onClick={togglePlay} />

      {/* Spinner (buffering/loading) */}
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

      {/* Queue panel — slides in from right, overlays video */}
      {showQueue && queue.length > 0 && (
        <div
          className="absolute inset-y-0 right-0 w-56 sm:w-64 bg-black/90 backdrop-blur border-l border-white/10 flex flex-col z-50"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 flex-shrink-0">
            <p className="text-white text-xs font-semibold truncate">{queueTitle}</p>
            <button onClick={toggleQueue} className="text-white/50 hover:text-white ml-2 flex-shrink-0 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {queue.map(item => {
              const isActive = item.id === currentQueueId
              return (
                <a
                  key={item.id}
                  href={item.href}
                  ref={isActive ? activeQueueItemRef : null}
                  className={`flex items-center gap-2.5 px-3 py-2 transition-colors ${isActive ? 'bg-white/10' : 'hover:bg-white/5'}`}
                >
                  {item.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.icon}
                      alt=""
                      className="w-8 h-8 rounded object-contain bg-white/5 p-0.5 flex-shrink-0"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                  ) : (
                    <div className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold ${isActive ? 'bg-red-600 text-white' : 'bg-white/10 text-white/60'}`}>
                      {isActive ? <Play className="w-3 h-3 fill-current" /> : item.label.match(/\d+/)?.[0] || '•'}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium truncate ${isActive ? 'text-red-400' : 'text-white/80'}`}>{item.label}</p>
                    {item.sublabel && <p className="text-[10px] text-white/40">{item.sublabel}</p>}
                    {isActive && item.icon && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                        <span className="text-[10px] text-white/40">En cours</span>
                      </div>
                    )}
                  </div>
                </a>
              )
            })}
          </div>
        </div>
      )}

      {/* Controls overlay */}
      {!error && (
        <div
          className={`absolute inset-0 flex flex-col justify-end transition-opacity duration-300 ${controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          onClick={togglePlay}
        >
          {/* Gradient */}
          <div className="absolute bottom-0 inset-x-0 h-32 bg-gradient-to-t from-black/90 via-black/40 to-transparent pointer-events-none" />

          {/* Controls */}
          <div className="relative px-3 pb-3 sm:px-4 sm:pb-4 space-y-1.5" onClick={e => e.stopPropagation()}>

            {/* Seek bar */}
            <div
              ref={seekRef}
              className="group/seek relative h-1 hover:h-2 bg-white/25 rounded-full cursor-pointer transition-all duration-150"
              onPointerDown={onSeekDown}
              onPointerMove={onSeekMove}
              onPointerUp={onSeekUp}
              onClick={e => e.stopPropagation()}
            >
              <div className="absolute inset-y-0 left-0 bg-white/35 rounded-full" style={{ width: `${bufPct}%` }} />
              <div className="absolute inset-y-0 left-0 bg-yt-red rounded-full" style={{ width: `${playedPct}%` }} />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-yt-red rounded-full shadow-lg scale-0 group-hover/seek:scale-100 transition-transform"
                style={{ left: `calc(${playedPct}% - 7px)` }}
              />
            </div>

            {/* Buttons */}
            <div className="flex items-center gap-1 sm:gap-2">
              {/* Play/Pause */}
              <button onClick={togglePlay} className="text-white hover:text-yt-red transition-colors p-1 flex-shrink-0">
                {playing
                  ? <Pause className="w-6 h-6 fill-current" />
                  : <Play className="w-6 h-6 fill-current translate-x-0.5" />}
              </button>

              {/* Time */}
              <span className="text-white/80 text-xs font-mono flex-shrink-0 tabular-nums">
                {fmt(currentTime)}{duration > 0 ? <> <span className="text-white/40">/</span> {fmt(duration)}</> : null}
              </span>

              <div className="flex-1" />

              {/* Track menus */}
              {audioTracks.length > 1 && onAudioChange && (
                <TrackMenu label="Audio" tracks={audioTracks} value={audioIdx} onChange={(v) => { if (v !== null) onAudioChange(v) }} nullable={false} />
              )}
              {subTracks.length > 0 && onSubChange && (
                <TrackMenu label="CC" tracks={subTracks} value={subIdx} onChange={onSubChange} nullable={true} />
              )}

              {/* Volume */}
              <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => { const v = videoRef.current; if (v) v.muted = !v.muted }}
                  className="text-white/80 hover:text-white transition-colors p-1"
                >
                  {muted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                </button>
                <input
                  type="range" min="0" max="1" step="0.05"
                  value={muted ? 0 : volume}
                  onChange={e => {
                    const v = videoRef.current
                    if (!v) return
                    const val = parseFloat(e.target.value)
                    v.volume = val
                    v.muted = val === 0
                  }}
                  className="hidden sm:block w-16 h-1 accent-yt-red cursor-pointer"
                  onClick={e => e.stopPropagation()}
                />
              </div>

              {/* Queue */}
              {queue.length > 0 && (
                <button
                  onClick={toggleQueue}
                  className={`transition-colors p-1 flex-shrink-0 ${showQueue ? 'text-yt-red' : 'text-white/80 hover:text-white'}`}
                  title={queueTitle}
                >
                  <List className="w-5 h-5" />
                </button>
              )}

              {/* Fullscreen */}
              <button
                onClick={() => handleFullscreen()}
                className="text-white/80 hover:text-white transition-colors p-1 flex-shrink-0"
              >
                {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
