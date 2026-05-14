'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Search, Film, Layers, Radio, Star, Play } from 'lucide-react'
import { useRegion } from '@/lib/regionContext'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

interface LiveResult   { stream_id: number; name: string; stream_icon: string }
interface VodResult    { stream_id: number; name: string; stream_icon: string; container_extension: string }
interface SeriesResult { series_id: number; name: string; cover: string }

type AnyResult =
  | { kind: 'live';   item: LiveResult }
  | { kind: 'vod';    item: VodResult }
  | { kind: 'series'; item: SeriesResult }

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

function TmdbGridCard({ name, type, href, fallbackIcon }: {
  name: string
  type: 'movie' | 'tv'
  href: string
  fallbackIcon: React.ReactNode
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [meta, setMeta] = useState<{ poster_path: string | null; vote_average: number | null } | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle')

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
            .then(d => { setMeta(d); setStatus('done') })
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
          <p className="text-yt-text text-xs font-medium line-clamp-2 leading-tight mt-1.5 px-0.5">{name}</p>
        )}
      </Card3D>
    </div>
  )
}

export default function TvSearchPage() {
  const { t } = useRegion()
  const searchParams = useSearchParams()
  const q = searchParams.get('q') || ''
  const [results, setResults] = useState<AnyResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const doSearch = useCallback(async (query: string) => {
    if (!query.trim()) { setResults([]); return }
    setLoading(true)
    setError(null)
    try {
      const [liveRes, vodRes, seriesRes] = await Promise.allSettled([
        fetch(`${API_BASE}/api/iptv/search?q=${encodeURIComponent(query)}&type=live`).then(r => r.json()),
        fetch(`${API_BASE}/api/iptv/search?q=${encodeURIComponent(query)}&type=vod`).then(r => r.json()),
        fetch(`${API_BASE}/api/iptv/search?q=${encodeURIComponent(query)}&type=series`).then(r => r.json()),
      ])
      const out: AnyResult[] = []
      if (liveRes.status === 'fulfilled' && Array.isArray(liveRes.value))
        liveRes.value.forEach((item: LiveResult) => out.push({ kind: 'live', item }))
      if (vodRes.status === 'fulfilled' && Array.isArray(vodRes.value))
        vodRes.value.forEach((item: VodResult) => out.push({ kind: 'vod', item }))
      if (seriesRes.status === 'fulfilled' && Array.isArray(seriesRes.value))
        seriesRes.value.forEach((item: SeriesResult) => out.push({ kind: 'series', item }))
      setResults(out)
    } catch {
      setError(t('iptv_error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { doSearch(q) }, [q, doSearch])

  const liveResults   = results.filter(r => r.kind === 'live')
  const vodResults    = results.filter(r => r.kind === 'vod')
  const seriesResults = results.filter(r => r.kind === 'series')

  return (
    <div className="px-4 py-6">
      <h1 className="text-yt-text text-lg font-semibold mb-6 flex items-center gap-2">
        <Search className="w-5 h-5 text-yt-red" />
        {q ? `"${q}"` : t('tv_search_placeholder')}
      </h1>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 border-yt-red border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <p className="text-yt-text-muted text-center py-20">{error}</p>
      ) : results.length === 0 && q ? (
        <p className="text-yt-text-muted text-center py-20">{t('noResultsFor')} «{q}»</p>
      ) : (
        <div className="space-y-10">
          {/* Live channels */}
          {liveResults.length > 0 && (
            <section>
              <h2 className="text-yt-text text-sm font-semibold uppercase tracking-widest mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                {t('iptv_live')}
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
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

          {/* Films */}
          {vodResults.length > 0 && (
            <section>
              <h2 className="text-yt-text text-sm font-semibold uppercase tracking-widest mb-4">Films</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {vodResults.map(r => {
                  const v = (r as { kind: 'vod'; item: VodResult }).item
                  return (
                    <TmdbGridCard
                      key={`vod-${v.stream_id}`}
                      name={v.name}
                      type="movie"
                      href={`/tv/film/${v.stream_id}?ext=${v.container_extension || 'mp4'}&name=${encodeURIComponent(v.name)}&icon=${encodeURIComponent(v.stream_icon || '')}`}
                      fallbackIcon={<Film className="w-10 h-10 text-yt-text-muted" />}
                    />
                  )
                })}
              </div>
            </section>
          )}

          {/* Séries */}
          {seriesResults.length > 0 && (
            <section>
              <h2 className="text-yt-text text-sm font-semibold uppercase tracking-widest mb-4">Séries</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {seriesResults.map(r => {
                  const s = (r as { kind: 'series'; item: SeriesResult }).item
                  return (
                    <TmdbGridCard
                      key={`series-${s.series_id}`}
                      name={s.name}
                      type="tv"
                      href={`/tv/series/${s.series_id}?name=${encodeURIComponent(s.name)}&icon=${encodeURIComponent(s.cover || '')}`}
                      fallbackIcon={<Layers className="w-10 h-10 text-yt-text-muted" />}
                    />
                  )
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
