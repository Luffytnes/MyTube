'use client'

import { useState, useRef, useEffect } from 'react'
import { Play, Plus, ListMusic, Check } from 'lucide-react'
import { useMusic, type MusicTrack } from '@/lib/musicContext'
import { getMusicPlaylists, addTrackToPlaylist, createMusicPlaylist } from '@/lib/musicPlaylists'
import { cn } from '@/lib/utils'

interface TrackRowProps {
  track: MusicTrack
  queue?: MusicTrack[]
  index?: number
  showThumbnail?: boolean
  showAlbum?: boolean
}

export default function TrackRow({ track, queue, index, showThumbnail = false, showAlbum = false }: TrackRowProps) {
  const { playTrack, addToQueue, currentTrack, playing } = useMusic()
  const [showMenu, setShowMenu] = useState(false)
  const [added, setAdded] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const isPlaying = currentTrack?.videoId === track.videoId && playing
  const isCurrent = currentTrack?.videoId === track.videoId

  useEffect(() => {
    if (!showMenu) return
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showMenu])

  function handlePlay() { playTrack(track, queue) }

  function handleAddToPlaylist(playlistId: string) {
    addTrackToPlaylist(playlistId, track)
    setAdded(playlistId)
    setTimeout(() => { setAdded(null); setShowMenu(false) }, 800)
  }

  function handleNewPlaylist() {
    const name = prompt('Nom de la playlist :')
    if (!name?.trim()) return
    const p = createMusicPlaylist(name.trim())
    addTrackToPlaylist(p.id, track)
    setShowMenu(false)
  }

  const playlists = showMenu ? getMusicPlaylists() : []

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-xl group cursor-pointer transition-colors',
        isCurrent ? 'bg-yt-hover' : 'hover:bg-yt-hover'
      )}
      onClick={handlePlay}
    >
      {/* Index or play icon */}
      <div className="w-6 flex-shrink-0 text-center">
        {isPlaying ? (
          <div className="flex items-end justify-center gap-0.5 h-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="w-0.5 bg-yt-red rounded-full animate-bounce"
                style={{ height: `${[10, 14, 8][i - 1]}px`, animationDelay: `${i * 0.1}s` }}
              />
            ))}
          </div>
        ) : (
          <>
            {/* Desktop: show index number, hide on hover */}
            <span className={cn('text-xs tabular-nums hidden sm:inline group-hover:hidden', isCurrent ? 'text-yt-red' : 'text-yt-text-muted')}>
              {index !== undefined ? index + 1 : ''}
            </span>
            {/* Mobile: always show play icon; Desktop: only on hover */}
            <Play className={cn('w-3.5 h-3.5 mx-auto block sm:hidden sm:group-hover:block', isCurrent ? 'text-yt-red fill-yt-red' : 'text-yt-text fill-yt-text')} />
          </>
        )}
      </div>

      {/* Thumbnail */}
      {showThumbnail && (
        <div className="w-10 h-10 rounded-lg overflow-hidden bg-yt-secondary flex-shrink-0">
          {track.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={track.thumbnail} alt={track.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-yt-secondary" />
          )}
        </div>
      )}

      {/* Title + artist */}
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm font-medium truncate', isCurrent ? 'text-yt-red' : 'text-yt-text')}>
          {track.title}
        </p>
        <p className="text-xs text-yt-text-muted truncate">
          {track.artists.map((a) => a.name).join(', ')}
        </p>
      </div>

      {/* Album */}
      {showAlbum && track.album && (
        <p className="hidden md:block text-xs text-yt-text-muted truncate max-w-[120px]">{track.album}</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
        {/* Add to queue */}
        <button
          onClick={() => addToQueue(track)}
          className="opacity-0 group-hover:opacity-100 p-1.5 rounded-full hover:bg-yt-hover text-yt-text-muted hover:text-yt-text transition-all"
          aria-label="Ajouter à la file"
          title="Ajouter à la file de lecture"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>

        {/* Add to playlist */}
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setShowMenu((v) => !v)}
            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-full hover:bg-yt-hover text-yt-text-muted hover:text-yt-text transition-all"
            aria-label="Ajouter à une playlist"
            title="Ajouter à une playlist"
          >
            <ListMusic className="w-3.5 h-3.5" />
          </button>

          {showMenu && (
            <div className="absolute right-0 bottom-full mb-1 bg-yt-secondary border border-yt-border rounded-xl shadow-2xl py-1 z-50 min-w-[180px]">
              <p className="text-yt-text-muted text-xs px-4 py-2 border-b border-yt-border/50">Ajouter à une playlist</p>
              {playlists.length === 0 ? (
                <p className="text-yt-text-muted text-xs px-4 py-2">Aucune playlist</p>
              ) : (
                playlists.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleAddToPlaylist(p.id)}
                    className="w-full flex items-center justify-between gap-2 px-4 py-2 text-sm text-yt-text hover:bg-yt-hover transition-colors"
                  >
                    <span className="truncate">{p.name}</span>
                    {added === p.id && <Check className="w-3.5 h-3.5 text-yt-red flex-shrink-0" />}
                  </button>
                ))
              )}
              <div className="border-t border-yt-border/50 mt-1 pt-1">
                <button
                  onClick={handleNewPlaylist}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-yt-text hover:bg-yt-hover transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Nouvelle playlist
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Duration */}
        {track.duration && (
          <span className="text-xs text-yt-text-muted tabular-nums w-10 text-right">{track.duration}</span>
        )}
      </div>
    </div>
  )
}
