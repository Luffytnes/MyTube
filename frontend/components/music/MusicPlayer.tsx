'use client'

import { useRef, ChangeEvent, useState } from 'react'
import {
  Play, Pause, SkipBack, SkipForward,
  Volume2, VolumeX, Shuffle, Repeat, Repeat1, ListMusic,
  ChevronDown, ListOrdered,
} from 'lucide-react'
import { useMusic } from '@/lib/musicContext'
import { cn } from '@/lib/utils'

function formatTime(s: number): string {
  if (!isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function FullScreenPlayer({ onClose }: { onClose: () => void }) {
  const {
    currentTrack, queue, currentIndex, playing, currentTime, duration,
    volume, muted, shuffle, repeat,
    playPause, next, prev, seek, setVolume, toggleMute,
    toggleShuffle, toggleRepeat, playAtIndex,
  } = useMusic()

  const [showQueue, setShowQueue] = useState(false)
  const [scrubValue, setScrubValue] = useState<number | null>(null)
  const isScrubbing = scrubValue !== null

  if (!currentTrack) return null

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const displayProgress = isScrubbing ? scrubValue! : progress
  const artistNames = currentTrack.artists.map((a) => a.name).join(', ')
  const nextTrack = queue[currentIndex + 1] || null

  function handleVolume(e: ChangeEvent<HTMLInputElement>) {
    setVolume(parseFloat(e.target.value))
  }

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-yt-bg overflow-hidden">
      {/* Blurred background */}
      {currentTrack.thumbnail && (
        <div
          className="absolute inset-0 bg-cover bg-center scale-110"
          style={{ backgroundImage: `url(${currentTrack.thumbnail})`, filter: 'blur(40px) brightness(0.3)', zIndex: -1 }}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 pt-4 sm:pt-6 pb-1 sm:pb-2 flex-shrink-0">
        <button
          onClick={onClose}
          className="p-2 rounded-full hover:bg-white/10 text-white/80 hover:text-white transition-colors"
          aria-label="Réduire"
        >
          <ChevronDown className="w-6 h-6" />
        </button>
        <p className="text-white/60 text-xs sm:text-sm font-medium uppercase tracking-widest truncate mx-4">
          {currentTrack.album || 'En écoute'}
        </p>
        <button
          onClick={() => setShowQueue((v) => !v)}
          className={cn('p-2 rounded-full transition-colors flex-shrink-0', showQueue ? 'text-white bg-white/20' : 'text-white/60 hover:text-white hover:bg-white/10')}
          aria-label="File d'attente"
        >
          <ListOrdered className="w-5 h-5" />
        </button>
      </div>

      <div className="flex flex-1 min-h-0 gap-4 px-4 sm:px-6 pb-4 sm:pb-6">
        {/* Main content — scrollable on very small screens */}
        <div className="flex flex-col flex-1 min-w-0 overflow-y-auto">
          {/* Album art */}
          <div className="flex justify-center items-center flex-1 py-2 sm:py-4 min-h-0">
            <div className="w-full max-w-[200px] sm:max-w-xs aspect-square rounded-2xl overflow-hidden shadow-2xl flex-shrink-0">
              {currentTrack.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={currentTrack.thumbnail}
                  alt={currentTrack.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-white/10 flex items-center justify-center">
                  <ListMusic className="w-16 h-16 sm:w-20 sm:h-20 text-white/30" />
                </div>
              )}
            </div>
          </div>

          {/* Track info */}
          <div className="flex-shrink-0 mb-3 sm:mb-6">
            <p className="text-white text-lg sm:text-2xl font-bold truncate">{currentTrack.title}</p>
            <p className="text-white/60 text-sm sm:text-base truncate mt-0.5 sm:mt-1">{artistNames}</p>
          </div>

          {/* Progress */}
          <div className="flex-shrink-0 mb-3 sm:mb-6">
            {currentTrack.isRadio ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-white/10" />
                <span className="flex items-center gap-1.5 text-red-400 text-xs font-bold">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  LIVE
                </span>
              </div>
            ) : (
              <>
                <input
                  type="range" min="0" max="100" step="0.1"
                  value={displayProgress}
                  onChange={(e) => setScrubValue(parseFloat(e.target.value))}
                  onPointerDown={() => setScrubValue(progress)}
                  onPointerUp={(e) => {
                    const val = parseFloat((e.target as HTMLInputElement).value)
                    seek((val / 100) * duration)
                    setScrubValue(null)
                  }}
                  className="w-full h-1.5 cursor-pointer accent-white rounded-full touch-none"
                  style={{ background: `linear-gradient(to right, #ffffff ${displayProgress}%, rgba(255,255,255,0.2) ${displayProgress}%)` }}
                />
                <div className="flex justify-between mt-1.5">
                  <span className="text-white/50 text-xs tabular-nums">
                    {formatTime(isScrubbing ? (scrubValue! / 100) * duration : currentTime)}
                  </span>
                  <span className="text-white/50 text-xs tabular-nums">{formatTime(duration)}</span>
                </div>
              </>
            )}
          </div>

          {/* Controls */}
          <div className="flex-shrink-0 flex items-center justify-between mb-3 sm:mb-6">
            <button
              onClick={toggleShuffle}
              className={cn('p-2 rounded-full transition-colors', shuffle ? 'text-white' : 'text-white/40 hover:text-white/80')}
            >
              <Shuffle className="w-5 h-5" />
            </button>
            <button onClick={prev} className="text-white/80 hover:text-white p-2 transition-colors">
              <SkipBack className="w-6 h-6 sm:w-7 sm:h-7" />
            </button>
            <button
              onClick={playPause}
              className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-white flex items-center justify-center hover:scale-105 transition-transform shadow-xl"
            >
              {playing
                ? <Pause className="w-6 h-6 sm:w-7 sm:h-7 text-black fill-black" />
                : <Play className="w-6 h-6 sm:w-7 sm:h-7 text-black fill-black ml-1" />}
            </button>
            <button onClick={next} className="text-white/80 hover:text-white p-2 transition-colors">
              <SkipForward className="w-6 h-6 sm:w-7 sm:h-7" />
            </button>
            <button
              onClick={toggleRepeat}
              className={cn('p-2 rounded-full transition-colors', repeat !== 'none' ? 'text-white' : 'text-white/40 hover:text-white/80')}
            >
              {repeat === 'one' ? <Repeat1 className="w-5 h-5" /> : <Repeat className="w-5 h-5" />}
            </button>
          </div>

          {/* Volume */}
          <div className="flex-shrink-0 flex items-center gap-3">
            <button onClick={toggleMute} className="text-white/50 hover:text-white transition-colors">
              {muted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <input
              type="range" min="0" max="1" step="0.02"
              value={muted ? 0 : volume}
              onChange={handleVolume}
              className="flex-1 h-1 cursor-pointer accent-white"
              style={{ background: `linear-gradient(to right, rgba(255,255,255,0.9) ${(muted ? 0 : volume) * 100}%, rgba(255,255,255,0.2) ${(muted ? 0 : volume) * 100}%)` }}
            />
          </div>
        </div>

        {/* Queue panel — hidden on very small screens, shown as overlay on sm+ */}
        {showQueue && (
          <div className="hidden sm:flex w-64 lg:w-72 flex-shrink-0 flex-col bg-black/30 rounded-2xl overflow-hidden backdrop-blur-sm">
            <div className="px-4 py-3 border-b border-white/10 flex-shrink-0">
              <p className="text-white font-semibold text-sm">File d&apos;attente</p>
            </div>
            <div className="overflow-y-auto flex-1 py-2">
              {queue.map((track, i) => (
                <button
                  key={track.videoId}
                  onClick={() => playAtIndex(i)}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-2 rounded-xl mx-2 transition-colors text-left',
                    i === currentIndex ? 'bg-white/20' : 'hover:bg-white/10'
                  )}
                  style={{ width: 'calc(100% - 16px)' }}
                >
                  {track.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={track.thumbnail} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                      <ListMusic className="w-4 h-4 text-white/40" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className={cn('text-xs font-medium truncate', i === currentIndex ? 'text-white' : 'text-white/70')}>{track.title}</p>
                    <p className="text-xs text-white/40 truncate">{track.artists.map((a) => a.name).join(', ')}</p>
                  </div>
                </button>
              ))}
            </div>
            {nextTrack && (
              <div className="px-4 py-3 border-t border-white/10 flex-shrink-0">
                <p className="text-white/40 text-xs mb-1.5">Suivant</p>
                <div className="flex items-center gap-2">
                  {nextTrack.thumbnail && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={nextTrack.thumbnail} alt="" className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-white text-xs font-medium truncate">{nextTrack.title}</p>
                    <p className="text-white/50 text-xs truncate">{nextTrack.artists.map((a) => a.name).join(', ')}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Queue overlay on mobile */}
        {showQueue && (
          <div className="sm:hidden absolute inset-x-0 bottom-0 top-16 bg-black/80 backdrop-blur-sm rounded-t-2xl flex flex-col z-10">
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between flex-shrink-0">
              <p className="text-white font-semibold text-sm">File d&apos;attente</p>
              <button onClick={() => setShowQueue(false)} className="text-white/60 hover:text-white p-1">
                <ChevronDown className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 py-2">
              {queue.map((track, i) => (
                <button
                  key={track.videoId}
                  onClick={() => { playAtIndex(i); setShowQueue(false) }}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-2.5 rounded-xl mx-2 transition-colors text-left',
                    i === currentIndex ? 'bg-white/20' : 'hover:bg-white/10'
                  )}
                  style={{ width: 'calc(100% - 16px)' }}
                >
                  {track.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={track.thumbnail} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                      <ListMusic className="w-4 h-4 text-white/40" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className={cn('text-sm font-medium truncate', i === currentIndex ? 'text-white' : 'text-white/70')}>{track.title}</p>
                    <p className="text-xs text-white/40 truncate">{track.artists.map((a) => a.name).join(', ')}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function MusicPlayer() {
  const {
    currentTrack, playing, currentTime, duration,
    volume, muted, shuffle, repeat,
    playPause, next, prev, seek, setVolume, toggleMute,
    toggleShuffle, toggleRepeat,
  } = useMusic()

  const [showFullPlayer, setShowFullPlayer] = useState(false)
  const progressRef = useRef<HTMLInputElement>(null)

  if (!currentTrack) return null

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const artistNames = currentTrack.artists.map((a) => a.name).join(', ')

  function handleSeek(e: ChangeEvent<HTMLInputElement>) {
    const pct = parseFloat(e.target.value)
    seek((pct / 100) * duration)
  }

  function handleVolume(e: ChangeEvent<HTMLInputElement>) {
    setVolume(parseFloat(e.target.value))
  }

  return (
    <>
      {showFullPlayer && <FullScreenPlayer onClose={() => setShowFullPlayer(false)} />}

      {/* Mini player — floating pill on mobile, full-width bar on desktop */}
      <div
        className="fixed left-1/2 -translate-x-1/2 md:left-0 md:right-0 md:translate-x-0 md:bottom-0 z-50 rounded-2xl md:rounded-none bg-yt-bg/95 md:bg-yt-bg backdrop-blur-xl md:backdrop-blur-none border border-yt-border/30 md:border-0 md:border-t md:border-yt-border/60 shadow-[0_8px_32px_rgba(0,0,0,0.5)] md:shadow-2xl overflow-hidden w-[360px] max-w-[calc(100vw-24px)] md:w-auto"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}
      >
        {/* No progress strip on mini player — only shown in fullscreen */}

        <div className="flex items-center px-3 sm:px-4 gap-2 sm:gap-4 h-16 sm:h-20">
          {/* Track info */}
          <button
            onClick={() => setShowFullPlayer(true)}
            className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0 text-left group hover:opacity-80 transition-opacity sm:w-64 sm:flex-none"
          >
            {currentTrack.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={currentTrack.thumbnail}
                alt={currentTrack.title}
                className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg object-cover flex-shrink-0 group-hover:scale-105 transition-transform"
              />
            ) : (
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-yt-secondary flex-shrink-0 flex items-center justify-center">
                <ListMusic className="w-5 h-5 text-yt-text-muted" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-yt-text text-sm font-medium truncate group-hover:text-yt-red transition-colors">{currentTrack.title}</p>
              <p className="text-yt-text-muted text-xs truncate">{artistNames}</p>
            </div>
          </button>

          {/* Controls + progress — desktop */}
          <div className="hidden md:flex flex-1 flex-col items-center gap-1 max-w-2xl mx-auto">
            <div className="flex items-center gap-4">
              <button
                onClick={toggleShuffle}
                className={cn('p-1.5 rounded-full transition-colors', shuffle ? 'text-yt-red' : 'text-yt-text-muted hover:text-yt-text')}
                aria-label="Shuffle"
              >
                <Shuffle className="w-4 h-4" />
              </button>
              <button onClick={prev} className="text-yt-text-secondary hover:text-yt-text p-1.5 transition-colors" aria-label="Previous">
                <SkipBack className="w-5 h-5" />
              </button>
              <button
                onClick={playPause}
                className="w-9 h-9 rounded-full bg-yt-text flex items-center justify-center hover:scale-105 transition-transform"
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing
                  ? <Pause className="w-4 h-4 text-yt-bg fill-yt-bg" />
                  : <Play className="w-4 h-4 text-yt-bg fill-yt-bg ml-0.5" />}
              </button>
              <button onClick={next} className="text-yt-text-secondary hover:text-yt-text p-1.5 transition-colors" aria-label="Next">
                <SkipForward className="w-5 h-5" />
              </button>
              <button
                onClick={toggleRepeat}
                className={cn('p-1.5 rounded-full transition-colors', repeat !== 'none' ? 'text-yt-red' : 'text-yt-text-muted hover:text-yt-text')}
                aria-label="Repeat"
              >
                {repeat === 'one' ? <Repeat1 className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
              </button>
            </div>

            {currentTrack?.isRadio ? (
              <div className="flex items-center gap-2 w-full">
                <div className="flex-1 h-1 rounded-full bg-yt-secondary" />
                <span className="flex items-center gap-1 text-yt-red text-xs font-bold tabular-nums">
                  <span className="w-1.5 h-1.5 rounded-full bg-yt-red animate-pulse" />
                  LIVE
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 w-full">
                <span className="text-yt-text-muted text-xs tabular-nums w-8 text-right">{formatTime(currentTime)}</span>
                <input
                  ref={progressRef}
                  type="range" min="0" max="100" step="0.1"
                  value={progress}
                  onChange={handleSeek}
                  className="flex-1 h-1 cursor-pointer accent-yt-red"
                  style={{ background: `linear-gradient(to right, #ff0000 ${progress}%, #3f3f3f ${progress}%)` }}
                  aria-label="Progress"
                />
                <span className="text-yt-text-muted text-xs tabular-nums w-8">{formatTime(duration)}</span>
              </div>
            )}
          </div>

          {/* Mobile controls — prev/play/next */}
          <div className="flex md:hidden items-center gap-1 flex-shrink-0">
            <button onClick={prev} className="text-yt-text-secondary p-2" aria-label="Previous">
              <SkipBack className="w-5 h-5" />
            </button>
            <button
              onClick={playPause}
              className="w-9 h-9 rounded-full bg-yt-text flex items-center justify-center"
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing
                ? <Pause className="w-4 h-4 text-yt-bg fill-yt-bg" />
                : <Play className="w-4 h-4 text-yt-bg fill-yt-bg ml-0.5" />}
            </button>
            <button onClick={next} className="text-yt-text-secondary p-2" aria-label="Next">
              <SkipForward className="w-5 h-5" />
            </button>
          </div>

          {/* Repeat — far right on mobile */}
          <button
            onClick={toggleRepeat}
            className={cn('md:hidden flex-shrink-0 p-2 rounded-full transition-colors', repeat !== 'none' ? 'text-yt-red' : 'text-yt-text-muted')}
            aria-label="Repeat"
          >
            {repeat === 'one' ? <Repeat1 className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
          </button>

          {/* Volume — desktop only */}
          <div className="hidden md:flex items-center gap-2 w-36 flex-shrink-0 justify-end">
            <button onClick={toggleMute} className="text-yt-text-muted hover:text-yt-text transition-colors" aria-label="Mute">
              {muted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <input
              type="range" min="0" max="1" step="0.02"
              value={muted ? 0 : volume}
              onChange={handleVolume}
              className="w-24 h-1 cursor-pointer accent-yt-red"
              style={{ background: `linear-gradient(to right, #f1f1f1 ${(muted ? 0 : volume) * 100}%, #3f3f3f ${(muted ? 0 : volume) * 100}%)` }}
              aria-label="Volume"
            />
          </div>
        </div>
      </div>
    </>
  )
}
