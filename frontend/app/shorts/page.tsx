'use client'

import { useState, useEffect, useCallback } from 'react'
import VideoGrid from '@/components/video/VideoGrid'
import type { VideoCard } from '@/lib/api'
import { useRegion } from '@/lib/regionContext'
import type { Translations } from '@/lib/translations'

const CATEGORIES: { key: string; labelKey: keyof Translations }[] = [
  { key: 'all', labelKey: 'cat_all' },
  { key: 'funny', labelKey: 'cat_entertainment' },
  { key: 'gaming', labelKey: 'cat_gaming' },
  { key: 'music', labelKey: 'cat_music' },
  { key: 'food', labelKey: 'cat_food' },
  { key: 'sports', labelKey: 'cat_sports' },
]

export default function ShortsPage() {
  const { t } = useRegion()
  const [activeCategory, setActiveCategory] = useState('all')
  const [videos, setVideos] = useState<VideoCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (category: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/yt/shorts?category=${category}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to load shorts')
      const data = await res.json()
      setVideos(data.videos ?? [])
    } catch {
      setError(t('shorts_empty'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { load('all') }, [load])

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="sticky top-14 z-30 bg-yt-bg border-b border-yt-border/40 px-4 py-3 flex items-center gap-4">
        <h1 className="text-yt-text font-semibold text-lg flex-shrink-0">{t('nav_shorts')}</h1>
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
          <VideoGrid videos={videos} loading={loading} emptyMessage={t('shorts_empty')} />
        )}
      </div>
    </div>
  )
}
