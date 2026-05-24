'use client'

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Search, Film, Layers, Radio, Star, Play, SortAsc, Tag } from 'lucide-react'
import { useRegion } from '@/lib/regionContext'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

interface LiveResult   { stream_id: number; name: string; stream_icon: string }
interface VodResult    { stream_id: number; name: string; stream_icon: string; container_extension: string }
interface SeriesResult { series_id: number; name: string; cover: string }
interface Category     { category_id: string; category_name: string }

interface CategoryGroup {
  kind: 'vod-cat' | 'series-cat'
  category: Category
  items: (VodResult | SeriesResult)[]
}

type AnyResult =
  | { kind: 'live';   item: LiveResult }
  | { kind: 'vod';    item: VodResult;    rating?: number | null }
  | { kind: 'series'; item: SeriesResult; rating?: number | null }

type SortMode = 'default' | 'az' | 'rating'

// Category cache to avoid re-fetching on every keystroke
let _vodCatsCache: Category[] | null = null
let _seriesCatsCache: Category[] | null = null

async function getVodCats(): Promise<Category[]> {
  if (_vodCatsCache) return _vodCatsCache
  try {
    const r = await fetch(`${API_BASE}/api/iptv/vod_categories`)
    const d = r.ok ? await r.json() : []
    _vodCatsCache = Array.isArray(d) ? d : []
    return _vodCatsCache
  } catch { return [] }
}

async function getSeriesCats(): Promise<Category[]> {
  if (_seriesCatsCache) return _seriesCatsCache
  try {
    const r = await fetch(`${API_BASE}/api/iptv/series_categories`)
    const d = r.ok ? await r.json() : []
    _seriesCatsCache = Array.isArray(d) ? d : []
    return _seriesCatsCache
  } catch { return [] }
}

function Card3D({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    el.style.transition = 'transform 0.05s ease'
    el.style.transform = `perspective(600px) rotateX(${(y - 0.5) * -18}deg) rotateY(${(x - 0.5) * 18}deg) scale3d(1.06,1.06,1.06)`
  }

  function onMouseLeave() {
    const el = ref.current
    if (!el) return
    el.style.transition = 'transform 0.35s ease'
    el.style.transform = 'perspective(600px) rotateX(0deg) rotateY(0deg) scale3d(1,1,1)'
  }

  return (
    <div
      ref={ref}
      className={className}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      style={{ transformStyle: 'preserve-3d', willChange: 'transform' }}
    >
      {children}
    </div>
  )
}

function TmdbGridCard({ name, type, href, onRatingLoaded, fallbackIcon }: {
  name: string
  type: 'movie' | 'tv'
  href: string
  onRatingLoaded?: (rating: number | null) => void
  fallbackIcon: React.ReactNode
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [meta, setMeta] = useState<{ poster_path: string | null; vote_average: number | null } | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle')
  const onRatingRef = useRef(onRatingLoaded)
  onRatingRef.current = onRatingLoaded

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting) {
          obs.disconnect()
          setStatus('loading')
          fetch(`${API_BASE}/api/tmdb/meta?name=${encodeURIComponent(name)}&type=${type}`)
            .then(r => r.ok ? r.json() : null)
            .then(d => {
              setMeta(d)
              setStatus('done')
              onRatingRef.current?.(d?.vote_average ?? null)
            })
            .catch(() => setStatus('done'))
        }
      },
      { rootMargin: '250px' }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [name, type])

  const posterSrc = meta?.poster_path
    ? `${API_BASE}/api/tmdb/image?path=/w342${meta.poster_path}`
    : null
  const rating = meta?.vote_average ? meta.vote_average.toFixed(1) : null
  const noImage = status === 'done' && !posterSrc

  return (
    <div ref={wrapRef}>
      <Card3D className="w-full group">
        <Link href={href} className="block relative w-full aspect-[2/3] rounded-xl overflow-hidden bg-yt-secondary shadow-lg">
          {status !== 'done' ? (
            <div className="w-full h-full bg-yt-secondary animate-pulse" />
          ) : posterSrc ? (
            <img src={posterSrc} alt={name} loading="lazy" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">{fallbackIcon}</div>
          )}
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <Play className="w-5 h-5 text-white fill-white ml-0.5" />
            </div>
          </div>
          {rating && (
            <div className="absolute bottom-1.5 left-1.5 flex items-center gap-0.5 bg-black/70 rounded-md px-1.5 py-0.5">
              <Star className="w-2.5 h-2.5 text-yellow-400 fill-yellow-400" />
              <span className="text-[10px] text-white font-medium">{rating}</span>
            </div>
          )}
        </Link>
        {noImage && (
          <p className="text-yt-text text-xs font-medium line-clamp-1 mt-1.5 px-0.5">{name}</p>
        )}
      </Card3D>
    </div>
  )
}

