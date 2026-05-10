'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Search, Tv, Film, Layers, Radio } from 'lucide-react'
import { useRegion } from '@/lib/regionContext'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

interface LiveResult { stream_id: number; name: string; stream_icon: string }
interface VodResult { stream_id: number; name: string; stream_icon: string; container_extension: string }
interface SeriesResult { series_id: number; name: string; cover: string }

type AnyResult =
  | { kind: 'live'; item: LiveResult }
  | { kind: 'vod'; item: VodResult }
  | { kind: 'series'; item: SeriesResult }

function Cover({ src, fallback }: { src: string; fallback: React.ReactNode }) {
  const [err, setErr] = useState(false)
  if (!src || err) return <div className="w-full h-full flex items-center justify-center bg-yt-secondary">{fallback}</div>
  return (
    <img
      src={`${API_BASE}/api/iptv/icon?url=${encodeURIComponent(src)}`}
      alt=""
      loading="lazy"
      className="w-full h-full object-cover"
      onError={() => setErr(true)}
    />
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

  return (
    <div className="px-4 py-6 max-w-7xl mx-auto">
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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {results.map((r) => {
            if (r.kind === 'live') {
              const ch = r.item
              return (
                <Link
                  key={`live-${ch.stream_id}`}
                  href={`/tv/watch/${ch.stream_id}?type=live&name=${encodeURIComponent(ch.name)}&icon=${encodeURIComponent(ch.stream_icon || '')}`}
                  className="flex flex-col items-center gap-2 p-3 rounded-xl bg-yt-secondary hover:bg-yt-hover transition-colors border border-yt-border/30"
                >
                  <div className="w-14 h-14 rounded-xl bg-yt-bg flex items-center justify-center overflow-hidden">
                    <Cover src={ch.stream_icon} fallback={<Radio className="w-7 h-7 text-yt-text-muted" />} />
                  </div>
                  <p className="text-yt-text text-xs font-medium text-center line-clamp-2">{ch.name}</p>
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-[10px] text-yt-text-muted">{t('iptv_live')}</span>
                  </div>
                </Link>
              )
            }
            if (r.kind === 'vod') {
              const v = r.item
              return (
                <Link
                  key={`vod-${v.stream_id}`}
                  href={`/tv/watch/${v.stream_id}?type=vod&ext=${v.container_extension || 'mp4'}&name=${encodeURIComponent(v.name)}&icon=${encodeURIComponent(v.stream_icon || '')}`}
                  className="flex flex-col rounded-xl overflow-hidden bg-yt-secondary hover:bg-yt-hover transition-colors border border-yt-border/30"
                >
                  <div className="w-full aspect-[2/3] bg-yt-bg">
                    <Cover src={v.stream_icon} fallback={<Film className="w-10 h-10 text-yt-text-muted" />} />
                  </div>
                  <p className="text-yt-text text-xs font-medium line-clamp-2 px-2 py-2">{v.name}</p>
                </Link>
              )
            }
            const s = r.item as SeriesResult
            return (
              <Link
                key={`series-${s.series_id}`}
                href={`/tv/series/${s.series_id}?name=${encodeURIComponent(s.name)}&icon=${encodeURIComponent(s.cover || '')}`}
                className="flex flex-col rounded-xl overflow-hidden bg-yt-secondary hover:bg-yt-hover transition-colors border border-yt-border/30"
              >
                <div className="w-full aspect-[2/3] bg-yt-bg">
                  <Cover src={s.cover} fallback={<Layers className="w-10 h-10 text-yt-text-muted" />} />
                </div>
                <p className="text-yt-text text-xs font-medium line-clamp-2 px-2 py-2">{s.name}</p>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
