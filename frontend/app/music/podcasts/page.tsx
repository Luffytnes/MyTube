'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Mic2, ChevronRight } from 'lucide-react'
import { useRegion } from '@/lib/regionContext'
import { getMusicSearchHistory } from '@/lib/musicSearchHistory'
import type { Translations } from '@/lib/translations'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface Podcast {
  browseId: string
  title: string
  author?: string
  thumbnail?: string
}

interface Section {
  labelKey: keyof Translations
  query: string
  podcasts: Podcast[]
  loading: boolean
}

const THEMES: { labelKey: keyof Translations; query: string }[] = [
  { labelKey: 'podcast_cat_news', query: 'news actualité' },
  { labelKey: 'podcast_cat_culture', query: 'culture society' },
  { labelKey: 'podcast_cat_science', query: 'science technology' },
  { labelKey: 'podcast_cat_sport', query: 'sport' },
  { labelKey: 'podcast_cat_business', query: 'business economy' },
  { labelKey: 'podcast_cat_comedy', query: 'comedy humour' },
]

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
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
      {podcasts.map((p) => (
        <Link key={p.browseId} href={`/music/podcasts/${p.browseId}`} className="flex flex-col gap-2 group">
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
  const { t, lang } = useRegion()
  const [forYou, setForYou] = useState<Podcast[]>([])
  const [forYouLoading, setForYouLoading] = useState(false)
  const [sections, setSections] = useState<Section[]>(
    THEMES.map((th) => ({ ...th, podcasts: [], loading: true }))
  )

  // Personalised "For You" based on history
  useEffect(() => {
    const history = getMusicSearchHistory().slice(0, 3).map((h) => h.query)
    if (history.length === 0) return
    setForYouLoading(true)
    Promise.all(
      history.map((q) =>
        fetch(`${API_BASE}/api/music/podcasts/search?q=${encodeURIComponent(q)}&lang=${lang}`)
          .then((r) => r.json())
          .then((d): Podcast[] => (Array.isArray(d) ? d.slice(0, 4) : []))
          .catch((): Podcast[] => [])
      )
    ).then((buckets) => {
      const seen = new Set<string>()
      const merged: Podcast[] = []
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
      setForYou(merged.slice(0, 12))
    }).finally(() => setForYouLoading(false))
  }, [lang])

  // Thematic sections — load one by one to avoid hammering the backend
  useEffect(() => {
    THEMES.forEach((theme, idx) => {
      fetch(`${API_BASE}/api/music/podcasts/search?q=${encodeURIComponent(theme.query)}&lang=${lang}`)
        .then((r) => r.json())
        .then((d): Podcast[] => (Array.isArray(d) ? d.slice(0, 6) : []))
        .catch((): Podcast[] => [])
        .then((podcasts) => {
          setSections((prev) =>
            prev.map((s, i) => i === idx ? { ...s, podcasts, loading: false } : s)
          )
        })
    })
  }, [lang])

  return (
    <div className="px-4 py-6 max-w-5xl mx-auto min-h-screen space-y-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Mic2 className="w-6 h-6 text-yt-red flex-shrink-0" />
        <h1 className="text-yt-text text-2xl font-bold">{t('podcast_nav')}</h1>
      </div>

      {/* For You */}
      {(forYouLoading || forYou.length > 0) && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-yt-text text-lg font-semibold">{t('podcast_suggested_for_you')}</h2>
            <span className="text-yt-text-muted text-xs">{t('music_based_on_searches')}</span>
          </div>
          <PodcastGrid podcasts={forYou} loading={forYouLoading} />
        </section>
      )}

      {/* Thematic sections */}
      {sections.map((section) => (
        <section key={section.query}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-yt-text text-lg font-semibold">{t(section.labelKey)}</h2>
            <Link
              href={`/music/search?q=${encodeURIComponent(section.query)}&filter=podcasts`}
              className="flex items-center gap-1 text-xs text-yt-text-muted hover:text-yt-text transition-colors"
            >
              {t('music_see_all')} <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <PodcastGrid podcasts={section.podcasts} loading={section.loading} />
        </section>
      ))}
    </div>
  )
}
