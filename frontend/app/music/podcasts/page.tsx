'use client'

import { useState, useEffect, FormEvent } from 'react'
import Link from 'next/link'
import { Mic2, Search, X } from 'lucide-react'
import { useRegion } from '@/lib/regionContext'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface Podcast {
  browseId: string
  title: string
  author?: string
  thumbnail?: string
  episodes?: number
}

export default function PodcastsPage() {
  const { t, lang } = useRegion()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Podcast[]>([])
  const [loading, setLoading] = useState(true)
  const [searched, setSearched] = useState(false)

  // Load default podcasts on mount
  useEffect(() => {
    setLoading(true)
    fetch(`${API_BASE}/api/music/podcasts/search?q=&lang=${lang}`)
      .then((r) => r.json())
      .then((data) => setResults(Array.isArray(data) ? data : []))
      .catch(() => setResults([]))
      .finally(() => setLoading(false))
  }, [lang])

  function handleSearch(e: FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    setLoading(true)
    setSearched(true)
    fetch(`${API_BASE}/api/music/podcasts/search?q=${encodeURIComponent(q)}&lang=${lang}`)
      .then((r) => r.json())
      .then((data) => setResults(Array.isArray(data) ? data : []))
      .catch(() => setResults([]))
      .finally(() => setLoading(false))
  }

  function handleClear() {
    setQuery('')
    setSearched(false)
    setLoading(true)
    fetch(`${API_BASE}/api/music/podcasts/search?q=&lang=${lang}`)
      .then((r) => r.json())
      .then((data) => setResults(Array.isArray(data) ? data : []))
      .catch(() => setResults([]))
      .finally(() => setLoading(false))
  }

  return (
    <div className="px-4 py-6 max-w-5xl mx-auto min-h-screen">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Mic2 className="w-6 h-6 text-yt-red flex-shrink-0" />
        <h1 className="text-yt-text text-2xl font-bold">{t('podcast_nav')}</h1>
      </div>

      {/* Search bar */}
      <form onSubmit={handleSearch} className="flex items-center gap-2 mb-8">
        <div className="flex-1 flex items-center h-10 rounded-full border border-yt-border bg-yt-secondary px-4 gap-2 focus-within:border-yt-red transition-colors max-w-xl">
          <Search className="w-4 h-4 text-yt-text-muted flex-shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('podcast_search_placeholder')}
            className="flex-1 bg-transparent text-sm text-yt-text placeholder-yt-text-muted focus:outline-none"
          />
          {query && (
            <button type="button" onClick={handleClear} className="text-yt-text-muted hover:text-yt-text transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <button
          type="submit"
          className="flex items-center justify-center w-10 h-10 rounded-full bg-yt-secondary hover:bg-yt-hover border border-yt-border text-yt-text-secondary hover:text-yt-text transition-colors flex-shrink-0"
        >
          <Search className="w-4 h-4" />
        </button>
      </form>

      {/* Section title */}
      <p className="text-yt-text-muted text-xs uppercase tracking-wider mb-4">
        {searched ? t('podcast_results') : t('podcast_suggested')}
      </p>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <div className="aspect-square rounded-xl bg-yt-secondary animate-pulse" />
              <div className="h-4 bg-yt-secondary rounded animate-pulse" />
              <div className="h-3 w-2/3 bg-yt-secondary rounded animate-pulse" />
            </div>
          ))}
        </div>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Mic2 className="w-12 h-12 text-yt-text-muted mb-3" />
          <p className="text-yt-text-muted">{t('podcast_no_results')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {results.map((p) => (
            <Link
              key={p.browseId}
              href={`/music/podcasts/${p.browseId}`}
              className="flex flex-col gap-2 group"
            >
              <div className="aspect-square rounded-xl overflow-hidden bg-yt-secondary shadow flex-shrink-0">
                {p.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.thumbnail}
                    alt={p.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Mic2 className="w-10 h-10 text-yt-text-muted" />
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-yt-text truncate group-hover:text-yt-red transition-colors leading-snug">
                  {p.title}
                </p>
                {p.author && (
                  <p className="text-xs text-yt-text-muted truncate mt-0.5">{p.author}</p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
