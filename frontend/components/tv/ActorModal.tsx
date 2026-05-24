'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { X, Play, Star, Loader2, ChevronLeft, ChevronRight, Film, Layers } from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

interface CreditItem {
  id: number
  media_type: 'movie' | 'tv'
  title: string | null
  poster_path: string | null
  vote_average: number | null
  release_date: string | null
  character: string | null
}

interface LibraryMatch {
  stream_id?: number
  series_id?: number
  container_extension?: string
  stream_icon?: string
  cover?: string
  name: string
}

interface Props {
  actorId: number
  actorName: string
  actorImage: string | null
  onClose: () => void
}

function ScrollRow({ items, kind }: { items: CreditItem[]; kind: 'movie' | 'tv' }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const check = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanLeft(el.scrollLeft > 4)
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    check()
    el.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    return () => {
      el.removeEventListener('scroll', check)
      window.removeEventListener('resize', check)
    }
  }, [check, items])

  const shift = (dir: 'left' | 'right') =>
    scrollRef.current?.scrollBy({ left: dir === 'left' ? -320 : 320, behavior: 'smooth' })

  if (!items.length) return null

  return (
    <div className="relative">
      {canLeft && (
        <button
          onClick={() => shift('left')}
          className="absolute left-0 top-0 bottom-0 z-10 w-10 flex items-center justify-center bg-gradient-to-r from-yt-bg via-yt-bg/80 to-transparent rounded-l-xl"
        >
          <ChevronLeft className="w-6 h-6 text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]" />
        </button>
      )}
      <div ref={scrollRef} className="flex gap-3 overflow-x-auto scrollbar-none pb-2">
        {items.map(item => (
          <CreditCard key={item.id} item={item} kind={kind} />
        ))}
      </div>
      {canRight && (
        <button
          onClick={() => shift('right')}
          className="absolute right-0 top-0 bottom-0 z-10 w-10 flex items-center justify-center bg-gradient-to-l from-yt-bg via-yt-bg/80 to-transparent rounded-r-xl"
        >
          <ChevronRight className="w-6 h-6 text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]" />
        </button>
      )}
    </div>
  )
}

function CreditCard({ item, kind }: { item: CreditItem; kind: 'movie' | 'tv' }) {
  const [match, setMatch] = useState<LibraryMatch | null | 'loading'>('loading')

  useEffect(() => {
    const year = item.release_date?.substring(0, 4)
    const q = year ? `${item.title} (${year})` : item.title || ''
    const type = kind === 'tv' ? 'tv' : 'movie'
    fetch(`${API_BASE}/api/iptv/search_catalog?q=${encodeURIComponent(q)}&type=${type}`)
      .then(r => r.ok ? r.json() : [])
      .then((results: LibraryMatch[]) => setMatch(results[0] ?? null))
      .catch(() => setMatch(null))
  }, [item, kind])

  const year = item.release_date?.substring(0, 4)
  const isMovie = kind === 'movie'

  const href = match && match !== 'loading'
    ? isMovie && match.stream_id
      ? `/tv/film/${match.stream_id}?ext=${match.container_extension || 'mp4'}&name=${encodeURIComponent(match.name)}&icon=${encodeURIComponent(match.stream_icon || '')}`
      : !isMovie && match.series_id
        ? `/tv/series/${match.series_id}?name=${encodeURIComponent(match.name)}&icon=${encodeURIComponent(match.cover || '')}`
        : null
    : null

  const available = match !== 'loading' && href !== null

  const card = (
    <div className={`relative rounded-xl overflow-hidden aspect-[2/3] bg-yt-secondary shadow-md w-32 flex-shrink-0 ${available ? 'group-hover:ring-2 group-hover:ring-white/60 transition-all' : ''} ${!available && match !== 'loading' ? 'opacity-50' : ''}`}>
      {item.poster_path ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`${API_BASE}/api/tmdb/image?path=/w342${item.poster_path}`}
          alt={item.title || ''}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-yt-text-muted text-xs text-center px-2">
          {isMovie ? <Film className="w-8 h-8" /> : <Layers className="w-8 h-8" />}
        </div>
      )}

      {/* Overlay: loading indicator or play button */}
      {match === 'loading' && (
        <div className="absolute inset-0 flex items-end justify-end p-1.5">
          <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {available && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-9 h-9 rounded-full bg-white/90 flex items-center justify-center">
            <Play className="w-4 h-4 text-black fill-black ml-0.5" />
          </div>
        </div>
      )}

      {/* Rating badge */}
      {item.vote_average && item.vote_average > 0 ? (
        <span className="absolute top-1.5 right-1.5 bg-black/75 text-yellow-400 text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
          <Star className="w-2.5 h-2.5 fill-current" />{item.vote_average.toFixed(1)}
        </span>
      ) : null}

      {/* Library badge */}
      {available && (
        <span className="absolute bottom-1.5 left-1.5 bg-yt-red text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
          Dispo
        </span>
      )}
    </div>
  )

  return (
    <div className="flex-shrink-0 w-32 group">
      {href ? (
        <Link href={href} className="block focus:outline-none">{card}</Link>
      ) : (
        <div className="cursor-default">{card}</div>
      )}
      <p className="text-yt-text text-[11px] font-medium line-clamp-2 leading-tight mt-1.5 px-0.5">{item.title}</p>
      {year && <p className="text-yt-text-muted text-[10px] px-0.5">{year}</p>}
    </div>
  )
}

export default function ActorModal({ actorId, actorName, actorImage, onClose }: Props) {
  const [credits, setCredits] = useState<CreditItem[] | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    fetch(`${API_BASE}/api/tmdb/person_credits?person_id=${actorId}`)
      .then(r => r.ok ? r.json() : { cast: [] })
      .then(d => setCredits(d.cast ?? []))
      .catch(() => setCredits([]))
  }, [actorId])

  const movies = credits?.filter(c => c.media_type === 'movie') ?? []
  const shows = credits?.filter(c => c.media_type === 'tv') ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/75 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-full sm:max-w-2xl lg:max-w-3xl bg-yt-bg border border-yt-border rounded-t-2xl sm:rounded-2xl overflow-hidden max-h-[90vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-4 px-5 py-4 border-b border-yt-border/40 flex-shrink-0">
          {actorImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`${API_BASE}/api/tmdb/image?path=/w185${actorImage}`}
              alt={actorName}
              className="w-14 h-14 rounded-full object-cover bg-yt-secondary flex-shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-yt-text font-bold text-lg truncate">{actorName}</h2>
            <p className="text-yt-text-muted text-sm">Filmographie</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-yt-hover text-yt-text-muted transition-colors flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-5">
          {!credits ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-7 h-7 animate-spin text-yt-text-muted" />
            </div>
          ) : credits.length === 0 ? (
            <p className="text-yt-text-muted text-sm text-center py-12">Aucune donnée disponible</p>
          ) : (
            <div className="space-y-8">
              {movies.length > 0 && (
                <div>
                  <h3 className="text-yt-text font-semibold text-sm mb-3 flex items-center gap-2">
                    <Film className="w-4 h-4 text-yt-red" />
                    Films
                    <span className="text-yt-text-muted font-normal">({movies.length})</span>
                  </h3>
                  <ScrollRow items={movies} kind="movie" />
                </div>
              )}
              {shows.length > 0 && (
                <div>
                  <h3 className="text-yt-text font-semibold text-sm mb-3 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-yt-red" />
                    Séries
                    <span className="text-yt-text-muted font-normal">({shows.length})</span>
                  </h3>
                  <ScrollRow items={shows} kind="tv" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
