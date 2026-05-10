'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Star, Radio, Film, Layers, Trash2, Tv } from 'lucide-react'
import { useRegion } from '@/lib/regionContext'
import { getTvFavorites, removeTvFavorite, type TvFavorite, type TvFavoriteType } from '@/lib/tvFavorites'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

function FavImg({ fav }: { fav: TvFavorite }) {
  const [err, setErr] = useState(false)
  if (!fav.icon || err) {
    const Icon = fav.type === 'live' ? Radio : fav.type === 'vod' ? Film : Layers
    return <Icon className="w-7 h-7 text-yt-text-muted" />
  }
  return (
    <img
      src={`${API_BASE}/api/iptv/icon?url=${encodeURIComponent(fav.icon)}`}
      alt={fav.name}
      loading="lazy"
      className={fav.type === 'live' ? 'w-full h-full object-contain p-1' : 'w-full h-full object-cover'}
      onError={() => setErr(true)}
    />
  )
}

function favHref(fav: TvFavorite): string {
  if (fav.type === 'series') return `/tv/series/${fav.id}?name=${encodeURIComponent(fav.name)}&icon=${encodeURIComponent(fav.icon)}`
  const ext = fav.ext ?? 'mp4'
  const media = fav.media ?? 'movie'
  return `/tv/watch/${fav.id}?type=${fav.type === 'live' ? 'live' : 'vod'}&ext=${ext}&media=${media}&name=${encodeURIComponent(fav.name)}&icon=${encodeURIComponent(fav.icon)}`
}

function FavCard({ fav, onRemove }: { fav: TvFavorite; onRemove: () => void }) {
  const { t } = useRegion()
  function handleRemove(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation()
    removeTvFavorite(fav.id, fav.type)
    onRemove()
  }
  if (fav.type === 'live') {
    return (
      <Link
        href={favHref(fav)}
        className="group relative flex flex-col items-center gap-2 p-3 rounded-xl bg-yt-secondary hover:bg-yt-hover transition-colors border border-yt-border/30"
      >
        <button onClick={handleRemove} className="absolute top-1.5 right-1.5 z-10 p-1 rounded-full bg-black/50 text-white/70 hover:bg-red-600 hover:text-white transition-colors opacity-0 group-hover:opacity-100">
          <Trash2 className="w-3 h-3" />
        </button>
        <div className="w-14 h-14 rounded-xl bg-yt-bg flex items-center justify-center overflow-hidden">
          <FavImg fav={fav} />
        </div>
        <p className="text-yt-text text-xs font-medium text-center line-clamp-2">{fav.name}</p>
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-[10px] text-yt-text-muted">{t('iptv_live')}</span>
        </div>
      </Link>
    )
  }
  return (
    <Link
      href={favHref(fav)}
      className="group relative flex flex-col rounded-xl overflow-hidden bg-yt-secondary hover:bg-yt-hover transition-colors border border-yt-border/30"
    >
      <button onClick={handleRemove} className="absolute top-1.5 right-1.5 z-10 p-1 rounded-full bg-black/50 text-white/70 hover:bg-red-600 hover:text-white transition-colors opacity-0 group-hover:opacity-100">
        <Trash2 className="w-3 h-3" />
      </button>
      <div className="w-full aspect-[2/3] bg-yt-bg flex items-center justify-center overflow-hidden">
        <FavImg fav={fav} />
      </div>
      <p className="text-yt-text text-xs font-medium line-clamp-2 px-2 py-2">{fav.name}</p>
    </Link>
  )
}

function Section({ title, icon, items, onRemove }: { title: string; icon: React.ReactNode; items: TvFavorite[]; onRemove: () => void }) {
  if (items.length === 0) return null
  return (
    <div className="mb-10">
      <h2 className="text-yt-text text-base font-semibold flex items-center gap-2 mb-4">
        {icon}
        {title}
        <span className="text-yt-text-muted text-sm font-normal">({items.length})</span>
      </h2>
      <div className={items[0].type === 'live'
        ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3'
        : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3'
      }>
        {items.map(fav => <FavCard key={`${fav.type}-${fav.id}`} fav={fav} onRemove={onRemove} />)}
      </div>
    </div>
  )
}

export default function TvFavoritesPage() {
  const { t } = useRegion()
  const [favorites, setFavorites] = useState<TvFavorite[]>([])

  function reload() { setFavorites(getTvFavorites()) }
  useEffect(() => { reload() }, [])

  const live = favorites.filter(f => f.type === 'live')
  const vod = favorites.filter(f => f.type === 'vod')
  const series = favorites.filter(f => f.type === 'series')

  return (
    <div className="px-4 py-6 max-w-7xl mx-auto">
      <h1 className="text-yt-text text-xl font-semibold flex items-center gap-2 mb-8">
        <Star className="w-6 h-6 text-yt-red fill-current" />
        {t('tv_favorites')}
      </h1>

      {favorites.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Star className="w-12 h-12 text-yt-text-muted mb-4" />
          <p className="text-yt-text-muted">{t('tv_no_favorites')}</p>
        </div>
      ) : (
        <>
          <Section title={t('iptv_tab_channels')} icon={<Tv className="w-5 h-5 text-yt-red" />} items={live} onRemove={reload} />
          <Section title={t('iptv_tab_vod')} icon={<Film className="w-5 h-5 text-yt-red" />} items={vod} onRemove={reload} />
          <Section title={t('iptv_tab_series')} icon={<Layers className="w-5 h-5 text-yt-red" />} items={series} onRemove={reload} />
        </>
      )}
    </div>
  )
}
