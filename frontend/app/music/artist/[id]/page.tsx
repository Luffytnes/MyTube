'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { User, Play } from 'lucide-react'
import TrackRow from '@/components/music/TrackRow'
import AlbumCard from '@/components/music/AlbumCard'
import { useMusic, type MusicTrack } from '@/lib/musicContext'
import { useRegion } from '@/lib/regionContext'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface Artist {
  browseId: string
  name: string
  description?: string
  subscribers?: string
  thumbnail?: string
  songs: MusicTrack[]
  albums: { browseId: string; title: string; year?: string; thumbnail?: string; albumType?: string }[]
  singles: { browseId: string; title: string; year?: string; thumbnail?: string }[]
  related: { browseId: string; name: string; thumbnail?: string; subscribers?: string }[]
}

export default function MusicArtistPage() {
  const { id } = useParams<{ id: string }>()
  const [artist, setArtist] = useState<Artist | null>(null)
  const [loading, setLoading] = useState(true)
  const { playTrack } = useMusic()
  const { t } = useRegion()

  useEffect(() => {
    if (!id) return
    fetch(`${API_BASE}/api/music/artist/${id}`)
      .then((r) => r.json())
      .then(setArtist)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div className="min-h-screen">
        <div className="h-64 bg-yt-secondary animate-pulse" />
        <div className="px-4 py-6 space-y-4 max-w-5xl mx-auto">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 bg-yt-secondary rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (!artist) {
    return (
      <div className="flex flex-col items-center justify-center py-32 min-h-screen">
        <User className="w-16 h-16 text-yt-text-muted mb-4" />
        <p className="text-yt-text-muted">{t('music_artist_not_found')}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <div className="relative h-56 sm:h-72 overflow-hidden">
        {artist.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={artist.thumbnail} alt={artist.name} className="w-full h-full object-cover object-top" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-yt-secondary to-yt-bg" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-yt-bg via-yt-bg/60 to-transparent" />
        <div className="absolute bottom-4 left-4 right-4">
          <h1 className="text-yt-text text-3xl sm:text-4xl font-bold drop-shadow-lg">{artist.name}</h1>
          {artist.subscribers && (
            <p className="text-yt-text-secondary text-sm mt-1">{artist.subscribers} {t('music_subscribers')}</p>
          )}
        </div>
      </div>

      <div className="px-4 py-6 max-w-5xl mx-auto space-y-10">
        {/* Play button */}
        {artist.songs.length > 0 && (
          <button
            onClick={() => playTrack(artist.songs[0], artist.songs)}
            className="flex items-center gap-2 px-6 py-2.5 bg-yt-red hover:bg-yt-red-hover text-white rounded-full text-sm font-medium transition-colors"
          >
            <Play className="w-4 h-4 fill-white" />
            {t('music_listen')}
          </button>
        )}

        {/* Top songs */}
        {artist.songs.length > 0 && (
          <section>
            <h2 className="text-yt-text text-lg font-semibold mb-3">{t('music_top_songs')}</h2>
            <div className="bg-yt-secondary rounded-2xl py-2">
              {artist.songs.map((track, i) => (
                <TrackRow key={track.videoId} track={track} queue={artist.songs} index={i} showThumbnail showAlbum />
              ))}
            </div>
          </section>
        )}

        {/* Albums */}
        {artist.albums.length > 0 && (
          <section>
            <h2 className="text-yt-text text-lg font-semibold mb-4">{t('music_albums')}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {artist.albums.map((album) => (
                <AlbumCard
                  key={album.browseId}
                  browseId={album.browseId}
                  title={album.title}
                  year={album.year}
                  thumbnail={album.thumbnail}
                  type={album.albumType}
                />
              ))}
            </div>
          </section>
        )}

        {/* Singles */}
        {artist.singles.length > 0 && (
          <section>
            <h2 className="text-yt-text text-lg font-semibold mb-4">{t('music_singles')}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {artist.singles.map((s) => (
                <AlbumCard key={s.browseId} browseId={s.browseId} title={s.title} year={s.year} thumbnail={s.thumbnail} type="Single" />
              ))}
            </div>
          </section>
        )}

        {/* Related artists */}
        {artist.related.length > 0 && (
          <section>
            <h2 className="text-yt-text text-lg font-semibold mb-4">{t('music_related_artists')}</h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4">
              {artist.related.map((r) => (
                <a key={r.browseId} href={`/music/artist/${r.browseId}`} className="flex flex-col items-center gap-2 group">
                  <div className="w-full aspect-square rounded-full overflow-hidden bg-yt-secondary">
                    {r.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.thumbnail} alt={r.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <User className="w-6 h-6 text-yt-text-muted" />
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-yt-text text-center truncate w-full group-hover:text-yt-red transition-colors">{r.name}</p>
                </a>
              ))}
            </div>
          </section>
        )}

        {/* Description */}
        {artist.description && (
          <section>
            <h2 className="text-yt-text text-lg font-semibold mb-2">{t('music_about')}</h2>
            <p className="text-yt-text-muted text-sm leading-relaxed whitespace-pre-line">{artist.description}</p>
          </section>
        )}
      </div>
    </div>
  )
}
