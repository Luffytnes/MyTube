'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Mic2 } from 'lucide-react'
import { useRegion } from '@/lib/regionContext'
import { getMusicSearchHistory } from '@/lib/musicSearchHistory'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface Podcast {
  browseId: string
  title: string
  author?: string
  thumbnail?: string
}

function interleave<T extends { browseId?: string }>(buckets: T[][]): T[] {
  const seen = new Set<string>()
  const merged: T[] = []
  const max = Math.max(...buckets.map((b) => b.length))
  for (let i = 0; i < max; i++) {
    for (const b of buckets) {
      const item = b[i]
      if (item?.browseId && !seen.has(item.browseId)) {
        seen.add(item.browseId)
        merged.push(item)
      }
    }
  }
  return merged
}

export default function PodcastsPage() {
  const { t, lang } = useRegion()
  const [podcasts, setPodcasts] = useState<Podcast[]>([])
  const [loading, setLoading] = useState(true)
  const [fromHistory, setFromHistory] = useState(false)

  useEffect(() => {
    const history = getMusicSearchHistory().slice(0, 3).map((h) => h.query)

    if (history.length === 0) {
      // No history — load generic suggestions
      fetch(`${API_BASE}/api/music/podcasts/search?q=&lang=${lang}`)
        .then((r) => r.json())
        .then((data) => setPodcasts(Array.isArray(data) ? data.slice(0, 20) : []))
        .catch(() => setPodcasts([]))
        .finally(() => setLoading(false))
      return
    }

    setFromHistory(true)
    Promise.all(
      history.map((q) =>
        fetch(`${API_BASE}/api/music/podcasts/search?q=${encodeURIComponent(q)}&lang=${lang}`)
          .then((r) => r.json())
          .then((data): Podcast[] => Array.isArray(data) ? data.slice(0, 6) : [])
          .catch((): Podcast[] => [])
      )
    ).then((buckets) => {
      setPodcasts(interleave(buckets).slice(0, 20))
    }).finally(() => setLoading(false))
  }, [lang])

  return (
    <div className="px-4 py-6 max-w-5xl mx-auto min-h-screen">
      <div className="flex items-center gap-3 mb-6">
        <Mic2 className="w-6 h-6 text-yt-red flex-shrink-0" />
        <h1 className="text-yt-text text-2xl font-bold">{t('podcast_nav')}</h1>
      </div>

      <p className="text-yt-text-muted text-xs uppercase tracking-wider mb-4">
        {fromHistory ? t('podcast_suggested_for_you') : t('podcast_suggested')}
      </p>

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
      ) : podcasts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Mic2 className="w-12 h-12 text-yt-text-muted mb-3" />
          <p className="text-yt-text-muted">{t('podcast_no_results')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {podcasts.map((p) => (
            <Link key={p.browseId} href={`/music/podcasts/${p.browseId}`} className="flex flex-col gap-2 group">
              <div className="aspect-square rounded-xl overflow-hidden bg-yt-secondary shadow flex-shrink-0">
                {p.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumbnail} alt={p.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Mic2 className="w-10 h-10 text-yt-text-muted" />
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-yt-text truncate group-hover:text-yt-red transition-colors leading-snug">{p.title}</p>
                {p.author && <p className="text-xs text-yt-text-muted truncate mt-0.5">{p.author}</p>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
