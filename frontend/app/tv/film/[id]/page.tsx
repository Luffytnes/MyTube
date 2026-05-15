'use client'

import { useState, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Play, Plus, Check, Star, Clock, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { getContinueWatching, removeContinue, type ContinueItem } from '@/lib/tvContinueWatching'
import { toggleTvFavorite, isTvFavorite } from '@/lib/tvFavorites'
import TrailerModal from '@/components/tv/TrailerModal'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`
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

function RecoModal({ item, onClose }: { item: TmdbRecoItem; onClose: () => void }) {
  const title = item.title || item.name || ''
  const year = (item.release_date || item.first_air_date || '').substring(0, 4)
  const rating = item.vote_average ? item.vote_average.toFixed(1) : null
  const [match, setMatch] = useState<{ stream_id?: number; stream_icon?: string; container_extension?: string; name: string } | null | 'loading'>('loading')

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const query = year ? `${title} (${year})` : title
    fetch(`${API_BASE}/api/iptv/search_catalog?q=${encodeURIComponent(query)}&type=movie`)
      .then(r => r.ok ? r.json() : [])
      .then((results: { stream_id?: number; stream_icon?: string; container_extension?: string; name: string }[]) => setMatch(results[0] ?? null))
      .catch(() => setMatch(null))
  }, [title, year])

  const watchHref = match && match !== 'loading' && match.stream_id
    ? `/tv/film/${match.stream_id}?ext=${match.container_extension || 'mp4'}&name=${encodeURIComponent(match.name)}&icon=${encodeURIComponent(match.stream_icon || '')}`
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
              <span className="text-yt-text-muted text-xs">Film</span>
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
              Voir le film
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
              <Card3D key={item.id} className="flex-shrink-0 w-40 group cursor-pointer" >
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

export default function TvFilmPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()

  const id = params.id as string
  const name = searchParams.get('name') || ''
  const icon = searchParams.get('icon') || ''
  const ext = searchParams.get('ext') || 'mp4'
  const cat = searchParams.get('cat') || ''

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [vodInfo, setVodInfo] = useState<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [tmdb, setTmdb] = useState<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [videos, setVideos] = useState<any[]>([])
  const [recos, setRecos] = useState<TmdbRecoItem[]>([])
  const [recoModal, setRecoModal] = useState<TmdbRecoItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [continueItem, setContinueItem] = useState<ContinueItem | null>(null)
  const [fav, setFav] = useState(false)
  const [imgErr, setImgErr] = useState(false)

  useEffect(() => {
    setFav(isTvFavorite(id, 'vod'))
    const refresh = () => setContinueItem(getContinueWatching().find(c => c.id === id) ?? null)
    refresh()
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [id])

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`${API_BASE}/api/iptv/vod_info/${id}`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${API_BASE}/api/tmdb/details?name=${encodeURIComponent(name)}&type=movie`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([info, tmdbData]) => {
      setVodInfo(info)
      setTmdb(tmdbData)
      if (tmdbData) {
        Promise.all([
          fetch(`${API_BASE}/api/tmdb/videos?name=${encodeURIComponent(name)}&type=movie`).then(r => r.ok ? r.json() : null).catch(() => null),
          fetch(`${API_BASE}/api/tmdb/recommendations?name=${encodeURIComponent(name)}&type=movie`).then(r => r.ok ? r.json() : null).catch(() => null),
        ]).then(([vids, recs]) => {
          setVideos(vids?.results ?? [])
          setRecos(recs?.results ?? [])
        })
      }
    }).finally(() => setLoading(false))
  }, [id, name])

  const info = vodInfo?.info ?? {}
  const title = tmdb?.title || info.name || name
  const overview = tmdb?.overview || info.description || ''
  const genreList: string[] = tmdb?.genres?.map((g: { name: string }) => g.name) || (info.genre ? [info.genre] : [])
  const year = (tmdb?.release_date || info.releaseDate || '').substring(0, 4)
  const runtimeMin = tmdb?.runtime
  const runtime = runtimeMin ? `${Math.floor(runtimeMin / 60)}h${String(runtimeMin % 60).padStart(2, '0')}` : ''
  const rating = tmdb?.vote_average ? tmdb.vote_average.toFixed(1) : info.rating || ''

  const backdropSrc = tmdb?.backdrop_path
    ? `${API_BASE}/api/tmdb/image?path=/original${tmdb.backdrop_path}`
    : (Array.isArray(info.backdrop_path) ? info.backdrop_path[0] : null)

  const posterSrc = tmdb?.poster_path
    ? `${API_BASE}/api/tmdb/image?path=/w500${tmdb.poster_path}`
    : (info.cover_big || icon)

  const watchHref = `/tv/watch/${id}?type=vod&ext=${ext}&media=movie&name=${encodeURIComponent(name)}&icon=${encodeURIComponent(icon)}&cat=${encodeURIComponent(cat)}`

  const pct = continueItem && continueItem.duration > 0 && isFinite(continueItem.duration)
    ? Math.min(99, Math.round((continueItem.position / continueItem.duration) * 100))
    : 0

  function toggleFav() {
    const next = toggleTvFavorite({ id, type: 'vod', name, icon, ext, media: 'movie' })
    setFav(next)
    window.dispatchEvent(new Event('focus'))
  }

  return (
    <div className="min-h-screen bg-yt-bg">
      {/* Hero backdrop — full viewport width, tall */}
      <div className="relative h-[62vh] min-h-[360px] overflow-hidden bg-yt-secondary">
        {(backdropSrc || posterSrc) && !loading && !imgErr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={backdropSrc || posterSrc}
            alt=""
            className="absolute inset-0 w-full h-full object-cover object-top"
            onError={() => setImgErr(true)}
          />
        ) : null}

        {/* Gradient: only bottom half darkens — top stays visible */}
        <div className="absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-yt-bg via-yt-bg/70 to-transparent pointer-events-none" />
        <div className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-black/30 to-transparent pointer-events-none" />

        {/* Back button */}
        <button
          onClick={() => router.back()}
          className="absolute top-4 left-4 z-20 p-2 rounded-full bg-black/40 hover:bg-black/65 text-white transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        {/* Hero bottom content — centered */}
        {!loading && (
          <div className="absolute bottom-0 left-0 right-0 z-10 flex flex-col items-center text-center px-6 pb-8">
            <h1 className="text-white text-2xl md:text-4xl font-bold leading-tight mb-2 drop-shadow-lg">{title}</h1>
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-white/75 text-sm mb-5">
              {year && <span>{year}</span>}
              {runtime && <><span className="opacity-40">·</span><span>{runtime}</span></>}
              {rating && (
                <span className="flex items-center gap-1 text-yellow-400 font-semibold">
                  <Star className="w-3.5 h-3.5 fill-current" />{rating}
                </span>
              )}
            </div>

            {/* Buttons: Ma liste  |  Regarder/Continuer  [Début] */}
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
                <>
                  <Link
                    href={watchHref}
                    className="flex items-center gap-2 px-7 py-2.5 bg-yt-red hover:bg-yt-red-hover text-white rounded-xl font-semibold text-sm transition-colors shadow-xl"
                  >
                    <Play className="w-4 h-4 fill-white" />
                    Continuer · {fmtTime(continueItem.position)}
                    {pct > 0 && <span className="opacity-75">({pct}%)</span>}
                  </Link>
                  <button
                    onClick={() => { removeContinue(id); router.push(watchHref) }}
                    className="flex items-center gap-2 px-4 py-2.5 bg-black/30 hover:bg-black/50 border border-white/25 text-white rounded-xl text-sm transition-colors backdrop-blur-sm"
                  >
                    <Clock className="w-4 h-4" />
                    Début
                  </button>
                </>
              ) : (
                <Link
                  href={watchHref}
                  className="flex items-center gap-2 px-7 py-2.5 bg-yt-red hover:bg-yt-red-hover text-white rounded-xl font-semibold text-sm transition-colors shadow-xl"
                >
                  <Play className="w-4 h-4 fill-white" />
                  Regarder
                </Link>
              )}
            </div>

            {pct > 0 && (
              <div className="mt-3 h-1 bg-white/20 rounded-full overflow-hidden w-40">
                <div className="h-full bg-yt-red rounded-full" style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Page content — full width */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-yt-red border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="px-5 md:px-8 pb-16">
          {overview && (
            <div className="mt-6">
              <h2 className="text-yt-text font-semibold text-lg mb-3">Synopsis</h2>
              <p className="text-yt-text text-base leading-loose">{overview}</p>
            </div>
          )}

          {genreList.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {genreList.map(g => (
                <span key={g} className="px-3 py-1 rounded-full bg-yt-secondary text-yt-text-muted text-xs font-medium border border-yt-border/40">{g}</span>
              ))}
            </div>
          )}

          <TrailerRow videos={videos} />

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

          <RecoRow items={recos} onCardClick={setRecoModal} />
          {recoModal && <RecoModal item={recoModal} onClose={() => setRecoModal(null)} />}
        </div>
      )}
    </div>
  )
}
