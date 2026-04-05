'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { Disc3, Play, Clock } from 'lucide-react'
import TrackRow from '@/components/music/TrackRow'
import { useMusic, type MusicTrack } from '@/lib/musicContext'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface Album {
  browseId: string
  title: string
  artists: { id?: string; name: string }[]
  year?: string | number
  description?: string
  thumbnail?: string
  trackCount?: number
  duration?: string
  tracks: MusicTrack[]
}

export default function MusicAlbumPage() {
  const { id } = useParams<{ id: string }>()
  const [album, setAlbum] = useState<Album | null>(null)
  const [loading, setLoading] = useState(true)
  const { playTrack } = useMusic()

  useEffect(() => {
    if (!id) return
    fetch(`${API_BASE}/api/music/album/${id}`)
      .then((r) => r.json())
      .then(setAlbum)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div className="px-4 py-6 max-w-4xl mx-auto min-h-screen space-y-4">
        <div className="flex gap-6">
          <div className="w-48 h-48 rounded-2xl bg-yt-secondary animate-pulse flex-shrink-0" />
          <div className="flex-1 space-y-3 py-4">
            {[1, 2, 3].map((i) => <div key={i} className="h-5 bg-yt-secondary rounded animate-pulse" />)}
          </div>
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-12 bg-yt-secondary rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  if (!album) {
    return (
      <div className="flex flex-col items-center justify-center py-32 min-h-screen">
        <Disc3 className="w-16 h-16 text-yt-text-muted mb-4" />
        <p className="text-yt-text-muted">Album introuvable.</p>
      </div>
    )
  }

  const artistNames = album.artists.map((a) => a.name).join(', ')

  return (
    <div className="px-4 py-6 max-w-4xl mx-auto min-h-screen">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-6 mb-8">
        <div className="w-48 h-48 rounded-2xl overflow-hidden bg-yt-secondary flex-shrink-0 shadow-2xl self-center sm:self-start">
          {album.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={album.thumbnail} alt={album.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Disc3 className="w-16 h-16 text-yt-text-muted" />
            </div>
          )}
        </div>

        <div className="flex flex-col justify-end min-w-0">
          <p className="text-yt-text-muted text-xs uppercase tracking-widest mb-1">Album</p>
          <h1 className="text-yt-text text-3xl font-bold mb-2 leading-tight">{album.title}</h1>
          <p className="text-yt-text-secondary text-sm mb-1">{artistNames}</p>
          <div className="flex items-center gap-2 text-yt-text-muted text-xs">
            {album.year && <span>{album.year}</span>}
            {album.trackCount && <><span>•</span><span>{album.trackCount} titres</span></>}
            {album.duration && <><span>•</span><Clock className="w-3 h-3" /><span>{album.duration}</span></>}
          </div>

          <div className="flex gap-3 mt-5">
            {album.tracks.length > 0 && (
              <button
                onClick={() => playTrack(album.tracks[0], album.tracks)}
                className="flex items-center gap-2 px-6 py-2.5 bg-yt-red hover:bg-yt-red-hover text-white rounded-full text-sm font-medium transition-colors"
              >
                <Play className="w-4 h-4 fill-white" />
                Écouter
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Track list header */}
      <div className="flex items-center gap-3 px-3 pb-2 mb-1 text-yt-text-muted text-xs uppercase tracking-wide border-b border-yt-border/40">
        <span className="w-6 text-center">#</span>
        <span className="flex-1">Titre</span>
        <span className="w-10 text-right"><Clock className="w-3 h-3 inline" /></span>
      </div>

      {/* Tracks */}
      <div className="bg-yt-secondary rounded-2xl py-2 mt-2">
        {album.tracks.map((track, i) => (
          <TrackRow
            key={track.videoId || i}
            track={{ ...track, thumbnail: track.thumbnail || album.thumbnail }}
            queue={album.tracks}
            index={i}
          />
        ))}
      </div>

      {/* Description */}
      {album.description && (
        <div className="mt-8">
          <h2 className="text-yt-text text-base font-semibold mb-2">À propos</h2>
          <p className="text-yt-text-muted text-sm leading-relaxed">{album.description}</p>
        </div>
      )}
    </div>
  )
}
