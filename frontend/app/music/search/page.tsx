'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { Music2, Disc3, User, ListMusic } from 'lucide-react'
import Link from 'next/link'
import TrackRow from '@/components/music/TrackRow'
import AlbumCard from '@/components/music/AlbumCard'
import type { MusicTrack } from '@/lib/musicContext'
import { cn } from '@/lib/utils'
import { useRegion } from '@/lib/regionContext'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

import type { Translations } from '@/lib/translations'

type FilterType = 'songs' | 'albums' | 'artists' | 'playlists'

interface Result {
  type: string
  videoId?: string
  browseId?: string
  playlistId?: string
  title?: string
  name?: string
  artists?: { id?: string; name: string }[]
  album?: string
  thumbnail?: string
  duration?: string
  durationMs?: number
  year?: string | number
  albumType?: string
  subscribers?: string
  author?: string
  itemCount?: number
}

const FILTERS: { key: FilterType; labelKey: keyof Translations; icon: typeof Music2 }[] = [
  { key: 'songs', labelKey: 'music_songs', icon: Music2 },
  { key: 'albums', labelKey: 'music_albums', icon: Disc3 },
  { key: 'artists', labelKey: 'music_artists_label', icon: User },
  { key: 'playlists', labelKey: 'music_playlists_label', icon: ListMusic },
]

export default function MusicSearchPage() {
  const params = useSearchParams()
  const { t } = useRegion()
  const initialQ = params.get('q') || ''
  const [filter, setFilter] = useState<FilterType>('songs')
  const [results, setResults] = useState<Result[]>([])
  const [loading, setLoading] = useState(false)

  const doSearch = useCallback(async (q: string, f: FilterType) => {
    if (!q.trim()) return
    setLoading(true)
    setResults([])
    try {
      const res = await fetch(`${API_BASE}/api/music/search?q=${encodeURIComponent(q)}&filter=${f}`)
      const data = await res.json()
      setResults(Array.isArray(data) ? data : [])
    } catch { setResults([]) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (initialQ) doSearch(initialQ, filter)
  }, [initialQ, filter]) // eslint-disable-line react-hooks/exhaustive-deps

  const songs = results.filter((r) => r.type === 'song') as (Result & { videoId: string })[]
  const asMusicTracks: MusicTrack[] = songs.map((r) => ({
    videoId: r.videoId!,
    title: r.title || '',
    artists: r.artists || [],
    album: r.album,
    thumbnail: r.thumbnail,
    duration: r.duration,
    durationMs: r.durationMs,
  }))

  return (
    <div className="px-4 py-6 max-w-5xl mx-auto min-h-screen">
      {/* Filter chips */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {FILTERS.map(({ key, labelKey, icon: Icon }) => (
          <button
            key={key}
            onClick={() => { setFilter(key); if (initialQ.trim()) doSearch(initialQ, key) }}
            className={cn(
              'flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium flex-shrink-0 transition-colors',
              filter === key ? 'bg-yt-text text-yt-bg' : 'bg-yt-secondary text-yt-text hover:bg-yt-hover'
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {t(labelKey)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-14 bg-yt-secondary rounded-xl animate-pulse" />
          ))}
        </div>
      ) : results.length === 0 && initialQ ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Music2 className="w-12 h-12 text-yt-text-muted mb-3" />
          <p className="text-yt-text-muted">{t('music_no_results_music')} « {initialQ} »</p>
        </div>
      ) : (
        <>
          {/* Songs */}
          {filter === 'songs' && asMusicTracks.length > 0 && (
            <div className="bg-yt-secondary rounded-2xl py-2">
              {asMusicTracks.map((track, i) => (
                <TrackRow key={track.videoId} track={track} queue={asMusicTracks} index={i} showThumbnail showAlbum />
              ))}
            </div>
          )}

          {/* Albums */}
          {filter === 'albums' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {results.map((r) => r.browseId && (
                <AlbumCard
                  key={r.browseId}
                  browseId={r.browseId}
                  title={r.title || ''}
                  artists={r.artists}
                  year={r.year}
                  thumbnail={r.thumbnail}
                  type={r.albumType}
                />
              ))}
            </div>
          )}

          {/* Artists */}
          {filter === 'artists' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {results.map((r) => r.browseId && (
                <Link key={r.browseId} href={`/music/artist/${r.browseId}`} className="flex flex-col items-center gap-2 group">
                  <div className="w-full aspect-square rounded-full overflow-hidden bg-yt-secondary shadow-lg">
                    {r.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.thumbnail} alt={r.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <User className="w-10 h-10 text-yt-text-muted" />
                      </div>
                    )}
                  </div>
                  <p className="text-sm font-medium text-yt-text text-center truncate w-full group-hover:text-yt-red transition-colors">{r.name}</p>
                  {r.subscribers && <p className="text-xs text-yt-text-muted">{r.subscribers}</p>}
                </Link>
              ))}
            </div>
          )}

          {/* Playlists */}
          {filter === 'playlists' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {results.map((r) => (r.browseId || r.playlistId) && (
                <Link
                  key={r.browseId || r.playlistId}
                  href={`/music/playlist/${r.playlistId || r.browseId?.replace('VL', '')}`}
                  className="flex flex-col gap-2 group"
                >
                  <div className="aspect-square rounded-xl overflow-hidden bg-yt-secondary shadow">
                    {r.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.thumbnail} alt={r.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ListMusic className="w-10 h-10 text-yt-text-muted" />
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-yt-text truncate group-hover:text-yt-red transition-colors">{r.title}</p>
                    {r.author && <p className="text-xs text-yt-text-muted truncate">{r.author}</p>}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
