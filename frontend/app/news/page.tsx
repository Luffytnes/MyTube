'use client'

import { useState, useEffect, useCallback } from 'react'
import { Newspaper, ExternalLink, Globe, RefreshCw } from 'lucide-react'
import { getNews, type NewsArticle } from '@/lib/api'
import { useRegion, REGIONS } from '@/lib/regionContext'

const CATEGORIES = [
  'general', 'technology', 'business', 'entertainment',
  'sports', 'science', 'health', 'world', 'nation', 'politics',
] as const

type Category = typeof CATEGORIES[number]

function timeAgo(pubDate: string, t: (k: string) => string): string {
  if (!pubDate) return ''
  try {
    const date = new Date(pubDate)
    const diff = Math.floor((Date.now() - date.getTime()) / 1000)
    if (diff < 60) return t('news_ago_just_now')
    if (diff < 3600) return `${Math.floor(diff / 60)} ${t('news_ago_minutes')}`
    if (diff < 86400) return `${Math.floor(diff / 3600)} ${t('news_ago_hours')}`
    return `${Math.floor(diff / 86400)} ${t('news_ago_days')}`
  } catch {
    return ''
  }
}

function ArticleCard({ article, t }: { article: NewsArticle; t: (k: string) => string }) {
  const [imgError, setImgError] = useState(false)

  return (
    <a
      href={article.link}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-3 group p-3 rounded-xl hover:bg-yt-hover transition-colors border border-transparent hover:border-yt-border/40"
    >
      {/* Thumbnail — only if present (Google News RSS rarely includes images) */}
      {article.image && !imgError && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={article.image}
          alt={article.title}
          className="w-28 h-20 sm:w-36 sm:h-24 object-cover rounded-lg flex-shrink-0 bg-yt-secondary"
          onError={() => setImgError(true)}
        />
      )}

      {/* Info */}
      <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
        <div>
          <p className="text-yt-text text-sm font-medium leading-snug line-clamp-2 group-hover:text-yt-red transition-colors mb-1">
            {article.title}
          </p>
          {article.description && (
            <p className="text-yt-text-muted text-xs leading-relaxed line-clamp-2 hidden sm:block">
              {article.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          {article.source && (
            <span className="text-xs font-medium text-yt-text-secondary bg-yt-secondary px-2 py-0.5 rounded-full">
              {article.source}
            </span>
          )}
          <span className="text-xs text-yt-text-muted">{timeAgo(article.pubDate, t)}</span>
          <span className="ml-auto flex items-center gap-1 text-xs text-yt-text-muted group-hover:text-yt-red transition-colors">
            <ExternalLink className="w-3 h-3" />
            {t('news_read_more')}
          </span>
        </div>
      </div>
    </a>
  )
}

export default function NewsPage() {
  const { t, region, setRegion } = useRegion()
  const [selectedRegion, setSelectedRegion] = useState(region.code)
  const [category, setCategory] = useState<Category>('general')
  const [articles, setArticles] = useState<NewsArticle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const data = await getNews(selectedRegion, category)
      setArticles(data.articles)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [selectedRegion, category])

  useEffect(() => {
    load()
  }, [load])

  // Sync with global region on mount
  useEffect(() => {
    setSelectedRegion(region.code)
  }, [region.code])

  const catLabel = (cat: string) => t(`news_cat_${cat}` as Parameters<typeof t>[0])

  return (
    <div className="px-4 py-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Newspaper className="w-6 h-6 text-yt-text-muted flex-shrink-0" />
          <h1 className="text-yt-text text-2xl font-bold">{t('news_title')}</h1>
        </div>

        {/* Region selector */}
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-yt-text-muted flex-shrink-0" />
          <select
            value={selectedRegion}
            onChange={(e) => setSelectedRegion(e.target.value)}
            className="bg-yt-secondary border border-yt-border text-yt-text text-sm rounded-xl px-3 py-1.5 focus:outline-none focus:border-yt-red cursor-pointer"
          >
            {REGIONS.map((r) => (
              <option key={r.code} value={r.code}>
                {r.flag} {r.name}
              </option>
            ))}
          </select>
          <button
            onClick={load}
            disabled={loading}
            className="p-1.5 rounded-lg hover:bg-yt-hover text-yt-text-muted hover:text-yt-text transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Category pills */}
      <div className="flex gap-2 overflow-x-auto pb-1 mb-5 scrollbar-none">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors ${
              category === cat
                ? 'bg-yt-text text-yt-bg'
                : 'bg-yt-secondary text-yt-text-secondary hover:bg-yt-hover hover:text-yt-text border border-yt-border/60'
            }`}
          >
            {catLabel(cat)}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex gap-3 p-3 animate-pulse">
              <div className="w-28 h-20 sm:w-36 sm:h-24 rounded-lg bg-yt-secondary flex-shrink-0" />
              <div className="flex-1 space-y-2 py-1">
                <div className="h-4 bg-yt-secondary rounded w-full" />
                <div className="h-4 bg-yt-secondary rounded w-4/5" />
                <div className="h-3 bg-yt-secondary rounded w-1/3 mt-3" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Newspaper className="w-14 h-14 text-yt-text-muted mb-4" />
          <p className="text-yt-text text-lg font-medium mb-2">{t('news_error')}</p>
          <button
            onClick={load}
            className="mt-2 px-5 py-2 bg-yt-red hover:bg-yt-red-hover text-white rounded-full text-sm font-medium transition-colors"
          >
            Réessayer
          </button>
        </div>
      ) : articles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Newspaper className="w-14 h-14 text-yt-text-muted mb-4" />
          <p className="text-yt-text text-lg font-medium">{t('news_empty')}</p>
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-yt-border/30">
          {articles.map((article, i) => (
            <ArticleCard key={i} article={article} t={t} />
          ))}
        </div>
      )}
    </div>
  )
}
