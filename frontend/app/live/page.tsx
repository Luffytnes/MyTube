'use client'

import { useState, useEffect, useCallback } from 'react'
import VideoGrid from '@/components/video/VideoGrid'
import type { VideoCard } from '@/lib/api'
import { useRegion } from '@/lib/regionContext'
import type { Translations } from '@/lib/translations'

const CATEGORIES: { key: string; labelKey: keyof Translations }[] = [
  { key: 'all', labelKey: 'cat_all' },
  { key: 'news', labelKey: 'cat_news' },
  { key: 'music', labelKey: 'cat_music' },
  { key: 'gaming', labelKey: 'cat_gaming' },
  { key: 'sports', labelKey: 'cat_sports' },
]

export default function LivePage() {
  const { t, region, lang } = useRegion()
  const [activeCategory, setActiveCategory] = useState('all')
  const [videos, setVideos] = useState<VideoCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (category: string) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ category, region: region.code, lang })
      const res = await fetch(`/api/yt/live?${params}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to load live streams')
      const data = await res.json()
      setVideos(data.videos ?? [])
    } catch {
      setError(t('live_empty'))
    } finally {
      setLoading(false)
    }
  }, [t, region.code, lang])

  useEffect(() => { load('all') }, [load])

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="sticky top-14 z-30 bg-yt-bg border-b border-yt-border/40 px-4 py-3 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
          <h1 className="text-yt-text font-semibold text-lg">{t('nav_live')}</h1>
        </div>
        <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {CATEGORIES.map(({ key, labelKey }) => (
            <button
              key={key}
              onClick={() => { setActiveCategory(key); load(key) }}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                activeCategory === key
                  ? 'bg-yt-text text-yt-bg'
                  : 'bg-yt-secondary text-yt-text hover:bg-yt-hover'
              }`}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-6">
        {error ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-yt-text-muted text-lg mb-4">{error}</p>
            <button
              onClick={() => load(activeCategory)}
              className="px-6 py-2.5 bg-yt-red hover:bg-yt-red-hover text-white rounded-full text-sm font-medium transition-colors"
            >
              {t('retry')}
            </button>
          </div>
        ) : (
          <VideoGrid videos={videos} loading={loading} emptyMessage={t('live_empty')} />
        )}
      </div>
    </div>
  )
}
