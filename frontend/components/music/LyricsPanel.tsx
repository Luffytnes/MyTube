'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, MicVocal } from 'lucide-react'
import { useMusic, type MusicTrack } from '@/lib/musicContext'
import { useRegion } from '@/lib/regionContext'
import { cn } from '@/lib/utils'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

interface LyricLine { time: number | null; text: string }
interface Lyrics { synced: boolean; lines: LyricLine[]; source: string | null }

const cache = new Map<string, Promise<Lyrics>>()

function durationSeconds(track: MusicTrack): number {
  if (track.durationMs) return Math.round(track.durationMs / 1000)
  if (!track.duration) return 0
  return track.duration.split(':').reduce((acc, part) => acc * 60 + (parseInt(part, 10) || 0), 0)
}

function fetchLyrics(track: MusicTrack): Promise<Lyrics> {
  let pending = cache.get(track.videoId)
  if (!pending) {
    const params = new URLSearchParams({
      title: track.title,
      artist: track.artists[0]?.name ?? '',
      duration: String(durationSeconds(track)),
    })
    pending = fetch(`${API_BASE}/api/music/lyrics/${track.videoId}?${params}`)
      .then(r => (r.ok ? r.json() : { synced: false, lines: [], source: null }))
      .catch(() => { cache.delete(track.videoId); return { synced: false, lines: [], source: null } })
    cache.set(track.videoId, pending)
  }
  return pending
}

/** Song lyrics; synced ones follow the song and a click on a line seeks there. */
export default function LyricsPanel({ className = '' }: { className?: string }) {
  const { currentTrack, currentTime, seek } = useMusic()
  const { t } = useRegion()
  const [lyrics, setLyrics] = useState<Lyrics | null>(null)
  const [loading, setLoading] = useState(false)
  const activeRef = useRef<HTMLButtonElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const userScrolledAt = useRef(0)

  useEffect(() => {
    setLyrics(null)
    if (!currentTrack || currentTrack.isRadio || currentTrack.directUrl) return
    let cancelled = false
    setLoading(true)
    fetchLyrics(currentTrack).then(found => {
      if (cancelled) return
      setLyrics(found)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [currentTrack])

  const activeIndex = useMemo(() => {
    if (!lyrics?.synced) return -1
    let index = -1
    for (let i = 0; i < lyrics.lines.length; i++) {
      const time = lyrics.lines[i].time
      if (time !== null && time <= currentTime + 0.25) index = i
      else break
    }
    return index
  }, [lyrics, currentTime])

  // Keep the current line in the middle, unless the user is reading elsewhere
  useEffect(() => {
    if (Date.now() - userScrolledAt.current < 4000) return
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeIndex])

  if (!currentTrack) return null

  return (
    <div
      ref={containerRef}
      className={cn('overflow-y-auto overscroll-contain scrollbar-none px-2 sm:px-0', className)}
      onWheel={() => { userScrolledAt.current = Date.now() }}
      onTouchMove={() => { userScrolledAt.current = Date.now() }}
    >
      {loading && (
        <div className="h-full flex items-center justify-center text-white/50">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      )}
      {!loading && (!lyrics || lyrics.lines.length === 0) && (
        <div className="h-full flex flex-col items-center justify-center gap-3 text-white/45 text-sm text-center px-6">
          <MicVocal className="w-8 h-8" />
          {t('lyrics_none')}
        </div>
      )}
      {!loading && lyrics && lyrics.lines.length > 0 && (
        <div className="py-[30vh] sm:py-24 space-y-3">
          {lyrics.lines.map((line, i) => {
            const isActive = i === activeIndex
            const isPast = lyrics.synced && i < activeIndex
            return (
              <button
                key={i}
                ref={isActive ? activeRef : null}
                type="button"
                disabled={!lyrics.synced || line.time === null}
                onClick={() => { if (line.time !== null) { userScrolledAt.current = 0; seek(line.time) } }}
                className={cn(
                  'block w-full text-left font-display font-bold leading-snug transition-all duration-300',
                  lyrics.synced ? 'text-xl sm:text-3xl cursor-pointer hover:text-white/90' : 'text-base sm:text-xl cursor-default',
                  !lyrics.synced && 'text-white/85',
                  lyrics.synced && (isActive ? 'text-white scale-[1.02] origin-left' : isPast ? 'text-white/35' : 'text-white/55'),
                  !line.text && 'h-4',
                )}
              >
                {line.text || (lyrics.synced ? '♪' : '')}
              </button>
            )
          })}
          {lyrics.source && (
            <p className="pt-6 text-xs text-white/35">{t('lyrics_source').replace('{source}', lyrics.source.replace(/^Source:\s*/i, ''))}</p>
          )}
        </div>
      )}
    </div>
  )
}
