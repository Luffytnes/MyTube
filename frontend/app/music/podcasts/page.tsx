'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Mic2, ChevronRight, Search, AlertCircle } from 'lucide-react'
import { useRegion } from '@/lib/regionContext'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface Podcast {
  id: string
  title: string
  author?: string
  thumbnail?: string
  episodeCount?: number
}

const CATEGORIES = [
  { labelKey: 'podcast_cat_news', query: 'news' },
  { labelKey: 'podcast_cat_culture', query: 'culture society' },
  { labelKey: 'podcast_cat_science', query: 'science technology' },
  { labelKey: 'podcast_cat_sport', query: 'sport' },
  { labelKey: 'podcast_cat_business', query: 'business economy' },
  { labelKey: 'podcast_cat_comedy', query: 'comedy humor' },
] as const

function PodcastGrid({ podcasts, loading }: { podcasts: Podcast[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="aspect-square rounded-xl bg-yt-secondary animate-pulse" />
            <div className="h-3.5 bg-yt-secondary rounded animate-pulse" />
          </div>
        ))}
      </div>
    )
  }
  if (podcasts.length === 0) return null
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
      {podcasts.map((p) => (
        <Link key={p.id} href={`/music/podcasts/${p.id}`} className="flex flex-col gap-2 group">
          <div className="aspect-square rounded-xl overflow-hidden bg-yt-secondary shadow flex-shrink-0">
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
            <p className="text-xs font-medium text-yt-text truncate group-hover:text-yt-red transition-colors leading-snug">{p.title}</p>
            {p.author && <p className="text-xs text-yt-text-muted truncate">{p.author}</p>}
          </div>
        </Link>
      ))}
    </div>
  )
}

export default function PodcastsPage() {
  const { t } = useRegion()
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<Podcast[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [notConfigured, setNotConfigured] = useState(false)
  const [sections, setSections] = useState<{ labelKey: string; query: string; podcasts: Podcast[]; loading: boolean }[]>(
    CATEGORIES.map((c) => ({ ...c, podcasts: [], loading: true }))
  )

  // Load thematic sections on mount
  useEffect(() => {
    CATEGORIES.forEach((cat, idx) => {
      fetch(`${API_BASE}/api/podcasts/search?q=${encodeURIComponent(cat.query)}`)
        .then((r) => {
          if (r.status === 503) { setNotConfigured(true); return [] }
          return r.json()
        })
        .then((d: Podcast[]) => Array.isArray(d) ? d.slice(0, 6) : [])
        .catch((): Podcast[] => [])
        .then((podcasts) => {
          setSections((prev) => prev.map((s, i) => i === idx ? { ...s, podcasts, loading: false } : s))
        })
    })
  }, [])

  // Search
  useEffect(() => {
    if (!searchQ.trim()) { setSearchResults([]); return }
    const timer = setTimeout(() => {
      setSearchLoading(true)
      fetch(`${API_BASE}/api/podcasts/search?q=${encodeURIComponent(searchQ)}`)
        .then((r) => r.json())
        .then((d) => Array.isArray(d) ? d : [])
        .catch((): Podcast[] => [])
        .then((r) => { setSearchResults(r); setSearchLoading(false) })
    }, 400)
    return () => clearTimeout(timer)
  }, [searchQ])

  return (
    <div className="px-4 py-6 max-w-5xl mx-auto min-h-screen space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Mic2 className="w-6 h-6 text-yt-red flex-shrink-0" />
        <h1 className="text-yt-text text-2xl font-bold">{t('podcast_nav')}</h1>
      </div>

      {/* Not configured banner */}
      {notConfigured && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium mb-1">{t('podcast_not_configured_title')}</p>
            <p className="text-xs opacity-80">{t('podcast_not_configured_desc')}</p>
          </div>
        </div>
      )}

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-yt-text-muted" />
        <input
          type="text"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          placeholder={t('podcast_search_placeholder')}
          className="w-full pl-10 pr-4 py-2.5 bg-yt-secondary border border-yt-border rounded-xl text-sm text-yt-text placeholder-yt-text-muted focus:outline-none focus:border-yt-red transition-colors"
        />
      </div>

      {/* Search results */}
      {searchQ.trim() && (
        <section>
          <h2 className="text-yt-text text-lg font-semibold mb-3">{t('podcast_results')}</h2>
          <PodcastGrid podcasts={searchResults} loading={searchLoading} />
          {!searchLoading && searchResults.length === 0 && (
            <p className="text-yt-text-muted text-sm">{t('podcast_no_results')}</p>
          )}
        </section>
      )}

      {/* Thematic sections */}
      {!searchQ.trim() && sections.map((section) => (
        <section key={section.query}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-yt-text text-lg font-semibold">{t(section.labelKey as Parameters<typeof t>[0])}</h2>
            <button
              onClick={() => setSearchQ(section.query)}
              className="flex items-center gap-1 text-xs text-yt-text-muted hover:text-yt-text transition-colors"
            >
              {t('music_see_all')} <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <PodcastGrid podcasts={section.podcasts} loading={section.loading} />
        </section>
      ))}
    </div>
  )
}
