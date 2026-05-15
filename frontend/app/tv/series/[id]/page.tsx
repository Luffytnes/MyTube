'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { ReactNode } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Play, Plus, Check, Clock, Star, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useRegion } from '@/lib/regionContext'
import { toggleTvFavorite, isTvFavorite } from '@/lib/tvFavorites'
import { getContinueWatching, type ContinueItem } from '@/lib/tvContinueWatching'
import TrailerModal from '@/components/tv/TrailerModal'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

interface Episode {
  id: string
  title: string
  episode_num: number
  container_extension: string
  info: { duration?: string; plot?: string; movie_image?: string }
}

interface SeriesInfo {
  info: { name: string; cover: string; genre: string; plot: string; rating: string; releaseDate?: string }
  episodes: Record<string, Episode[]>
}

interface TmdbRecoItem {
  id: number
  title?: string
  name?: string
  poster_path: string | null
  backdrop_path?: string | null
  vote_average?: number
  overview?: string
  release_date?: string
  first_air_date?: string
}

function Card3D({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const move = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current; if (!el) return
    const r = el.getBoundingClientRect()
    const rx = ((e.clientY - r.top - r.height / 2) / (r.height / 2)) * -10
    const ry = ((e.clientX - r.left - r.width / 2) / (r.width / 2)) * 10
    el.style.transform = `perspective(600px) rotateX(${rx}deg) rotateY(${ry}deg) scale(1.05)`
  }
  const leave = () => { if (ref.current) ref.current.style.transform = '' }
  return (
    <div ref={ref} className={className} onMouseMove={move} onMouseLeave={leave}
      style={{ transition: 'transform 0.15s ease', willChange: 'transform' }}>
      {children}
    </div>
  )
}

function SeasonTabs({ seasons, selected, onSelect, label }: {
  seasons: string[]; selected: string | null; onSelect: (s: string) => void; label: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const check = useCallback(() => {
    const el = scrollRef.current; if (!el) return
    setCanLeft(el.scrollLeft > 4)
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4)
  }, [])

  useEffect(() => {
    const el = scrollRef.current; if (!el) return
    check()
    el.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    return () => { el.removeEventListener('scroll', check); window.removeEventListener('resize', check) }
  }, [check])

  useEffect(() => { check() }, [seasons, check])

  const shift = (dir: 'left' | 'right') =>
    scrollRef.current?.scrollBy({ left: dir === 'left' ? -200 : 200, behavior: 'smooth' })

  return (
    <div className="relative border-b border-yt-border/40 mb-5">
      {canLeft && (
        <button onClick={() => shift('left')} className="absolute left-0 top-0 bottom-0 z-10 w-8 flex items-center justify-center bg-gradient-to-r from-yt-bg via-yt-bg/80 to-transparent">
          <ChevronLeft className="w-4 h-4 text-yt-text-muted" />
        </button>
      )}
      <div ref={scrollRef} className="flex gap-0 overflow-x-auto scrollbar-none">
        {seasons.map(s => (
          <button
            key={s}
            onClick={() => onSelect(s)}
            className={`flex-shrink-0 px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              selected === s ? 'border-yt-red text-yt-text' : 'border-transparent text-yt-text-muted hover:text-yt-text'
            }`}
          >
            {label} {s}
          </button>
        ))}
      </div>
      {canRight && (
        <button onClick={() => shift('right')} className="absolute right-0 top-0 bottom-0 z-10 w-8 flex items-center justify-center bg-gradient-to-l from-yt-bg via-yt-bg/80 to-transparent">
          <ChevronRight className="w-4 h-4 text-yt-text-muted" />
        </button>
      )}
    </div>
  )
}

