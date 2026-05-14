'use client'

import { useState, useEffect } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Play, Star, Film, Clock } from 'lucide-react'
import { useRegion } from '@/lib/regionContext'
import { getContinueWatching, removeContinue, type ContinueItem } from '@/lib/tvContinueWatching'
import { toggleTvFavorite, isTvFavorite } from '@/lib/tvFavorites'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`
}

function FilmPoster({ src, name }: { src: string; name: string }) {
  const [err, setErr] = useState(false)
  const tmdbUrl = `${API_BASE}/api/tmdb/poster?name=${encodeURIComponent(name)}&type=movie`
  if (src && !err) {
    return <img src={src} alt={name} className="w-full h-full object-cover" onError={() => setErr(true)} />
  }
  return <img src={tmdbUrl} alt={name} className="w-full h-full object-cover"
    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
}

export default function TvFilmPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { t } = useRegion()

  const id = params.id as string
  const name = searchParams.get('name') || ''
  const icon = searchParams.get('icon') || ''
  const ext = searchParams.get('ext') || 'mp4'
  const cat = searchParams.get('cat') || ''

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [vodInfo, setVodInfo] = useState<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [tmdb, setTmdb] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [continueItem, setContinueItem] = useState<ContinueItem | null>(null)
  const [fav, setFav] = useState(false)

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
    }).finally(() => setLoading(false))
  }, [id, name])

  const info = vodInfo?.info ?? {}

  // Combine data — TMDB priority for most fields, IPTV as fallback
  const title = tmdb?.title || info.name || name
  const overview = tmdb?.overview || info.description || ''
  const genres = tmdb?.genres?.map((g: {name: string}) => g.name).join(' · ') || info.genre || ''
  const year = (tmdb?.release_date || info.releaseDate || '').substring(0, 4)
  const runtimeMin = tmdb?.runtime
  const runtime = runtimeMin ? `${Math.floor(runtimeMin / 60)}h${String(runtimeMin % 60).padStart(2, '0')}` : ''
  const rating = tmdb?.vote_average ? tmdb.vote_average.toFixed(1) : info.rating || ''
  const cast = tmdb?.credits?.cast?.slice(0, 8).map((a: {name: string}) => a.name).join(', ')
    || info.cast || info.actors || ''
  const director = tmdb?.credits?.crew?.find((c: {job: string; name: string}) => c.job === 'Director')?.name
    || info.director || ''

  // Poster: prefer proxied TMDB, then IPTV cover_big, then icon param
  const posterSrc = tmdb?.poster_path
    ? `${API_BASE}/api/tmdb/image?path=/w500${tmdb.poster_path}`
    : (info.cover_big || icon)

  // Backdrop from TMDB or IPTV
  const backdropSrc = tmdb?.backdrop_path
    ? `${API_BASE}/api/tmdb/image?path=/w1280${tmdb.backdrop_path}`
    : (Array.isArray(info.backdrop_path) ? info.backdrop_path[0] : null)

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
      {/* Backdrop */}
      {backdropSrc && !loading && (
        <div className="relative h-44 md:h-64 overflow-hidden pointer-events-none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={backdropSrc} alt="" className="w-full h-full object-cover opacity-25" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-yt-bg/60 to-yt-bg" />
        </div>
      )}

      {/* Header */}
      <div className={`flex items-center gap-2 px-4 py-3 ${backdropSrc && !loading ? '-mt-12 relative z-10' : ''}`}>
        <button onClick={() => router.back()}
          className="p-2 rounded-full hover:bg-yt-hover text-yt-text transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1" />
        <button onClick={toggleFav}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors border ${fav ? 'bg-yt-red/10 border-yt-red text-yt-red' : 'border-yt-border text-yt-text-muted hover:text-yt-text'}`}>
          <Star className={`w-4 h-4 ${fav ? 'fill-current' : ''}`} />
          {fav ? 'Favori' : 'Ajouter'}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-2 border-yt-red border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="px-4 pb-16 max-w-3xl mx-auto">
          <div className="flex gap-5">
            {/* Poster */}
            <div className="flex-shrink-0 w-32 md:w-44 rounded-2xl overflow-hidden shadow-2xl bg-yt-secondary">
              <div className="aspect-[2/3] relative">
                <FilmPoster src={posterSrc} name={title} />
              </div>
            </div>

            {/* Metadata */}
            <div className="flex-1 min-w-0 pt-1">
              <h1 className="text-yt-text text-lg md:text-2xl font-bold leading-tight mb-2">{title}</h1>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-yt-text-muted text-xs mb-3">
                {year && <span>{year}</span>}
                {runtime && <><span className="opacity-40">·</span><span>{runtime}</span></>}
                {genres && <><span className="opacity-40">·</span><span className="line-clamp-1">{genres}</span></>}
                {rating && (
                  <span className="flex items-center gap-0.5 text-yellow-400 font-semibold">
                    <Star className="w-3 h-3 fill-current" />
                    {rating}
                  </span>
                )}
              </div>

              {/* Synopsis — hidden on mobile (shown below) */}
              {overview && (
                <p className="hidden md:block text-yt-text-muted text-sm leading-relaxed line-clamp-4 mb-3">{overview}</p>
              )}

              {director && (
                <p className="text-xs text-yt-text-muted mb-1">
                  <span className="text-yt-text font-medium">Réalisateur : </span>{director}
                </p>
              )}
              {cast && (
                <p className="text-xs text-yt-text-muted mb-3 line-clamp-2">
                  <span className="text-yt-text font-medium">Avec : </span>{cast}
                </p>
              )}

              {/* Watch button — desktop */}
              <div className="hidden md:block mt-2">
                <WatchButton href={watchHref} continueItem={continueItem} pct={pct} streamId={id} />
              </div>
            </div>
          </div>

          {/* Synopsis — mobile */}
          {overview && (
            <p className="md:hidden mt-5 text-yt-text-muted text-sm leading-relaxed">{overview}</p>
          )}

          {/* Watch button — mobile */}
          <div className="md:hidden mt-5">
            <WatchButton href={watchHref} continueItem={continueItem} pct={pct} streamId={id} />
          </div>

          {/* Cast cards (TMDB only) */}
          {tmdb?.credits?.cast?.length > 0 && (
            <div className="mt-8">
              <h2 className="text-yt-text font-semibold text-sm mb-3">Distribution</h2>
              <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
                {tmdb.credits.cast.slice(0, 12).map((actor: {id: number; name: string; character: string; profile_path: string | null}) => (
                  <div key={actor.id} className="flex-shrink-0 w-20 text-center">
                    <div className="w-20 h-20 rounded-full overflow-hidden bg-yt-secondary mx-auto mb-1">
                      {actor.profile_path ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`${API_BASE}/api/tmdb/image?path=/w185${actor.profile_path}`}
                          alt={actor.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-yt-text-muted text-2xl font-bold">
                          {actor.name[0]}
                        </div>
                      )}
                    </div>
                    <p className="text-yt-text text-[10px] font-medium line-clamp-2 leading-tight">{actor.name}</p>
                    <p className="text-yt-text-muted text-[10px] line-clamp-1">{actor.character}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function WatchButton({ href, continueItem, pct, streamId }: { href: string; continueItem: ContinueItem | null; pct: number; streamId: string }) {
  const router = useRouter()

  if (!continueItem) {
    return (
      <Link href={href}
        className="flex items-center justify-center gap-2 w-full py-3 bg-yt-red hover:bg-yt-red-hover text-white rounded-2xl font-semibold text-sm transition-colors shadow-lg">
        <Play className="w-4 h-4 fill-white" />
        Regarder
      </Link>
    )
  }

  return (
    <div className="space-y-2">
      {/* Progress bar */}
      {pct > 0 && (
        <div className="h-1 bg-yt-secondary rounded-full overflow-hidden">
          <div className="h-full bg-yt-red rounded-full" style={{ width: `${pct}%` }} />
        </div>
      )}
      {/* Resume button */}
      <Link href={href}
        className="flex items-center justify-center gap-2 w-full py-3 bg-yt-red hover:bg-yt-red-hover text-white rounded-2xl font-semibold text-sm transition-colors shadow-lg">
        <Play className="w-4 h-4 fill-white" />
        Continuer · {fmtTime(continueItem.position)}{pct > 0 ? ` (${pct}%)` : ''}
      </Link>
      {/* Restart button */}
      <button
        onClick={() => { removeContinue(streamId); router.push(href) }}
        className="flex items-center justify-center gap-2 w-full py-2.5 bg-yt-secondary hover:bg-yt-hover border border-yt-border text-yt-text rounded-2xl text-sm transition-colors"
      >
        <Clock className="w-4 h-4" />
        Reprendre depuis le début
      </button>
    </div>
  )
}
