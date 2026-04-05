'use client'

import { useState, useEffect, useCallback } from 'react'
import VideoGrid from '@/components/video/VideoGrid'
import { getTrending, searchVideos, getChannelVideos } from '@/lib/api'
import type { VideoCard } from '@/lib/api'
import { useRegion } from '@/lib/regionContext'
import { useSubscriptions } from '@/lib/subscriptionsContext'
import { getSearchHistory } from '@/lib/searchHistory'

export default function HomePage() {
  const { t, region, lang } = useRegion()
  const { subscriptions } = useSubscriptions()
  const [videos, setVideos] = useState<VideoCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasActivity, setHasActivity] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    const recentSearches = getSearchHistory().slice(0, 4).map((h) => h.query)
    const hasSearches = recentSearches.length > 0
    const hasSubs = subscriptions.length > 0
    setHasActivity(hasSearches || hasSubs)

    // No activity → trending fallback
    if (!hasSearches && !hasSubs) {
      try {
        const data = await getTrending(region.code, 'all', lang)
        setVideos(data.videos)
      } catch {
        setError(t('error_trending'))
      } finally {
        setLoading(false)
      }
      return
    }

    try {
      // Fetch in parallel: up to 4 searches + up to 3 subscribed channels
      const searchPromises = recentSearches.map((q) =>
        searchVideos(q, 1).then((r) => r.videos.slice(0, 6)).catch(() => [] as VideoCard[])
      )
      const channelPromises = subscriptions.slice(0, 3).map((sub) =>
        getChannelVideos(sub.id, 1).then((r) => r.videos.slice(0, 4)).catch(() => [] as VideoCard[])
      )

      const results = await Promise.all([...searchPromises, ...channelPromises])
      const seen = new Set<string>()
      const merged: VideoCard[] = []

      // Interleave results so they're not all from the same source
      const maxLen = Math.max(...results.map((r) => r.length))
      for (let i = 0; i < maxLen; i++) {
        for (const bucket of results) {
          const v = bucket[i]
          if (v && !seen.has(v.id)) {
            seen.add(v.id)
            merged.push(v)
          }
        }
      }

      setVideos(merged)
    } catch {
      setError(t('error_trending'))
    } finally {
      setLoading(false)
    }
  }, [region.code, lang, subscriptions, t])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="min-h-screen px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-yt-text text-2xl font-semibold">{t('home_forYou')}</h1>
        {hasActivity && (
          <p className="text-yt-text-muted text-sm mt-1">{t('home_basedOn')}</p>
        )}
      </div>

      {error ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-yt-text-muted text-lg mb-4">{error}</p>
          <button
            onClick={load}
            className="px-6 py-2.5 bg-yt-red hover:bg-yt-red-hover text-white rounded-full text-sm font-medium transition-colors"
          >
            {t('retry')}
          </button>
        </div>
      ) : !loading && videos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center max-w-sm mx-auto">
          <div className="w-16 h-16 rounded-full bg-yt-secondary flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-yt-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <p className="text-yt-text-muted text-sm">{t('home_noActivity')}</p>
        </div>
      ) : (
        <VideoGrid videos={videos} loading={loading} emptyMessage={t('home_noActivity')} />
      )}
    </div>
  )
}
