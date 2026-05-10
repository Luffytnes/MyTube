'use client'

import { useState, useEffect } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Layers, Play, Star } from 'lucide-react'
import { useRegion } from '@/lib/regionContext'
import { toggleTvFavorite, isTvFavorite } from '@/lib/tvFavorites'

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

export default function TvSeriesPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { t } = useRegion()
  const seriesId = params.id as string
  const name = searchParams.get('name') || 'Series'
  const icon = searchParams.get('icon') || ''
  const [data, setData] = useState<SeriesInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null)
  const [coverErr, setCoverErr] = useState(false)
  const [fav, setFav] = useState(false)

  useEffect(() => { setFav(isTvFavorite(seriesId, 'series')) }, [seriesId])

  function toggleFav() {
    const next = toggleTvFavorite({ id: seriesId, type: 'series', name, icon })
    setFav(next)
    window.dispatchEvent(new Event('focus'))
  }

  useEffect(() => {
    fetch(`${API_BASE}/api/iptv/series_info/${seriesId}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(d => {
        setData(d)
        const seasons = Object.keys(d.episodes || {}).sort((a, b) => Number(a) - Number(b))
        if (seasons.length > 0) setSelectedSeason(seasons[0])
      })
      .catch(() => setError(t('iptv_error')))
      .finally(() => setLoading(false))
  }, [seriesId, t])

  const seasons = data ? Object.keys(data.episodes || {}).sort((a, b) => Number(a) - Number(b)) : []
  const episodes = selectedSeason && data ? (data.episodes[selectedSeason] || []) : []

  return (
    <div className="min-h-screen px-4 py-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <button onClick={() => router.back()} className="inline-flex items-center gap-2 text-yt-text-muted hover:text-yt-text text-sm transition-colors">
          <ArrowLeft className="w-4 h-4" />
          {t('nav_back')}
        </button>
        <div className="flex-1" />
        <button
          onClick={toggleFav}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors border ${fav ? 'bg-yt-red/10 border-yt-red text-yt-red' : 'border-yt-border text-yt-text-muted hover:text-yt-text hover:border-yt-text'}`}
        >
          <Star className={`w-4 h-4 ${fav ? 'fill-current' : ''}`} />
          {fav ? 'Favori' : 'Ajouter'}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 border-yt-red border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="text-center py-20"><p className="text-yt-text-muted">{error}</p></div>
      ) : data ? (
        <>
          {/* Header */}
          <div className="flex gap-4 mb-8">
            <div className="flex-shrink-0 w-24 h-36 rounded-xl overflow-hidden bg-yt-secondary">
              {(icon || data.info.cover) && !coverErr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`${API_BASE}/api/iptv/icon?url=${encodeURIComponent(icon || data.info.cover)}`}
                  alt={name}
                  className="w-full h-full object-cover"
                  onError={() => setCoverErr(true)}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Layers className="w-8 h-8 text-yt-text-muted" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-yt-text text-xl font-bold mb-1">{name}</h1>
              {data.info.genre && <p className="text-yt-text-muted text-sm mb-2">{data.info.genre}</p>}
              {data.info.rating && <p className="text-yt-text-muted text-xs mb-2">★ {data.info.rating}</p>}
              {data.info.plot && <p className="text-yt-text-muted text-sm line-clamp-3">{data.info.plot}</p>}
            </div>
          </div>

          {/* Season selector */}
          {seasons.length > 1 && (
            <div className="flex gap-2 mb-6 overflow-x-auto pb-2 scrollbar-hide">
              {seasons.map(s => (
                <button
                  key={s}
                  onClick={() => setSelectedSeason(s)}
                  className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    selectedSeason === s ? 'bg-yt-red text-white' : 'bg-yt-secondary text-yt-text-secondary hover:bg-yt-hover'
                  }`}
                >
                  {t('iptv_season')} {s}
                </button>
              ))}
            </div>
          )}

          {/* Episodes */}
          <div className="flex flex-col gap-2">
            {episodes
              .slice()
              .sort((a, b) => a.episode_num - b.episode_num)
              .map(ep => {
                const epName = `${name} — ${t('iptv_episode_short')}${ep.episode_num}${ep.title && ep.title !== String(ep.episode_num) ? ` — ${ep.title}` : ''}`
                const href = `/tv/watch/${ep.id}?type=vod&media=series&ext=${ep.container_extension || 'mp4'}&name=${encodeURIComponent(epName)}&icon=${encodeURIComponent(icon || data.info.cover || '')}&series_id=${seriesId}&season=${selectedSeason}&series_name=${encodeURIComponent(name)}&series_icon=${encodeURIComponent(icon || data.info.cover || '')}`
                return (
                  <Link
                    key={ep.id}
                    href={href}
                    className="flex items-center gap-4 p-3 rounded-xl bg-yt-secondary hover:bg-yt-hover transition-colors border border-yt-border/30 group"
                  >
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-yt-hover group-hover:bg-yt-red flex items-center justify-center transition-colors">
                      <Play className="w-4 h-4 text-yt-text fill-current" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-yt-text text-sm font-medium">
                        {t('iptv_episode_short')}{ep.episode_num}
                        {ep.title && ep.title !== String(ep.episode_num) ? ` — ${ep.title}` : ''}
                      </p>
                      {ep.info?.duration && <p className="text-yt-text-muted text-xs">{ep.info.duration}</p>}
                    </div>
                  </Link>
                )
              })}
          </div>
        </>
      ) : null}
    </div>
  )
}
