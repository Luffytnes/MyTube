'use client'

import { useState, useEffect, useCallback } from 'react'
import { Radio, Play, Pause, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRegion } from '@/lib/regionContext'
import { useMusic } from '@/lib/musicContext'
import type { Translations } from '@/lib/translations'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

interface RadioStation {
  id: string
  name: string
  url: string       // proxied stream URL (relative)
  favicon: string | null
  country: string
  tags: string[]
  bitrate: number
  codec: string
}

type GenreKey = keyof Translations & `radio_genre_${string}`

const GENRES: { labelKey: GenreKey; tag: string }[] = [
  { labelKey: 'radio_genre_all', tag: '' },
  { labelKey: 'radio_genre_pop', tag: 'pop' },
  { labelKey: 'radio_genre_rock', tag: 'rock' },
  { labelKey: 'radio_genre_jazz', tag: 'jazz' },
  { labelKey: 'radio_genre_classical', tag: 'classical' },
  { labelKey: 'radio_genre_electronic', tag: 'electronic' },
  { labelKey: 'radio_genre_hiphop', tag: 'hip-hop' },
  { labelKey: 'radio_genre_news', tag: 'news' },
  { labelKey: 'radio_genre_sport', tag: 'sport' },
  { labelKey: 'radio_genre_country', tag: 'country' },
  { labelKey: 'radio_genre_soul', tag: 'soul' },
  { labelKey: 'radio_genre_metal', tag: 'metal' },
]

function StationCard({
  station,
  isPlaying,
  onPlay,
}: {
  station: RadioStation
  isPlaying: boolean
  onPlay: () => void
}) {
  return (
    <div
      className={cn(
        'group relative flex flex-col gap-2 rounded-xl overflow-hidden transition-colors cursor-pointer',
        isPlaying ? 'ring-2 ring-yt-red' : ''
      )}
      onClick={onPlay}
    >
      <div className="aspect-square bg-yt-secondary rounded-xl overflow-hidden relative">
        {station.favicon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={station.favicon}
            alt={station.name}
            className="w-full h-full object-contain p-3 group-hover:scale-105 transition-transform duration-500"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Radio className="w-10 h-10 text-yt-text-muted" />
          </div>
        )}

        {/* Overlay play button */}
        <div className={cn(
          'absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity',
          isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        )}>
          <div className="w-12 h-12 rounded-full bg-yt-red flex items-center justify-center shadow-lg">
            {isPlaying
              ? <Pause className="w-5 h-5 text-white fill-white" />
              : <Play className="w-5 h-5 text-white fill-white ml-0.5" />}
          </div>
        </div>

        {/* Live badge */}
        <div className="absolute top-2 left-2 flex items-center gap-1 bg-yt-red text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          LIVE
        </div>
      </div>

      <div className="min-w-0 px-0.5 pb-1">
        <p className={cn(
          'text-xs font-medium truncate transition-colors',
          isPlaying ? 'text-yt-red' : 'text-yt-text group-hover:text-yt-red'
        )}>
          {station.name}
        </p>
        {station.tags && station.tags.length > 0 && (
          <p className="text-xs text-yt-text-muted truncate capitalize">
            {station.tags[0]}
          </p>
        )}
      </div>
    </div>
  )
}

export default function RadioPage() {
  const { t, region } = useRegion()
  const { currentTrack, playing, playPause, playRadio } = useMusic()
  const [stations, setStations] = useState<RadioStation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [selectedGenre, setSelectedGenre] = useState('')

  const load = useCallback(async (country: string, tag: string) => {
    setLoading(true)
    setError(false)
    try {
      const params = new URLSearchParams({ limit: '48', country: country.toUpperCase() })
      if (tag) params.set('tag', tag)
      const res = await fetch(`${API_BASE}/api/radio/stations?${params}`)
      if (!res.ok) throw new Error()
      const data: RadioStation[] = await res.json()
      // favicon is a relative /api/... URL from backend — prefix with API_BASE for local dev
      const stations = Array.isArray(data) ? data.map((s) => ({
        ...s,
        favicon: s.favicon ? `${API_BASE}${s.favicon}` : null,
      })) : []
      setStations(stations)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(region.code, selectedGenre)
  }, [region.code, selectedGenre, load])

  function handlePlay(station: RadioStation) {
    const streamUrl = `${API_BASE}${station.url}`
    const radioTrack = {
      videoId: `radio-${station.id}`,
      title: station.name,
      artists: [{ name: t('music_radio_live') }],
      thumbnail: station.favicon || undefined,
      isRadio: true,
      radioStreamUrl: streamUrl,
    }
    if (currentTrack?.videoId === radioTrack.videoId) {
      playPause()
    } else {
      playRadio(radioTrack)
    }
  }

  return (
    <div className="px-4 py-6 min-h-screen space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Radio className="w-6 h-6 text-yt-red flex-shrink-0" />
        <h1 className="text-yt-text text-2xl font-bold">{t('music_radio')}</h1>
      </div>

      {/* Genre filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {GENRES.map(({ labelKey, tag }) => (
          <button
            key={tag}
            onClick={() => setSelectedGenre(tag)}
            className={cn(
              'flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-colors',
              selectedGenre === tag
                ? 'bg-yt-text text-yt-bg'
                : 'bg-yt-secondary text-yt-text hover:bg-yt-hover'
            )}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <p>{t('radio_no_results')}</p>
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <div className="aspect-square rounded-xl bg-yt-secondary animate-pulse" />
              <div className="h-3 bg-yt-secondary rounded animate-pulse" />
            </div>
          ))}
        </div>
      ) : stations.length === 0 && !error ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Radio className="w-12 h-12 text-yt-text-muted mb-3" />
          <p className="text-yt-text-muted">{t('radio_no_results')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {stations.map((station) => (
            <StationCard
              key={station.id}
              station={station}
              isPlaying={currentTrack?.videoId === `radio-${station.id}` && playing}
              onPlay={() => handlePlay(station)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
