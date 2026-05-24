'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { X, Play, Star, Loader2 } from 'lucide-react'

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

function CreditCard({ item }: { item: CreditItem }) {
  const [match, setMatch] = useState<LibraryMatch | null | 'loading'>('loading')

  useEffect(() => {
    const year = item.release_date?.substring(0, 4)
    const q = year ? `${item.title} (${year})` : item.title || ''
    const type = item.media_type === 'tv' ? 'tv' : 'movie'
    fetch(`${API_BASE}/api/iptv/search_catalog?q=${encodeURIComponent(q)}&type=${type}`)
      .then(r => r.ok ? r.json() : [])
      .then((results: LibraryMatch[]) => setMatch(results[0] ?? null))
      .catch(() => setMatch(null))
  }, [item])

  const year = item.release_date?.substring(0, 4)
  const isMovie = item.media_type === 'movie'

  const href = match && match !== 'loading'
    ? isMovie && match.stream_id
      ? `/tv/film/${match.stream_id}?ext=${match.container_extension || 'mp4'}&name=${encodeURIComponent(match.name)}&icon=${encodeURIComponent(match.stream_icon || '')}`
      : !isMovie && match.series_id
        ? `/tv/series/${match.series_id}?name=${encodeURIComponent(match.name)}&icon=${encodeURIComponent(match.cover || '')}`
        : null
    : null

  const available = match !== 'loading' && href !== null

  const inner = (
    <div className={`relative rounded-xl overflow-hidden aspect-[2/3] bg-yt-secondary shadow-md ${available ? 'group-hover:ring-2 group-hover:ring-yt-red transition-all' : 'opacity-50'}`}>
      {item.poster_path ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`${API_BASE}/api/tmdb/image?path=/w342${item.poster_path}`}
          alt={item.title || ''}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-yt-text-muted text-xs text-center px-2">{item.title}</div>
      )}
      {available && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-8 h-8 rounded-full bg-yt-red flex items-center justify-center">
            <Play className="w-4 h-4 text-white fill-white ml-0.5" />
          </div>
        </div>
      )}
      {match === 'loading' && (
        <div className="absolute bottom-1 right-1">
          <div className="w-3 h-3 border border-white/40 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {item.vote_average && item.vote_average > 0 ? (
        <span className="absolute top-1.5 right-1.5 bg-black/75 text-yellow-400 text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
          <Star className="w-2.5 h-2.5 fill-current" />{item.vote_average.toFixed(1)}
        </span>
      ) : null}
    </div>
  )

  return (
    <div className="flex-shrink-0 w-28 group">
      {href ? (
        <Link href={href} className="block focus:outline-none">{inner}</Link>
      ) : (
        <div className="cursor-default">{inner}</div>
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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-full sm:max-w-xl bg-yt-bg border border-yt-border rounded-t-2xl sm:rounded-2xl overflow-hidden max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-yt-border/40 flex-shrink-0">
          {actorImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`${API_BASE}/api/tmdb/image?path=/w185${actorImage}`}
              alt={actorName}
              className="w-10 h-10 rounded-full object-cover bg-yt-secondary"
            />
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-yt-text font-semibold text-sm truncate">{actorName}</h2>
            <p className="text-yt-text-muted text-xs">Filmographie</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-yt-hover text-yt-text-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-4 py-4">
          {!credits ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-yt-text-muted" />
            </div>
          ) : credits.length === 0 ? (
            <p className="text-yt-text-muted text-sm text-center py-8">Aucune donnée disponible</p>
          ) : (
            <>
              {movies.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-yt-text font-semibold text-sm mb-3">Films</h3>
                  <div className="flex gap-3 overflow-x-auto scrollbar-none pb-2">
                    {movies.map(item => <CreditCard key={item.id} item={item} />)}
                  </div>
                </div>
              )}
              {shows.length > 0 && (
                <div>
                  <h3 className="text-yt-text font-semibold text-sm mb-3">Séries</h3>
                  <div className="flex gap-3 overflow-x-auto scrollbar-none pb-2">
                    {shows.map(item => <CreditCard key={item.id} item={item} />)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