function TrailerRow({ videos }: { videos: { key: string; name: string; type: string; site: string }[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)
  const [active, setActive] = useState<{ key: string; name: string } | null>(null)

  const check = () => {
    const el = scrollRef.current; if (!el) return
    setCanLeft(el.scrollLeft > 4)
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4)
  }
  useEffect(() => {
    const el = scrollRef.current; if (!el) return
    check()
    el.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    return () => { el.removeEventListener('scroll', check); window.removeEventListener('resize', check) }
  })

  const shift = (dir: 'left' | 'right') =>
    scrollRef.current?.scrollBy({ left: dir === 'left' ? -300 : 300, behavior: 'smooth' })

  const ytVideos = videos.filter(v => v.site === 'YouTube').slice(0, 8)
  if (!ytVideos.length) return null

  return (
    <>
      <div className="mt-8">
        <h2 className="text-yt-text font-semibold text-base mb-3">Vidéos</h2>
        <div className="relative">
          {canLeft && (
            <button onClick={() => shift('left')} className="absolute left-0 top-0 bottom-0 z-10 w-10 flex items-center justify-center bg-gradient-to-r from-yt-bg via-yt-bg/80 to-transparent">
              <ChevronLeft className="w-5 h-5 text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]" />
            </button>
          )}
          <div ref={scrollRef} className="flex gap-3 overflow-x-auto scrollbar-none pb-1">
            {ytVideos.map(v => (
              <button
                key={v.key}
                onClick={() => setActive({ key: v.key, name: v.name })}
                className="flex-shrink-0 w-56 group text-left"
              >
                <div className="relative rounded-xl overflow-hidden aspect-video bg-yt-secondary mb-1.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`https://img.youtube.com/vi/${v.key}/mqdefault.jpg`} alt={v.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center group-hover:bg-yt-red transition-colors">
                      <Play className="w-4 h-4 text-white fill-white ml-0.5" />
                    </div>
                  </div>
                  <span className="absolute top-1.5 left-1.5 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded font-medium">{v.type}</span>
                </div>
                <p className="text-yt-text text-xs font-medium line-clamp-2 leading-tight">{v.name}</p>
              </button>
            ))}
          </div>
          {canRight && (
            <button onClick={() => shift('right')} className="absolute right-0 top-0 bottom-0 z-10 w-10 flex items-center justify-center bg-gradient-to-l from-yt-bg via-yt-bg/80 to-transparent">
              <ChevronRight className="w-5 h-5 text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]" />
            </button>
          )}
        </div>
      </div>

      {active && (
        <TrailerModal
          videoId={active.key}
          title={active.name}
          onClose={() => setActive(null)}
        />
      )}
    </>
  )
}

