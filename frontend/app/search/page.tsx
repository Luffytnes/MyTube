'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import VideoGrid from '@/components/video/VideoGrid'
import ChannelCard from '@/components/search/ChannelCard'
import PlaylistCard from '@/components/search/PlaylistCard'
import { searchVideos } from '@/lib/api'
import type { VideoCard, ChannelSearchResult, PlaylistSearchResult } from '@/lib/api'
import { Search } from 'lucide-react'
import { useRegion } from '@/lib/regionContext'
import type { Translations } from '@/lib/translations'

type SortKey = 'relevance' | 'view_count'
type FilterKey = 'all' | 'videos' | 'channels' | 'playlists'

const FILTER_OPTIONS: { key: FilterKey; labelKey: keyof Translations }[] = [
  { key: 'all', labelKey: 'filter_all' },
  { key: 'videos', labelKey: 'filter_videos' },
  { key: 'channels', labelKey: 'filter_channels' },
  { key: 'playlists', labelKey: 'filter_playlists' },
]

const SORT_OPTIONS: { key: SortKey; labelKey: keyof Translations }[] = [
  { key: 'relevance', labelKey: 'sort_relevance' },
  { key: 'view_count', labelKey: 'sort_viewCount' },
]

function SearchContent() {
  const searchParams = useSearchParams()
  const query = searchParams.get('q') || ''
  const { t } = useRegion()

  const [videos, setVideos] = useState<VideoCard[]>([])
  const [channels, setChannels] = useState<ChannelSearchResult[]>([])
  const [playlists, setPlaylists] = useState<PlaylistSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all')
  const [sortBy, setSortBy] = useState<SortKey>('relevance')

  const doSearch = useCallback(async (q: string, p: number, reset: boolean) => {
    if (!q) return
    setLoading(true)
    setError(null)
    try {
      const data = await searchVideos(q, p)
      if (reset) {
        setVideos(data.videos)
        setChannels(data.channels)
        setPlaylists(data.playlists)
      } else {
        setVideos((prev) => [...prev, ...data.videos])
        // channels and playlists only appear on page 1
      }
      setHasMore(data.videos.length > 0)
    } catch (err) {
      setError(t('error_trending'))
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    setPage(1)
    setVideos([])
    setChannels([])
    setPlaylists([])
    setActiveFilter('all')
    setSortBy('relevance')
    if (query) doSearch(query, 1, true)
  }, [query, doSearch])

  function loadMore() {
    const next = page + 1
    setPage(next)
    doSearch(query, next, false)
  }

  const sortedVideos = [...videos].sort((a, b) => {
    if (sortBy === 'view_count') {
      return parseFloat(b.views.replace(/[^0-9.]/g, '')) - parseFloat(a.views.replace(/[^0-9.]/g, ''))
    }
    return 0
  })

  const showVideos = activeFilter === 'all' || activeFilter === 'videos'
  const showChannels = (activeFilter === 'all' || activeFilter === 'channels') && channels.length > 0
  const showPlaylists = (activeFilter === 'all' || activeFilter === 'playlists') && playlists.length > 0

  const totalResults = (showVideos ? sortedVideos.length : 0) +
    (showChannels ? channels.length : 0) +
    (showPlaylists ? playlists.length : 0)

  return (
    <div className="min-h-screen">
      {query ? (
        <>
          {/* Filter bar */}
          <div className="sticky top-14 z-30 bg-yt-bg border-b border-yt-border/40 px-4 py-3 flex items-center gap-4 overflow-x-auto">
            <div className="flex gap-2 flex-shrink-0">
              {FILTER_OPTIONS.map(({ key, labelKey }) => {
                // Show badge count on filter pills
                const count = key === 'channels' ? channels.length
                  : key === 'playlists' ? playlists.length
                  : key === 'videos' ? sortedVideos.length
                  : 0
                return (
                  <button
                    key={key}
                    onClick={() => setActiveFilter(key)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                      activeFilter === key ? 'bg-yt-text text-yt-bg' : 'bg-yt-secondary text-yt-text hover:bg-yt-hover'
                    }`}
                  >
                    {t(labelKey)}
                    {key !== 'all' && count > 0 && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                        activeFilter === key ? 'bg-yt-bg/20 text-yt-bg' : 'bg-yt-hover text-yt-text-muted'
                      }`}>
                        {count}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            <div className="w-px h-6 bg-yt-border flex-shrink-0" />

            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs text-yt-text-muted whitespace-nowrap">{t('sortBy')}</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortKey)}
                className="bg-yt-secondary border border-yt-border rounded-lg px-3 py-1.5 text-sm text-yt-text focus:outline-none cursor-pointer"
              >
                {SORT_OPTIONS.map(({ key, labelKey }) => (
                  <option key={key} value={key}>{t(labelKey)}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="px-4 py-4 max-w-4xl">
            {!loading && !error && totalResults > 0 && (
              <p className="text-sm text-yt-text-muted mb-5">
                {t('searchResultsFor')} <span className="text-yt-text font-medium">"{query}"</span>
              </p>
            )}

            {error ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <p className="text-yt-text-muted text-lg mb-4">{error}</p>
                <button
                  onClick={() => doSearch(query, 1, true)}
                  className="px-6 py-2.5 bg-yt-red hover:bg-yt-red-hover text-white rounded-full text-sm font-medium transition-colors"
                >
                  {t('retry')}
                </button>
              </div>
            ) : (
              <div className="space-y-8">
                {/* Channels section */}
                {showChannels && (
                  <section>
                    {activeFilter === 'all' && (
                      <h2 className="text-yt-text font-semibold text-sm mb-3 uppercase tracking-wide text-yt-text-muted">
                        {t('filter_channels')}
                      </h2>
                    )}
                    <div className="divide-y divide-yt-border/30">
                      {channels.map((ch) => (
                        <ChannelCard key={ch.id} channel={ch} />
                      ))}
                    </div>
                  </section>
                )}

                {/* Playlists section */}
                {showPlaylists && (
                  <section>
                    {activeFilter === 'all' && (
                      <h2 className="text-yt-text font-semibold text-sm mb-3 uppercase tracking-wide text-yt-text-muted">
                        {t('filter_playlists')}
                      </h2>
                    )}
                    <div className="grid gap-4 sm:grid-cols-2">
                      {playlists.map((pl) => (
                        <PlaylistCard key={pl.id} playlist={pl} />
                      ))}
                    </div>
                  </section>
                )}

                {/* Videos section */}
                {showVideos && (
                  <section>
                    {activeFilter === 'all' && (channels.length > 0 || playlists.length > 0) && (
                      <h2 className="text-yt-text font-semibold text-sm mb-3 uppercase tracking-wide text-yt-text-muted">
                        {t('filter_videos')}
                      </h2>
                    )}
                    <VideoGrid
                      videos={sortedVideos}
                      loading={loading && page === 1}
                      emptyMessage={activeFilter === 'videos' ? `${t('noResultsFor')} "${query}"` : undefined}
                    />
                    {!loading && hasMore && sortedVideos.length > 0 && (
                      <div className="flex justify-center mt-8">
                        <button
                          onClick={loadMore}
                          className="px-8 py-3 bg-yt-secondary hover:bg-yt-hover border border-yt-border text-yt-text rounded-full text-sm font-medium transition-colors"
                        >
                          {t('loadMore')}
                        </button>
                      </div>
                    )}
                    {loading && page > 1 && (
                      <div className="flex justify-center mt-8">
                        <div className="w-8 h-8 border-2 border-yt-border border-t-yt-text rounded-full animate-spin" />
                      </div>
                    )}
                  </section>
                )}

                {/* Empty state when filter shows nothing */}
                {!loading && totalResults === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <Search className="w-12 h-12 text-yt-text-muted mb-3" />
                    <p className="text-yt-text text-lg font-medium mb-1">
                      {t('noResultsFor')} "{query}"
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center py-32 text-center px-4">
          <Search className="w-16 h-16 text-yt-text-muted mb-4" />
          <p className="text-yt-text text-xl font-medium mb-2">{t('searchTitle')}</p>
          <p className="text-yt-text-muted text-sm max-w-sm">{t('searchSubtitle')}</p>
        </div>
      )}
    </div>
  )
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-32"><div className="w-8 h-8 border-2 border-yt-border border-t-yt-text rounded-full animate-spin" /></div>}>
      <SearchContent />
    </Suspense>
  )
}
