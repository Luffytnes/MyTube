'use client'

import { useRef, ChangeEvent } from 'react'
import Link from 'next/link'
import {
  Play, Pause, SkipBack, SkipForward,
  Volume2, VolumeX, Shuffle, Repeat, Repeat1, ListMusic,
} from 'lucide-react'
import { useMusic } from '@/lib/musicContext'
import { cn } from '@/lib/utils'

function formatTime(s: number): string {
  if (!isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default function MusicPlayer() {
  const {
    currentTrack, playing, currentTime, duration,
    volume, muted, shuffle, repeat,
    playPause, next, prev, seek, setVolume, toggleMute,
    toggleShuffle, toggleRepeat,
  } = useMusic()

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
    <div className="fixed bottom-0 left-0 right-0 z-50 h-20 bg-yt-bg border-t border-yt-border/60 flex items-center px-4 gap-4 shadow-2xl">
      {/* Track info */}
      <div className="flex items-center gap-3 w-64 flex-shrink-0 min-w-0">
        {currentTrack.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentTrack.thumbnail}
            alt={currentTrack.title}
            className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-12 h-12 rounded-lg bg-yt-secondary flex-shrink-0 flex items-center justify-center">
            <ListMusic className="w-5 h-5 text-yt-text-muted" />
          </div>
        )}
        <div className="min-w-0">
          <p className="text-yt-text text-sm font-medium truncate">{currentTrack.title}</p>
          <p className="text-yt-text-muted text-xs truncate">{artistNames}</p>
        </div>
      </div>

      {/* Controls + progress */}
      <div className="flex-1 flex flex-col items-center gap-1 max-w-2xl mx-auto">
        {/* Buttons */}
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

        {/* Progress bar */}
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
      </div>

      {/* Volume */}
      <div className="flex items-center gap-2 w-36 flex-shrink-0 justify-end">
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
  )
}