function GenreChips({ type, label }: { type: 'vod' | 'series'; label: string }) {
  const router = useRouter()
  const [cats, setCats] = useState<Category[]>([])

  useEffect(() => {
    const fn = type === 'vod' ? getVodCats : getSeriesCats
    fn().then(d => setCats(d.slice(0, 20)))
  }, [type])

  if (!cats.length) return null

  const tab = type === 'vod' ? 'vod' : 'series'

  return (
    <div className="mb-6">
      <h3 className="text-yt-text-muted text-xs font-semibold uppercase tracking-widest mb-2">{label}</h3>
      <div className="flex flex-wrap gap-2">
        {cats.map(c => (
          <button
            key={c.category_id}
            onClick={() => router.push(`/tv?tab=${tab}&cat=${c.category_id}`)}
            className="px-3 py-1.5 rounded-full bg-yt-secondary hover:bg-yt-hover border border-yt-border/40 text-yt-text text-xs font-medium transition-colors"
          >
            {c.category_name}
          </button>
        ))}
      </div>
    </div>
  )
}

function SortBar({ mode, onChange }: { mode: SortMode; onChange: (m: SortMode) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-xl bg-yt-secondary border border-yt-border/40 p-0.5">
      {([['default', 'Défaut', null], ['az', 'A-Z', <SortAsc key="az" className="w-3 h-3" />], ['rating', 'Note', <Star key="r" className="w-3 h-3" />]] as [SortMode, string, React.ReactNode][]).map(([val, label, icon]) => (
        <button
          key={val}
          onClick={() => onChange(val)}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            mode === val ? 'bg-yt-red text-white' : 'text-yt-text-muted hover:text-yt-text'
          }`}
        >
          {icon}
          {label}
        </button>
      ))}
    </div>
  )
}

function CategoryGroupSection({ group, sortMode, ratings, onRatingLoaded }: {
  group: CategoryGroup
  sortMode: SortMode
  ratings: Record<string, number | null>
  onRatingLoaded: (name: string, r: number | null) => void
}) {
  const isVod = group.kind === 'vod-cat'
  const items = group.items as (VodResult & SeriesResult)[]
  const sorted = sortMode === 'az'
    ? [...items].sort((a, b) => a.name.localeCompare(b.name))
    : sortMode === 'rating'
      ? [...items].sort((a, b) => (ratings[b.name] ?? -1) - (ratings[a.name] ?? -1))
      : items

  return (
    <section>
      <h2 className="text-yt-text text-sm font-semibold uppercase tracking-widest mb-4 flex items-center gap-2">
        <Tag className="w-4 h-4 text-yt-red" />
        {group.category.category_name}
        <span className="text-yt-text-muted font-normal normal-case text-xs tracking-normal">({sorted.length} titres)</span>
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {sorted.slice(0, 40).map(item => {
          const id = isVod ? (item as VodResult).stream_id : (item as SeriesResult).series_id
          const href = isVod
            ? `/tv/film/${(item as VodResult).stream_id}?ext=${(item as VodResult).container_extension || 'mp4'}&name=${encodeURIComponent(item.name)}&icon=${encodeURIComponent((item as VodResult).stream_icon || '')}`
            : `/tv/series/${(item as SeriesResult).series_id}?name=${encodeURIComponent(item.name)}&icon=${encodeURIComponent((item as SeriesResult).cover || '')}`
          return (
            <TmdbGridCard
              key={`${group.kind}-${id}`}
              name={item.name}
              type={isVod ? 'movie' : 'tv'}
              href={href}
              onRatingLoaded={r => onRatingLoaded(item.name, r)}
              fallbackIcon={isVod ? <Film className="w-10 h-10 text-yt-text-muted" /> : <Layers className="w-10 h-10 text-yt-text-muted" />}
            />
          )
        })}
      </div>
    </section>
  )
}

function TvSearchContent() {
  const { t } = useRegion()
  const searchParams = useSearchParams()
  const q = searchParams.get('q') || ''
  const [results, setResults] = useState<AnyResult[]>([])
  const [categoryGroups, setCategoryGroups] = useState<CategoryGroup[]>([])
  const [ratings, setRatings] = useState<Record<string, number | null>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<SortMode>('default')

  const doSearch = useCallback(async (query: string) => {
    if (!query.trim()) { setResults([]); setCategoryGroups([]); return }
    setLoading(true)
    setError(null)
    setRatings({})
    setCategoryGroups([])

    try {
      const qLower = query.trim().toLowerCase()

      // Run title search + category fetch in parallel
      const [liveRes, vodRes, seriesRes, vodCats, seriesCats] = await Promise.all([
        fetch(`${API_BASE}/api/iptv/search?q=${encodeURIComponent(query)}&type=live`).then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(`${API_BASE}/api/iptv/search?q=${encodeURIComponent(query)}&type=vod`).then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(`${API_BASE}/api/iptv/search?q=${encodeURIComponent(query)}&type=series`).then(r => r.ok ? r.json() : []).catch(() => []),
        getVodCats(),
        getSeriesCats(),
      ])

      // Build title search results
      const out: AnyResult[] = []
      if (Array.isArray(liveRes)) liveRes.forEach((item: LiveResult) => out.push({ kind: 'live', item }))
      if (Array.isArray(vodRes))  vodRes.forEach((item: VodResult) => out.push({ kind: 'vod', item }))
      if (Array.isArray(seriesRes)) seriesRes.forEach((item: SeriesResult) => out.push({ kind: 'series', item }))
      setResults(out)

      // Find matching categories (partial case-insensitive match)
      const matchVod = vodCats.filter(c => c.category_name.toLowerCase().includes(qLower))
      const matchSeries = seriesCats.filter(c => c.category_name.toLowerCase().includes(qLower))

      if (matchVod.length === 0 && matchSeries.length === 0) { setLoading(false); return }

      // Fetch items for matching categories (cap at 3 categories each)
      const groups: CategoryGroup[] = []
      await Promise.all([
        ...matchVod.slice(0, 3).map(async cat => {
          const items = await fetch(`${API_BASE}/api/iptv/vod?category_id=${cat.category_id}`)
            .then(r => r.ok ? r.json() : []).catch(() => [])
          if (Array.isArray(items) && items.length > 0)
            groups.push({ kind: 'vod-cat', category: cat, items })
        }),
        ...matchSeries.slice(0, 3).map(async cat => {
          const items = await fetch(`${API_BASE}/api/iptv/series?category_id=${cat.category_id}`)
            .then(r => r.ok ? r.json() : []).catch(() => [])
          if (Array.isArray(items) && items.length > 0)
            groups.push({ kind: 'series-cat', category: cat, items })
        }),
      ])

      setCategoryGroups(groups)
    } catch {
      setError(t('iptv_error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { doSearch(q) }, [q, doSearch])

  const handleRating = useCallback((name: string, rating: number | null) => {
    setRatings(prev => ({ ...prev, [name]: rating }))
  }, [])

  function sortList<T extends { name: string }>(list: T[]): T[] {
    if (sortMode === 'az') return [...list].sort((a, b) => a.name.localeCompare(b.name))
    if (sortMode === 'rating') return [...list].sort((a, b) => (ratings[b.name] ?? -1) - (ratings[a.name] ?? -1))
    return list
  }

  const liveResults   = results.filter(r => r.kind === 'live')
  const vodResults    = sortList(results.filter(r => r.kind === 'vod').map(r => (r as { kind: 'vod'; item: VodResult }).item))
  const seriesResults = sortList(results.filter(r => r.kind === 'series').map(r => (r as { kind: 'series'; item: SeriesResult }).item))
  const hasTitleResults = liveResults.length + vodResults.length + seriesResults.length > 0
  const hasAnything = hasTitleResults || categoryGroups.length > 0

  return (
    <div className="px-4 py-6">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-yt-text text-lg font-semibold flex items-center gap-2">
          <Search className="w-5 h-5 text-yt-red" />
          {q ? `"${q}"` : t('tv_search_placeholder')}
        </h1>
        {hasAnything && (
          <SortBar mode={sortMode} onChange={setSortMode} />
        )}
      </div>

      {/* Genre chips when no query */}
      {!q && !loading && (
        <div className="mb-8">
          <GenreChips type="vod" label="Films par genre" />
          <GenreChips type="series" label="Séries par genre" />
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 border-yt-red border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <p className="text-yt-text-muted text-center py-20">{error}</p>
      ) : !hasAnything && q ? (
        <p className="text-yt-text-muted text-center py-20">{t('noResultsFor')} «{q}»</p>
      ) : (
        <div className="space-y-10">
          {/* Category matches — shown first, most relevant */}
          {categoryGroups.map((group, i) => (
            <CategoryGroupSection
              key={`${group.kind}-${group.category.category_id}-${i}`}
              group={group}
              sortMode={sortMode}
              ratings={ratings}
              onRatingLoaded={handleRating}
            />
          ))}

          {/* Title matches — only shown if no category results, or as supplement */}
          {hasTitleResults && (
            <>
              {categoryGroups.length > 0 && (
                <div className="border-t border-yt-border/30 pt-6">
                  <p className="text-yt-text-muted text-xs uppercase tracking-widest mb-6">Correspondances de titre</p>
                </div>
              )}

              {liveResults.length > 0 && (
                <section>
                  <h2 className="text-yt-text text-sm font-semibold uppercase tracking-widest mb-4 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    {t('iptv_live')}
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                    {liveResults.map(r => {
                      const ch = (r as { kind: 'live'; item: LiveResult }).item
                      return (
                        <Link
                          key={`live-${ch.stream_id}`}
                          href={`/tv/watch/${ch.stream_id}?type=live&name=${encodeURIComponent(ch.name)}&icon=${encodeURIComponent(ch.stream_icon || '')}`}
                          className="flex flex-col items-center gap-2 p-3 rounded-xl bg-yt-secondary hover:bg-yt-hover transition-colors border border-yt-border/30"
                        >
                          <div className="w-14 h-14 rounded-xl bg-yt-bg flex items-center justify-center overflow-hidden">
                            <Radio className="w-7 h-7 text-yt-text-muted" />
                          </div>
                          <p className="text-yt-text text-xs font-medium text-center line-clamp-2">{ch.name}</p>
                        </Link>
                      )
                    })}
                  </div>
                </section>
              )}

              {vodResults.length > 0 && (
                <section>
                  <h2 className="text-yt-text text-sm font-semibold uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Film className="w-4 h-4 text-yt-text-muted" />
                    Films
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                    {vodResults.map(v => (
                      <TmdbGridCard
                        key={`vod-${v.stream_id}`}
                        name={v.name}
                        type="movie"
                        href={`/tv/film/${v.stream_id}?ext=${v.container_extension || 'mp4'}&name=${encodeURIComponent(v.name)}&icon=${encodeURIComponent(v.stream_icon || '')}`}
                        onRatingLoaded={r => handleRating(v.name, r)}
                        fallbackIcon={<Film className="w-10 h-10 text-yt-text-muted" />}
                      />
                    ))}
                  </div>
                </section>
              )}

              {seriesResults.length > 0 && (
                <section>
                  <h2 className="text-yt-text text-sm font-semibold uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-yt-text-muted" />
                    Séries
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                    {seriesResults.map(s => (
                      <TmdbGridCard
                        key={`series-${s.series_id}`}
                        name={s.name}
                        type="tv"
                        href={`/tv/series/${s.series_id}?name=${encodeURIComponent(s.name)}&icon=${encodeURIComponent(s.cover || '')}`}
                        onRatingLoaded={r => handleRating(s.name, r)}
                        fallbackIcon={<Layers className="w-10 h-10 text-yt-text-muted" />}
                      />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function TvSearchPage() {
  return <Suspense><TvSearchContent /></Suspense>
}
