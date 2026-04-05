'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import VideoGrid from '@/components/video/VideoGrid'
import { getTrending } from '@/lib/api'
import type { VideoCard } from '@/lib/api'
import { useRegion } from '@/lib/regionContext'
import type { Translations } from '@/lib/translations'

const CATEGORIES: { key: string; labelKey: keyof Translations }[] = [
  { key: 'all', labelKey: 'cat_all' },
  { key: 'music', labelKey: 'cat_music' },
  { key: 'gaming', labelKey: 'cat_gaming' },
  { key: 'news', labelKey: 'cat_news' },
  { key: 'movies', labelKey: 'cat_movies' },
]

export default function TrendingPage() {
  const { t, region, lang } = useRegion()
  const [activeCategory, setActiveCategory] = useState('all')
  const [videos, setVideos] = useState<VideoCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const cache = useRef<Record<string, VideoCard[]>>({})

  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  function updateScrollState() {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 8)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8)
  }

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    updateScrollState()
    el.addEventListener('scroll', updateScrollState)
    window.addEventListener('resize', updateScrollState)
    return () => {
      el.removeEventListener('scroll', updateScrollState)
      window.removeEventListener('resize', updateScrollState)
    }
  }, [])

  function scrollCategories(dir: 'left' | 'right') {
    scrollRef.current?.scrollBy({ left: dir === 'right' ? 200 : -200, behavior: 'smooth' })
  }

  const loadCategory = useCallback(async (category: string, regionCode: string) => {
    const cacheKey = `${regionCode}:${category}`
    if (cache.current[cacheKey]) {
      setVideos(cache.current[cacheKey])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await getTrending(regionCode, category, lang)
      cache.current[cacheKey] = data.videos
      setVideos(data.videos)
    } catch {
      setError(t('error_trending'))
    } finally {
      setLoading(false)
    }
  }, [t, lang])

  useEffect(() => {
    cache.current = {}
    setActiveCategory('all')
    loadCategory('all', region.code)
  }, [region.code, lang]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen">
      {/* Category chips */}
      <div className="sticky top-14 z-30 bg-yt-bg border-b border-yt-border/40 px-2 py-3 flex items-center gap-1">
        <button
          onClick={() => scrollCategories('left')}
          className={`flex-shrink-0 p-1.5 rounded-full bg-yt-bg hover:bg-yt-hover text-yt-text transition-all ${
            canScrollLeft ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          aria-label="Scroll left"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div ref={scrollRef} className="flex gap-2 overflow-x-auto flex-1" style={{ scrollbarWidth: 'none' }}>
          {CATEGORIES.map(({ key, labelKey }) => (
            <button
              key={key}
              onClick={() => { setActiveCategory(key); loadCategory(key, region.code) }}
              className={`category-chip flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                activeCategory === key
                  ? 'bg-yt-text text-yt-bg'
                  : 'bg-yt-secondary text-yt-text hover:bg-yt-hover'
              }`}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>

        <button
          onClick={() => scrollCategories('right')}
          className={`flex-shrink-0 p-1.5 rounded-full bg-yt-bg hover:bg-yt-hover text-yt-text transition-all ${
            canScrollRight ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          aria-label="Scroll right"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="px-4 py-6">
        {error ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-yt-text-muted text-lg mb-4">{error}</p>
            <button
              onClick={() => loadCategory(activeCategory, region.code)}
              className="px-6 py-2.5 bg-yt-red hover:bg-yt-red-hover text-white rounded-full text-sm font-medium transition-colors"
            >
              {t('retry')}
            </button>
          </div>
        ) : (
          <VideoGrid videos={videos} loading={loading} emptyMessage={t('noTrendingVideos')} />
        )}
      </div>
    </div>
  )
}