function SeriesRecoModal({ item, onClose }: { item: TmdbRecoItem; onClose: () => void }) {
  const title = item.title || item.name || ''
  const year = (item.release_date || item.first_air_date || '').substring(0, 4)
  const rating = item.vote_average ? item.vote_average.toFixed(1) : null
  const [match, setMatch] = useState<{ series_id?: number; cover?: string; name: string } | null | 'loading'>('loading')

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const query = year ? `${title} (${year})` : title
    fetch(`${API_BASE}/api/iptv/search_catalog?q=${encodeURIComponent(query)}&type=tv`)
      .then(r => r.ok ? r.json() : [])
      .then((results: { series_id?: number; cover?: string; name: string }[]) => setMatch(results[0] ?? null))
      .catch(() => setMatch(null))
  }, [title, year])

  const watchHref = match && match !== 'loading' && match.series_id
    ? `/tv/series/${match.series_id}?name=${encodeURIComponent(match.name)}&icon=${encodeURIComponent(match.cover || '')}`
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full sm:max-w-lg bg-yt-bg border border-yt-border rounded-t-2xl sm:rounded-2xl overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {item.backdrop_path && (
          <div className="relative w-full h-36 sm:h-48 flex-shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${API_BASE}/api/tmdb/image?path=/w780${item.backdrop_path}`} alt={title} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-yt-bg via-yt-bg/30 to-transparent" />
          </div>
        )}
        <button onClick={onClose} className="absolute top-3 right-3 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors">
          <X className="w-4 h-4" />
        </button>
        <div className="flex gap-3 p-4 flex-shrink-0">
          <div className="flex-shrink-0 w-20 aspect-[2/3] rounded-lg overflow-hidden bg-yt-secondary">
            {item.poster_path ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`${API_BASE}/api/tmdb/image?path=/w342${item.poster_path}`} alt={title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-yt-text-muted text-xs text-center px-1">{title}</div>
            )}
          </div>
          <div className="min-w-0">
            <h3 className="text-yt-text font-semibold text-base leading-tight">{title}</h3>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {year && <span className="text-yt-text-muted text-xs">{year}</span>}
              {rating && <span className="flex items-center gap-0.5 text-xs text-yellow-400"><Star className="w-3 h-3 fill-yellow-400" />{rating}</span>}
              <span className="text-yt-text-muted text-xs">Série</span>
            </div>
          </div>
        </div>
        {item.overview && (
          <div className="px-4 pb-4 overflow-y-auto flex-1">
            <p className="text-yt-text-muted text-sm leading-relaxed">{item.overview}</p>
          </div>
        )}
        <div className="px-4 pb-5 pt-2 flex-shrink-0 border-t border-yt-border/30">
          {match === 'loading' ? (
            <div className="w-full py-2.5 flex items-center justify-center gap-2 bg-yt-secondary rounded-xl">
              <div className="w-4 h-4 border-2 border-yt-text-muted border-t-transparent rounded-full animate-spin" />
              <span className="text-yt-text-muted text-sm">Vérification…</span>
            </div>
          ) : watchHref ? (
            <Link href={watchHref} onClick={onClose} className="w-full py-2.5 bg-yt-red hover:bg-yt-red-hover text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2">
              <Play className="w-4 h-4 fill-white" />
              Voir la série
            </Link>
          ) : (
            <div className="w-full py-2.5 bg-yt-secondary rounded-xl text-sm text-yt-text-muted flex items-center justify-center gap-2 cursor-not-allowed opacity-60">
              <Play className="w-4 h-4" />
              Non disponible dans votre bibliothèque
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function RecoRow({ items, onCardClick }: { items: TmdbRecoItem[]; onCardClick: (item: TmdbRecoItem) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const check = () => {
    const el = scrollRef.current; if (!el) return
    setCanLeft(el.scrollLeft > 4)
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4)
  }
  useEffect(() => {
    const el = scrollRef.current; if (!el) return
    check()
    el.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    return () => { el.removeEventListener('scroll', check); window.removeEventListener('resize', check) }
  })

  const shift = (dir: 'left' | 'right') =>
    scrollRef.current?.scrollBy({ left: dir === 'left' ? -320 : 320, behavior: 'smooth' })

  if (!items.length) return null
  return (
    <div className="mt-8">
      <h2 className="text-yt-text font-semibold text-base mb-3">Recommandations</h2>
      <div className="relative">
        {canLeft && (
          <button onClick={() => shift('left')} className="absolute left-0 top-0 bottom-0 z-10 w-10 flex items-center justify-center bg-gradient-to-r from-yt-bg via-yt-bg/80 to-transparent">
            <ChevronLeft className="w-6 h-6 text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]" />
          </button>
        )}
        <div ref={scrollRef} className="flex gap-4 overflow-x-auto scrollbar-none pb-2 px-1">
          {items.map(item => {
            const title = item.title || item.name || ''
            return (
              <Card3D key={item.id} className="flex-shrink-0 w-40 group cursor-pointer">
                <button onClick={() => onCardClick(item)} className="w-full text-left focus:outline-none">
                  <div className="relative rounded-xl overflow-hidden aspect-[2/3] bg-yt-secondary shadow-lg">
                    {item.poster_path ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`${API_BASE}/api/tmdb/image?path=/w342${item.poster_path}`} alt={title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-yt-text-muted text-xs text-center px-2">{title}</div>
                    )}
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="w-8 h-8 rounded-full bg-yt-red/90 flex items-center justify-center">
                        <Play className="w-4 h-4 text-white fill-white ml-0.5" />
                      </div>
                    </div>
                    {item.vote_average ? (
                      <span className="absolute top-1.5 right-1.5 bg-black/75 text-yellow-400 text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                        <Star className="w-2.5 h-2.5 fill-current" />{item.vote_average.toFixed(1)}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-yt-text-muted text-[11px] line-clamp-2 leading-tight mt-1.5 px-0.5">{title}</p>
                </button>
              </Card3D>
            )
          })}
        </div>
        {canRight && (
          <button onClick={() => shift('right')} className="absolute right-0 top-0 bottom-0 z-10 w-10 flex items-center justify-center bg-gradient-to-l from-yt-bg via-yt-bg/80 to-transparent">
            <ChevronRight className="w-6 h-6 text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]" />
          </button>
        )}
      </div>
    </div>
  )
}

export default function TvSeriesPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { t } = useRegion()
  const seriesId = params.id as string
  const name = searchParams.get('name') || 'Series'
  const icon = searchParams.get('icon') || ''

  const [data, setData] = useState<SeriesInfo | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [tmdb, setTmdb] = useState<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [tmdbSeason, setTmdbSeason] = useState<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [videos, setVideos] = useState<any[]>([])
  const [recos, setRecos] = useState<TmdbRecoItem[]>([])
  const [recoModal, setRecoModal] = useState<TmdbRecoItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null)
  const [fav, setFav] = useState(false)
  const [continueItem, setContinueItem] = useState<ContinueItem | null>(null)
  const [continueMap, setContinueMap] = useState<Record<string, { position: number; duration: number }>>({})
  const [imgErr, setImgErr] = useState(false)

  useEffect(() => { setFav(isTvFavorite(seriesId, 'series')) }, [seriesId])

  useEffect(() => {
    const refresh = () => {
      const all = getContinueWatching()
      setContinueItem(all.find(c => c.seriesId === seriesId) ?? null)
      const map: Record<string, { position: number; duration: number }> = {}
      all.filter(c => c.seriesId === seriesId).forEach(c => { map[c.id] = { position: c.position, duration: c.duration } })
      setContinueMap(map)
    }
    refresh()
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [seriesId])

  function toggleFav() {
    const next = toggleTvFavorite({ id: seriesId, type: 'series', name, icon })
    setFav(next)
    window.dispatchEvent(new Event('focus'))
  }

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/api/iptv/series_info/${seriesId}`)
        .then(r => { if (!r.ok) throw new Error(); return r.json() })
        .catch(() => null),
      fetch(`${API_BASE}/api/tmdb/details?name=${encodeURIComponent(name)}&type=tv`)
        .then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([iptvData, tmdbData]) => {
      if (!iptvData) { setError(t('iptv_error')); return }
      setData(iptvData)
      setTmdb(tmdbData)
      const seasons = Object.keys(iptvData.episodes || {}).sort((a, b) => Number(a) - Number(b))
      if (seasons.length > 0) setSelectedSeason(seasons[0])
      if (tmdbData) {
        Promise.all([
          fetch(`${API_BASE}/api/tmdb/videos?name=${encodeURIComponent(name)}&type=tv`)
            .then(r => r.ok ? r.json() : null).catch(() => null),
          fetch(`${API_BASE}/api/tmdb/recommendations?name=${encodeURIComponent(name)}&type=tv`)
            .then(r => r.ok ? r.json() : null).catch(() => null),
        ]).then(([vids, recs]) => {
          setVideos(vids?.results ?? [])
          setRecos(recs?.results ?? [])
        })
      }
    }).catch(() => setError(t('iptv_error')))
      .finally(() => setLoading(false))
  }, [seriesId, name, t])

  useEffect(() => {
    if (!selectedSeason || !tmdb) return
    setTmdbSeason(null)
    fetch(`${API_BASE}/api/tmdb/tv_season?name=${encodeURIComponent(name)}&season=${selectedSeason}`)
      .then(r => r.ok ? r.json() : null).catch(() => null)
      .then(d => setTmdbSeason(d))
  }, [selectedSeason, tmdb, name])

  const seasons = data ? Object.keys(data.episodes || {}).sort((a, b) => Number(a) - Number(b)) : []
  const episodes = selectedSeason && data
    ? (data.episodes[selectedSeason] || []).slice().sort((a, b) => a.episode_num - b.episode_num)
    : []

  const title = tmdb?.name || data?.info.name || name
  const overview = tmdb?.overview || data?.info.plot || ''
  const genreList: string[] = tmdb?.genres?.map((g: { name: string }) => g.name) || (data?.info.genre ? [data.info.genre] : [])
  const year = (tmdb?.first_air_date || data?.info.releaseDate || '').substring(0, 4)
  const rating = tmdb?.vote_average ? tmdb.vote_average.toFixed(1) : data?.info.rating || ''

  const backdropSrc = tmdb?.backdrop_path
    ? `${API_BASE}/api/tmdb/image?path=/original${tmdb.backdrop_path}`
    : (icon || data?.info.cover || null)

  const firstSeason = seasons[0]
  const firstEp = firstSeason && data
    ? [...(data.episodes[firstSeason] || [])].sort((a, b) => a.episode_num - b.episode_num)[0]
    : null
  const firstEpName = firstEp
    ? `${name} — ${t('iptv_episode_short')}${firstEp.episode_num}${firstEp.title && firstEp.title !== String(firstEp.episode_num) ? ` — ${firstEp.title}` : ''}`
    : ''
  const firstHref = firstEp
    ? `/tv/watch/${firstEp.id}?type=vod&media=series&ext=${firstEp.container_extension || 'mp4'}&name=${encodeURIComponent(firstEpName)}&icon=${encodeURIComponent(icon || data?.info.cover || '')}&series_id=${seriesId}&season=${firstSeason}&series_name=${encodeURIComponent(name)}&series_icon=${encodeURIComponent(icon || data?.info.cover || '')}`
    : ''

  const continueEpNum = continueItem?.name.match(/[ÉEe]p[.\s]*(\d+)/i)?.[1]

  const continuePct = continueItem && continueItem.duration > 0
    ? Math.min(99, Math.round((continueItem.position / continueItem.duration) * 100))
    : 0
  const resumeHref = continueItem && data
    ? `/tv/watch/${continueItem.id}?type=vod&ext=${continueItem.ext}&media=${continueItem.media}&name=${encodeURIComponent(continueItem.name)}&icon=${encodeURIComponent(continueItem.icon)}&series_id=${seriesId}&season=${continueItem.season || ''}&series_name=${encodeURIComponent(name)}&series_icon=${encodeURIComponent(icon || data.info.cover || '')}`
    : ''

  return (
    <div className="min-h-screen bg-yt-bg">
      {/* Hero backdrop — full width */}
      <div className="relative h-[60vh] min-h-[340px] overflow-hidden bg-yt-secondary">
        {backdropSrc && !loading && !imgErr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={backdropSrc.startsWith('http') && !backdropSrc.includes(API_BASE)
              ? `${API_BASE}/api/iptv/icon?url=${encodeURIComponent(backdropSrc)}`
              : backdropSrc}
            alt=""
            className="absolute inset-0 w-full h-full object-cover object-top"
            onError={() => setImgErr(true)}
          />
        ) : null}

        <div className="absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-yt-bg via-yt-bg/70 to-transparent pointer-events-none" />
        <div className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-black/25 to-transparent pointer-events-none" />

        <button
          onClick={() => router.back()}
          className="absolute top-4 left-4 z-20 p-2 rounded-full bg-black/40 hover:bg-black/65 text-white transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        {!loading && !error && data && (
          <div className="absolute bottom-0 left-0 right-0 z-10 flex flex-col items-center text-center px-6 pb-8">
            <h1 className="text-white text-2xl md:text-4xl font-bold leading-tight mb-2 drop-shadow-lg">{title}</h1>
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-white/75 text-sm mb-5">
              {year && <span>{year}</span>}
              {seasons.length > 0 && (
                <><span className="opacity-40">·</span><span>{seasons.length} saison{seasons.length > 1 ? 's' : ''}</span></>
              )}
              {rating && (
                <span className="flex items-center gap-1 text-yellow-400 font-semibold">
                  <Star className="w-3.5 h-3.5 fill-current" />{rating}
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 flex-wrap justify-center">
              <button
                onClick={toggleFav}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors backdrop-blur-sm border ${
                  fav ? 'bg-yt-red/20 border-yt-red/60 text-yt-red' : 'bg-black/30 border-white/25 text-white hover:bg-black/50'
                }`}
              >
                {fav ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                Ma liste
              </button>

              {continueItem ? (
                <Link
                  href={resumeHref}
                  className="flex items-center gap-2 px-7 py-2.5 bg-yt-red hover:bg-yt-red-hover text-white rounded-xl font-semibold text-sm transition-colors shadow-xl"
                >
                  <Clock className="w-4 h-4" />
                  Continuer
                  {continueItem.season && <span className="opacity-75">· S{String(continueItem.season).padStart(2, '0')}</span>}
                  {continueEpNum && <span className="opacity-75">· Ép.{continueEpNum}</span>}
                </Link>
              ) : firstHref ? (
                <Link
                  href={firstHref}
                  className="flex items-center gap-2 px-7 py-2.5 bg-yt-red hover:bg-yt-red-hover text-white rounded-xl font-semibold text-sm transition-colors shadow-xl"
                >
                  <Play className="w-4 h-4 fill-white" />
                  Regarder
                </Link>
              ) : null}
            </div>

            {continuePct > 0 && (
              <div className="mt-3 h-1 bg-white/20 rounded-full overflow-hidden w-40">
                <div className="h-full bg-yt-red rounded-full" style={{ width: `${continuePct}%` }} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Content — full width */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-yt-red border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="text-center py-16"><p className="text-yt-text-muted">{error}</p></div>
      ) : data ? (
        <div className="px-5 md:px-8 pb-16">
          {overview && (
            <div className="mt-6">
              <h2 className="text-yt-text font-semibold text-lg mb-3">Aperçu</h2>
              <p className="text-yt-text text-base leading-loose">{overview}</p>
            </div>
          )}

          {genreList.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {genreList.map(g => (
                <span key={g} className="px-3 py-1 rounded-full bg-yt-secondary text-yt-text-muted text-xs font-medium border border-yt-border/40">{g}</span>
              ))}
            </div>
          )}

          {/* Trailers & Videos */}
          <TrailerRow videos={videos} />

          {/* Season tabs + episodes */}
          <div className="mt-8">
            <SeasonTabs seasons={seasons} selected={selectedSeason} onSelect={setSelectedSeason} label={t('iptv_season')} />

            <div className="flex flex-col gap-3">
              {episodes.map(ep => {
                const epName = `${name} — ${t('iptv_episode_short')}${ep.episode_num}${ep.title && ep.title !== String(ep.episode_num) ? ` — ${ep.title}` : ''}`
                const href = `/tv/watch/${ep.id}?type=vod&media=series&ext=${ep.container_extension || 'mp4'}&name=${encodeURIComponent(epName)}&icon=${encodeURIComponent(icon || data.info.cover || '')}&series_id=${seriesId}&season=${selectedSeason}&series_name=${encodeURIComponent(name)}&series_icon=${encodeURIComponent(icon || data.info.cover || '')}`

                const tmdbEp = tmdbSeason?.episodes?.find((e: { episode_number: number }) => e.episode_number === ep.episode_num)
                const stillPath = tmdbEp?.still_path
                const epPlot = tmdbEp?.overview || ep.info?.plot || ''

                return (
                  <Link
                    key={ep.id}
                    href={href}
                    className="flex gap-3 p-3 rounded-xl bg-yt-secondary hover:bg-yt-hover transition-colors border border-yt-border/30 group"
                  >
                    <div className="flex-shrink-0 w-36 aspect-video rounded-lg overflow-hidden bg-yt-hover relative">
                      {stillPath ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`${API_BASE}/api/tmdb/image?path=/w300${stillPath}`} alt={ep.title} className="w-full h-full object-cover" />
                      ) : ep.info?.movie_image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`${API_BASE}/api/iptv/icon?url=${encodeURIComponent(ep.info.movie_image)}`} alt={ep.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Play className="w-6 h-6 text-yt-text-muted" />
                        </div>
                      )}
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                        <div className="w-8 h-8 rounded-full bg-yt-red flex items-center justify-center">
                          <Play className="w-4 h-4 text-white fill-white ml-0.5" />
                        </div>
                      </div>
                      {continueMap[ep.id] && continueMap[ep.id].duration > 0 && (
                        <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                          <div
                            className="h-full bg-yt-red"
                            style={{ width: `${Math.min(99, Math.round((continueMap[ep.id].position / continueMap[ep.id].duration) * 100))}%` }}
                          />
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0 py-0.5">
                      <p className="text-yt-text text-sm font-medium mb-0.5">
                        {t('iptv_episode_short')}{ep.episode_num}
                        {ep.title && ep.title !== String(ep.episode_num) ? ` — ${ep.title}` : ''}
                      </p>
                      {ep.info?.duration && <p className="text-yt-text-muted text-xs mb-1">{ep.info.duration}</p>}
                      {epPlot && <p className="text-yt-text-muted text-xs leading-relaxed line-clamp-2">{epPlot}</p>}
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>

          {/* Cast */}
          {tmdb?.credits?.cast?.length > 0 && (
            <div className="mt-8">
              <h2 className="text-yt-text font-semibold text-base mb-3">Distribution</h2>
              <div className="flex gap-4 overflow-x-auto scrollbar-none pb-2">
                {tmdb.credits.cast.slice(0, 14).map((actor: { id: number; name: string; character: string; profile_path: string | null }) => (
                  <div key={actor.id} className="flex-shrink-0 w-20 text-center">
                    <div className="w-20 h-20 rounded-full overflow-hidden bg-yt-secondary mx-auto mb-1.5">
                      {actor.profile_path ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`${API_BASE}/api/tmdb/image?path=/w185${actor.profile_path}`} alt={actor.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-yt-text-muted text-xl font-bold">{actor.name[0]}</div>
                      )}
                    </div>
                    <p className="text-yt-text text-[11px] font-medium line-clamp-2 leading-tight">{actor.name}</p>
                    <p className="text-yt-text-muted text-[10px] line-clamp-1 mt-0.5">{actor.character}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          <RecoRow items={recos} onCardClick={setRecoModal} />
          {recoModal && <SeriesRecoModal item={recoModal} onClose={() => setRecoModal(null)} />}
        </div>
      ) : null}
    </div>
  )
}
