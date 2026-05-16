'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { Star, Radio, Film, Layers, Trash2, Tv, Play } from 'lucide-react'
import { useRegion } from '@/lib/regionContext'
import { getTvFavorites, removeTvFavorite, type TvFavorite } from '@/lib/tvFavorites'
import { getContinueWatching } from '@/lib/tvContinueWatching'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

function Card3D({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = ref.current; if (!el) return
    const rect = el.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    el.style.transition = 'transform 0.05s ease'
    el.style.transform = `perspective(600px) rotateX(${(y - 0.5) * -18}deg) rotateY(${(x - 0.5) * 18}deg) scale3d(1.06,1.06,1.06)`
  }
  function onMouseLeave() {
    const el = ref.current; if (!el) return
    el.style.transition = 'transform 0.35s ease'
    el.style.transform = 'perspective(600px) rotateX(0deg) rotateY(0deg) scale3d(1,1,1)'
  }
  return (
    <div ref={ref} className={className} onMouseMove={onMouseMove} onMouseLeave={onMouseLeave}
      style={{ transformStyle: 'preserve-3d', willChange: 'transform' }}>
      {children}
    </div>
  )
}

function RemoveBtn({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={onClick}
      className="absolute top-1.5 right-1.5 z-10 p-1 rounded-full bg-black/50 text-white/70 hover:bg-red-600 hover:text-white transition-colors opacity-0 group-hover:opacity-100"
      title="Retirer des favoris"
    >
      <Trash2 className="w-3 h-3" />
    </button>
  )
}

function VodSeriesCard({ fav, onRemove }: { fav: TvFavorite; onRemove: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [meta, setMeta] = useState<{ poster_path: string | null; vote_average: number | null } | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle')
  const [totalEps, setTotalEps] = useState<number | null>(null)

  const tmdbType = fav.type === 'series' ? 'tv' : 'movie'
  const href = fav.type === 'series'
    ? `/tv/series/${fav.id}?name=${encodeURIComponent(fav.name)}&icon=${encodeURIComponent(fav.icon)}`
    : `/tv/watch/${fav.id}?type=vod&ext=${fav.ext ?? 'mp4'}&media=${fav.media ?? 'movie'}&name=${encodeURIComponent(fav.name)}&icon=${encodeURIComponent(fav.icon)}`

  useEffect(() => {
    const el = wrapRef.current; if (!el) return
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        obs.disconnect()
        setStatus('loading')
        fetch(`${API_BASE}/api/tmdb/meta?name=${encodeURIComponent(fav.name)}&type=${tmdbType}`)
          .then(r => r.ok ? r.json() : null)
          .then(d => { setMeta(d); setStatus('done') })
          .catch(() => setStatus('done'))
      }
    }, { rootMargin: '250px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [fav.name, tmdbType])

  useEffect(() => {
    if (fav.type !== 'series') return
    fetch(`${API_BASE}/api/iptv/series_info/${fav.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.episodes) return
        const count = (Object.values(data.episodes) as unknown[][]).reduce((s, eps) => s + eps.length, 0)
        setTotalEps(count)
      })
      .catch(() => {})
  }, [fav.id, fav.type])

  const posterSrc = meta?.poster_path ? `${API_BASE}/api/tmdb/image?path=/w342${meta.poster_path}` : null
  const rating = meta?.vote_average ? meta.vote_average.toFixed(1) : null
  const noImage = status === 'done' && !posterSrc

  let pct = 0
  if (fav.type === 'series' && totalEps) {
    const completed = getContinueWatching().filter(c => c.seriesId === fav.id && c.duration > 0 && c.position / c.duration >= 0.95).length
    pct = Math.round((completed / totalEps) * 100)
  } else if (fav.type === 'vod') {
    const item = getContinueWatching().find(c => c.id === fav.id)
    if (item && item.duration > 0) pct = Math.min(100, Math.round((item.position / item.duration) * 100))
  }

  function handleRemove(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation()
    removeTvFavorite(fav.id, fav.type); onRemove()
  }

  return (
    <div ref={wrapRef}>
      <Card3D className="group relative">
        <Link href={href} className="block relative w-full aspect-[2/3] rounded-xl overflow-hidden bg-yt-secondary shadow-lg">
          {status !== 'done' ? (
            <div className="w-full h-full bg-yt-secondary animate-pulse" />
          ) : posterSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={posterSrc} alt={fav.name} loading="lazy" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              {fav.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`${API_BASE}/api/iptv/icon?url=${encodeURIComponent(fav.icon)}`} alt={fav.name} className="w-full h-full object-cover" />
              ) : (
                fav.type === 'series' ? <Layers className="w-10 h-10 text-yt-text-muted" /> : <Film className="w-10 h-10 text-yt-text-muted" />
              )}
            </div>
          )}
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <Play className="w-5 h-5 text-white fill-white ml-0.5" />
            </div>
          </div>
          {rating && (
            <div className={`absolute left-1.5 flex items-center gap-0.5 bg-black/70 rounded-md px-1.5 py-0.5 ${pct > 0 ? 'bottom-3' : 'bottom-1.5'}`}>
              <Star className="w-2.5 h-2.5 text-yellow-400 fill-yellow-400" />
              <span className="text-[10px] text-white font-medium">{rating}</span>
            </div>
          )}
          {pct > 0 && (
            <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-white/20">
              <div className="h-full bg-yt-red" style={{ width: `${pct}%` }} />
            </div>
          )}
        </Link>
        {noImage && (
          <p className="text-yt-text text-xs font-medium line-clamp-2 leading-tight mt-1.5 px-0.5">{fav.name}</p>
        )}
        <RemoveBtn onClick={handleRemove} />
      </Card3D>
    </div>
  )
}

function LiveCard({ fav, onRemove }: { fav: TvFavorite; onRemove: () => void }) {
  const href = `/tv/watch/${fav.id}?type=live&name=${encodeURIComponent(fav.name)}&icon=${encodeURIComponent(fav.icon)}`
  const { t } = useRegion()

  function handleRemove(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation()
    removeTvFavorite(fav.id, fav.type); onRemove()
  }

  return (
    <Card3D className="group relative">
      <Link href={href} className="block rounded-xl overflow-hidden shadow-md border border-yt-border/40">
        <div className="relative w-full aspect-[4/3] bg-white flex items-center justify-center p-4">
          {fav.icon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`${API_BASE}/api/iptv/icon?url=${encodeURIComponent(fav.icon)}`} alt={fav.name} loading="lazy"
              className="w-full h-full object-contain" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
          ) : (
            <Radio className="w-10 h-10 text-yt-text-muted" />
          )}
          <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="w-9 h-9 rounded-full bg-black/40 flex items-center justify-center">
              <Play className="w-4 h-4 text-white fill-white ml-0.5" />
            </div>
          </div>
          <RemoveBtn onClick={handleRemove} />
        </div>
        <div className="flex items-center gap-2 px-2.5 py-2 bg-yt-secondary border-t border-yt-border/40">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
          <p className="text-yt-text text-xs font-medium line-clamp-1">{fav.name}</p>
        </div>
      </Link>
    </Card3D>
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
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {items.map(fav => fav.type === 'live'
          ? <LiveCard key={`${fav.type}-${fav.id}`} fav={fav} onRemove={onRemove} />
          : <VodSeriesCard key={`${fav.type}-${fav.id}`} fav={fav} onRemove={onRemove} />
        )}
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
    <div className="px-4 py-6 min-h-screen">
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
