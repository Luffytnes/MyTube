'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { TrendingUp, Music2, ListMusic, Sparkles, Plus, ChevronRight, User, Disc3, Mic2 } from 'lucide-react'
import TrackRow from '@/components/music/TrackRow'
import AlbumCard from '@/components/music/AlbumCard'
import type { MusicTrack } from '@/lib/musicContext'
import { getMusicPlaylists, type MusicPlaylist } from '@/lib/musicPlaylists'
import { getMusicSearchHistory } from '@/lib/musicSearchHistory'
import { useRegion } from '@/lib/regionContext'

interface ArtistSuggestion {
  browseId: string
  name: string
  thumbnail?: string
  subscribers?: string
}

interface PodcastSuggestion {
  browseId: string
  title: string
  author?: string
  thumbnail?: string
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

interface HomeData {
  topSongs: MusicTrack[]
  trending: MusicTrack[]
}

interface SearchResult {
  type: string
  videoId?: string
  browseId?: string
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
}

export default function MusicHomePage() {
  const { t, lang } = useRegion()
  const [data, setData] = useState<HomeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [forYouTracks, setForYouTracks] = useState<MusicTrack[]>([])
  const [forYouLoading, setForYouLoading] = useState(false)
  const [suggestedAlbums, setSuggestedAlbums] = useState<SearchResult[]>([])
  const [suggestedArtists, setSuggestedArtists] = useState<ArtistSuggestion[]>([])
  const [suggestedPodcasts, setSuggestedPodcasts] = useState<PodcastSuggestion[]>([])
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([])

  // Load home charts
  useEffect(() => {
    fetch(`${API_BASE}/api/music/home`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Load playlists
  useEffect(() => {
    setPlaylists(getMusicPlaylists())
  }, [])

  // Personalized — based on music search history
  useEffect(() => {
    const history = getMusicSearchHistory().slice(0, 3).map((h) => h.query)
    if (history.length === 0) return
    setForYouLoading(true)

    function interleave<T>(buckets: T[][]): T[] {
      const seen = new Set<string>()
      const merged: T[] = []
      const max = Math.max(...buckets.map((b) => b.length))
      for (let i = 0; i < max; i++) {
        for (const b of buckets) {
          const item = b[i] as T & { videoId?: string; browseId?: string }
          const key = item?.videoId || item?.browseId
          if (item && key && !seen.has(key)) {
            seen.add(key)
            merged.push(item)
          }
        }
      }
      return merged
    }

    Promise.all([
      // Songs
      Promise.all(
        history.map((q) =>
          fetch(`${API_BASE}/api/music/search?q=${encodeURIComponent(q)}&filter=songs`)
            .then((r) => r.json())
            .then((results: SearchResult[]) =>
              results
                .filter((r) => r.type === 'song' && r.videoId)
                .slice(0, 5)
                .map((r) => ({
                  videoId: r.videoId!,
                  title: r.title || '',
                  artists: r.artists || [],
                  album: r.album,
                  thumbnail: r.thumbnail,
                  duration: r.duration,
                  durationMs: r.durationMs,
                } as MusicTrack))
            )
            .catch(() => [] as MusicTrack[])
        )
      ),
      // Albums
      Promise.all(
        history.map((q) =>
          fetch(`${API_BASE}/api/music/search?q=${encodeURIComponent(q)}&filter=albums`)
            .then((r) => r.json())
            .then((results: SearchResult[]) =>
              results.filter((r) => r.browseId).slice(0, 4)
            )
            .catch(() => [] as SearchResult[])
        )
      ),
      // Artists
      Promise.all(
        history.map((q) =>
          fetch(`${API_BASE}/api/music/search?q=${encodeURIComponent(q)}&filter=artists`)
            .then((r) => r.json())
            .then((results: SearchResult[]) =>
              results
                .filter((r) => r.browseId)
                .slice(0, 4)
                .map((r) => ({ browseId: r.browseId!, name: r.name || r.title || '', thumbnail: r.thumbnail, subscribers: r.subscribers }))
            )
            .catch(() => [] as ArtistSuggestion[])
        )
      ),
      // Podcasts
      Promise.all(
        history.map((q) =>
          fetch(`${API_BASE}/api/music/podcasts/search?q=${encodeURIComponent(q)}&lang=${lang}`)
            .then((r) => r.json())
            .then((results: PodcastSuggestion[]) =>
              Array.isArray(results) ? results.filter((r) => r.browseId).slice(0, 4) : []
            )
            .catch(() => [] as PodcastSuggestion[])
        )
      ),
    ]).then(([songBuckets, albumBuckets, artistBuckets, podcastBuckets]) => {
      setForYouTracks(interleave(songBuckets).slice(0, 20))
      setSuggestedAlbums(interleave(albumBuckets).slice(0, 10))
      setSuggestedArtists(interleave(artistBuckets).slice(0, 10))
      setSuggestedPodcasts(interleave(podcastBuckets as PodcastSuggestion[][]).slice(0, 10))
    }).finally(() => setForYouLoading(false))
  }, [lang])

  return (
    <div className="px-4 py-6 max-w-5xl mx-auto">
      <div className="space-y-10">

        {/* My playlists */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ListMusic className="w-5 h-5 text-yt-red" />
              <h2 className="text-yt-text text-lg font-semibold">{t('music_my_playlists')}</h2>
            </div>
            <Link href="/music/playlists" className="flex items-center gap-1 text-xs text-yt-text-muted hover:text-yt-text transition-colors">
              {t('music_see_all')} <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {playlists.length === 0 ? (
            <Link
              href="/music/playlists"
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-dashed border-yt-border hover:border-yt-red hover:bg-yt-secondary transition-colors group"
            >
              <div className="w-12 h-12 rounded-xl bg-yt-secondary group-hover:bg-yt-hover flex items-center justify-center flex-shrink-0 transition-colors">
                <Plus className="w-5 h-5 text-yt-text-muted group-hover:text-yt-red transition-colors" />
              </div>
              <div>
                <p className="text-sm font-medium text-yt-text">{t('music_create_playlist')}</p>
                <p className="text-xs text-yt-text-muted">{t('music_organize')}</p>
              </div>
            </Link>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {playlists.slice(0, 4).map((p) => (
                <Link key={p.id} href={`/music/playlists/${p.id}`} className="flex items-center gap-3 p-3 rounded-xl bg-yt-secondary hover:bg-yt-hover transition-colors group">
                  <div className="w-12 h-12 rounded-lg flex-shrink-0 overflow-hidden bg-yt-hover">
                    {p.tracks[0]?.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.tracks[0].thumbnail} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ListMusic className="w-5 h-5 text-yt-text-muted" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-yt-text truncate group-hover:text-yt-red transition-colors">{p.name}</p>
                    <p className="text-xs text-yt-text-muted">{p.tracks.length} {p.tracks.length !== 1 ? t('music_tracks') : t('music_track')}</p>
                  </div>
                </Link>
              ))}
              {playlists.length < 4 && (
                <Link
                  href="/music/playlists"
                  className="flex items-center gap-3 p-3 rounded-xl border border-dashed border-yt-border hover:border-yt-red hover:bg-yt-secondary transition-colors group"
                >
                  <div className="w-12 h-12 rounded-lg flex-shrink-0 bg-yt-secondary flex items-center justify-center">
                    <Plus className="w-5 h-5 text-yt-text-muted group-hover:text-yt-red transition-colors" />
                  </div>
                  <p className="text-sm text-yt-text-muted group-hover:text-yt-text transition-colors">{t('music_new')}</p>
                </Link>
              )}
            </div>
          )}
        </section>

        {/* For you */}
        {(forYouTracks.length > 0 || forYouLoading) && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-5 h-5 text-yt-red" />
              <h2 className="text-yt-text text-lg font-semibold">{t('music_for_you')}</h2>
              <span className="text-yt-text-muted text-xs">{t('music_based_on_searches')}</span>
            </div>
            {forYouLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-14 bg-yt-secondary rounded-xl animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="bg-yt-secondary rounded-2xl py-2">
                {forYouTracks.map((track, i) => (
                  <TrackRow key={track.videoId} track={track} queue={forYouTracks} index={i} showThumbnail showAlbum />
                ))}
              </div>
            )}
          </section>
        )}

        {/* Suggested Albums */}
        {suggestedAlbums.length > 0 && !forYouLoading && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Disc3 className="w-5 h-5 text-yt-red" />
              <h2 className="text-yt-text text-lg font-semibold">{t('music_suggested_albums')}</h2>
              <span className="text-yt-text-muted text-xs">{t('music_based_on_searches')}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {suggestedAlbums.map((a) => (
                <AlbumCard
                  key={a.browseId}
                  browseId={a.browseId!}
                  title={a.title || ''}
                  artists={a.artists}
                  year={a.year}
                  thumbnail={a.thumbnail}
                  type={a.albumType}
                />
              ))}
            </div>
          </section>
        )}

        {/* Suggested Artists */}
        {suggestedArtists.length > 0 && !forYouLoading && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <User className="w-5 h-5 text-yt-red" />
              <h2 className="text-yt-text text-lg font-semibold">{t('music_suggested_artists')}</h2>
              <span className="text-yt-text-muted text-xs">{t('music_based_on_searches')}</span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
              {suggestedArtists.map((a) => (
                <Link key={a.browseId} href={`/music/artist/${a.browseId}`} className="flex flex-col items-center gap-2 group">
                  <div className="w-full aspect-square rounded-full overflow-hidden bg-yt-secondary">
                    {a.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.thumbnail} alt={a.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <User className="w-8 h-8 text-yt-text-muted" />
                      </div>
                    )}
                  </div>
                  <p className="text-xs font-medium text-yt-text text-center truncate w-full group-hover:text-yt-red transition-colors">{a.name}</p>
                  {a.subscribers && <p className="text-xs text-yt-text-muted">{a.subscribers}</p>}
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Suggested Podcasts */}
        {suggestedPodcasts.length > 0 && !forYouLoading && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Mic2 className="w-5 h-5 text-yt-red" />
              <h2 className="text-yt-text text-lg font-semibold">{t('podcast_nav')}</h2>
              <span className="text-yt-text-muted text-xs">{t('music_based_on_searches')}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {suggestedPodcasts.map((p) => (
                <Link key={p.browseId} href={`/music/podcasts/${p.browseId}`} className="flex flex-col gap-2 group">
                  <div className="aspect-square rounded-xl overflow-hidden bg-yt-secondary shadow">
                    {p.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.thumbnail} alt={p.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Mic2 className="w-8 h-8 text-yt-text-muted" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-yt-text truncate group-hover:text-yt-red transition-colors">{p.title}</p>
                    {p.author && <p className="text-xs text-yt-text-muted truncate mt-0.5">{p.author}</p>}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Trending */}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 bg-yt-secondary rounded-xl animate-pulse" />
            ))}
          </div>
        ) : data && (
          <>
            {data.topSongs.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp className="w-5 h-5 text-yt-red" />
                  <h2 className="text-yt-text text-lg font-semibold">{t('music_top_world')}</h2>
                </div>
                <div className="bg-yt-secondary rounded-2xl py-2">
                  {data.topSongs.map((track, i) => (
                    <TrackRow key={track.videoId} track={track} queue={data.topSongs} index={i} showThumbnail showAlbum />
                  ))}
                </div>
              </section>
            )}

            {data.trending.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Music2 className="w-5 h-5 text-yt-red" />
                  <h2 className="text-yt-text text-lg font-semibold">{t('music_trending_music')}</h2>
                </div>
                <div className="bg-yt-secondary rounded-2xl py-2">
                  {data.trending.map((track, i) => (
                    <TrackRow key={track.videoId} track={track} queue={data.trending} index={i} showThumbnail />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
