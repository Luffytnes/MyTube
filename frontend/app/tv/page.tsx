'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Tv, Film, Layers, Radio, Star, Play, Clock } from 'lucide-react'
import { useRegion } from '@/lib/regionContext'
import Link from 'next/link'
import { toggleTvFavorite, isTvFavorite, type TvFavoriteType } from '@/lib/tvFavorites'
import { getContinueWatching, removeContinue, type ContinueItem } from '@/lib/tvContinueWatching'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

type Section = 'live' | 'vod' | 'series'

interface Category { category_id: string; category_name: string; parent_id: number }
interface Channel { stream_id: number; name: string; stream_icon: string; category_id: string }
interface VodItem { stream_id: number; name: string; stream_icon: string; category_id: string; container_extension: string }
interface SeriesItem { series_id: number; name: string; cover: string; category_id: string }
interface TntChannel { tnt_index: number; tnt_name: string; stream_id: number; name: string; stream_icon: string }

function IptvIcon({ src, name }: { src: string; name: string }) {
  const [err, setErr] = useState(false)
  if (!src || err) return <Radio className="w-8 h-8 text-yt-text-muted" />
  return (
    <img
      src={`${API_BASE}/api/iptv/icon?url=${encodeURIComponent(src)}`}
      alt={name}
      loading="lazy"
      className="w-full h-full object-contain p-1"
      onError={() => setErr(true)}
    />
  )
}

function CoverImage({ src, name, fallback }: { src: string; name: string; fallback: React.ReactNode }) {
  const [err, setErr] = useState(false)
  if (!src || err) return <div className="w-full h-full flex items-center justify-center">{fallback}</div>
  return (
    <img
      src={`${API_BASE}/api/iptv/icon?url=${encodeURIComponent(src)}`}
      alt={name}
      loading="lazy"
      className="w-full h-full object-cover"
      onError={() => setErr(true)}
    />
  )
}

function FavButton({ id, type, name, icon }: { id: string; type: TvFavoriteType; name: string; icon: string }) {
  const [fav, setFav] = useState(false)
  useEffect(() => { setFav(isTvFavorite(id, type)) }, [id, type])
  function toggle(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation()
    const next = toggleTvFavorite({ id, type, name, icon })
    setFav(next)
    window.dispatchEvent(new Event('focus'))
  }
  return (
    <button
      onClick={toggle}
      className={`absolute top-1.5 right-1.5 z-10 p-1 rounded-full transition-colors ${fav ? 'bg-yt-red/90 text-white' : 'bg-black/50 text-white/70 hover:bg-black/70 hover:text-white'}`}
      title={fav ? 'Retirer des favoris' : 'Ajouter aux favoris'}
    >
      <Star className={`w-3 h-3 ${fav ? 'fill-current' : ''}`} />
    </button>
  )
}

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`
}

function ContinueSection({ items, onRemove }: { items: ContinueItem[]; onRemove: () => void }) {
  if (items.length === 0) return null
  return (
    <div className="mb-8">
      <h2 className="text-yt-text text-base font-semibold flex items-center gap-2 mb-4">
        <Clock className="w-5 h-5 text-yt-red" />
        Continuer à regarder
      </h2>
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
        {items.map(item => {
          const pct = item.duration > 0 ? Math.round((item.position / item.duration) * 100) : 0
          return (
            <div key={item.id} className="flex-shrink-0 w-40 group relative">
              <Link
                href={`/tv/watch/${item.id}?type=vod&ext=${item.ext}&media=${item.media}&name=${encodeURIComponent(item.name)}&icon=${encodeURIComponent(item.icon)}`}
                className="block"
              >
                <div className="relative w-full aspect-[2/3] bg-yt-secondary rounded-xl overflow-hidden">
                  <CoverImage src={item.icon} name={item.name} fallback={<Film className="w-10 h-10 text-yt-text-muted" />} />
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                      <Play className="w-5 h-5 text-white fill-white ml-0.5" />
                    </div>
                  </div>
                  {pct > 0 && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                      <div className="h-full bg-yt-red" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
                <p className="text-yt-text text-xs font-medium line-clamp-2 leading-tight mt-2">{item.name}</p>
                {item.position > 0 && (
                  <p className="text-yt-text-muted text-[10px] mt-0.5">{formatTime(item.position)} regardé{item.duration > 0 ? ` / ${formatTime(item.duration)}` : ''}</p>
                )}
              </Link>
              <button
                onClick={() => { removeContinue(item.id); onRemove() }}
                className="absolute top-1.5 right-1.5 z-10 p-1 rounded-full bg-black/50 text-white/70 hover:bg-red-600 hover:text-white transition-colors opacity-0 group-hover:opacity-100"
                title="Retirer"
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function TvPage() {
  const { t } = useRegion()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [configured, setConfigured] = useState<boolean | null>(null)
  const tab = searchParams.get('tab')
  const isHome = !tab
  const section: Section = (tab as Section) || 'live'
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCat, setSelectedCat] = useState<string | null>(searchParams.get('cat'))
  const [items, setItems] = useState<(Channel | VodItem | SeriesItem)[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingCats, setLoadingCats] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tntChannels, setTntChannels] = useState<TntChannel[]>([])
  const [tntLoading, setTntLoading] = useState(false)
  const [continueItems, setContinueItems] = useState<ContinueItem[]>([])

  useEffect(() => { setContinueItems(getContinueWatching()) }, [])

  const pushUrl = useCallback((t: Section, cat: string | null) => {
    const params = new URLSearchParams()
    params.set('tab', t)
    if (cat) params.set('cat', cat)
    router.replace(`/tv?${params.toString()}`, { scroll: false })
  }, [router])

  useEffect(() => {
    fetch(`${API_BASE}/api/iptv/status`)
      .then(r => r.json())
      .then(d => setConfigured(d.configured))
      .catch(() => setConfigured(false))
  }, [])

  useEffect(() => {
    if (!configured) return
    setTntLoading(true)
    fetch(`${API_BASE}/api/iptv/tnt_channels`)
      .then(r => r.json())
      .then((data: TntChannel[]) => setTntChannels(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setTntLoading(false))
  }, [configured])

  const loadCategories = useCallback(async (sec: Section, savedCat?: string | null) => {
    setLoadingCats(true)
    setCategories([])
    setItems([])
    setError(null)
    try {
      const ep = sec === 'live' ? 'categories' : sec === 'vod' ? 'vod_categories' : 'series_categories'
      const res = await fetch(`${API_BASE}/api/iptv/${ep}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      const cats: Category[] = Array.isArray(data) ? data : []
      setCategories(cats)
      const catToSelect = savedCat && cats.find(c => c.category_id === savedCat)
        ? savedCat
        : cats[0]?.category_id ?? null
      setSelectedCat(catToSelect)
      pushUrl(sec, catToSelect)
    } catch {
      setError(t('iptv_error'))
    } finally {
      setLoadingCats(false)
    }
  }, [t, pushUrl])

  useEffect(() => {
    if (configured && !isHome) loadCategories(section, searchParams.get('cat'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, section, isHome])

  const loadItems = useCallback(async (sec: Section, catId: string) => {
    setLoading(true)
    setError(null)
    setItems([])
    try {
      let url: string
      if (sec === 'live') url = `${API_BASE}/api/iptv/channels?category_id=${catId}`
      else if (sec === 'vod') url = `${API_BASE}/api/iptv/vod?category_id=${catId}`
      else url = `${API_BASE}/api/iptv/series?category_id=${catId}`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`${res.status}`)
      const data = await res.json()
      setItems(Array.isArray(data) ? data : [])
    } catch {
      setError(t('iptv_error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (configured && !isHome && selectedCat) loadItems(section, selectedCat)
  }, [configured, isHome, section, selectedCat, loadItems])

  if (configured === null) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-2 border-yt-red border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (!configured) return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] text-center px-4">
      <div className="w-16 h-16 rounded-full bg-yt-secondary flex items-center justify-center mb-4">
        <Tv className="w-8 h-8 text-yt-text-muted" />
      </div>
      <h2 className="text-yt-text text-xl font-semibold mb-2">{t('iptv_not_configured')}</h2>
      <p className="text-yt-text-muted text-sm max-w-sm">{t('iptv_not_configured_desc')}</p>
    </div>
  )

  /* ── Home page: only TNT + continue watching ───────────── */
  if (isHome) {
    return (
      <div className="px-4 py-6 max-w-7xl mx-auto">
        <ContinueSection items={continueItems} onRemove={() => setContinueItems(getContinueWatching())} />

        <h2 className="text-yt-text text-base font-semibold flex items-center gap-2 mb-4">
          <Tv className="w-5 h-5 text-yt-red" />
          Chaînes TNT
        </h2>

        {tntLoading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-2 border-yt-red border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3">
            {tntChannels.map(ch => (
              <Link
                key={ch.stream_id}
                href={`/tv/watch/${ch.stream_id}?type=live&cat=tnt&name=${encodeURIComponent(ch.name)}&icon=${encodeURIComponent(ch.stream_icon || '')}`}
                className="group flex flex-col items-center gap-2 p-3 rounded-xl bg-yt-secondary hover:bg-yt-hover transition-colors border border-yt-border/30"
              >
                <div className="w-16 h-16 rounded-xl bg-yt-bg flex items-center justify-center overflow-hidden">
                  <IptvIcon src={ch.stream_icon} name={ch.name} />
                </div>
                <p className="text-yt-text text-xs font-medium text-center line-clamp-2 leading-tight w-full">{ch.tnt_name}</p>
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-[10px] text-yt-text-muted">{t('iptv_live')}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    )
  }

  /* ── Section tabs: live / vod / series ─────────────────── */
  return (
    <div className="px-4 py-6 max-w-7xl mx-auto">
      {/* Category pills */}
      {!loadingCats && categories.length > 0 && (
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2 scrollbar-hide">
          {categories.map(cat => (
            <button
              key={cat.category_id}
              onClick={() => { setSelectedCat(cat.category_id); pushUrl(section, cat.category_id) }}
              className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                selectedCat === cat.category_id
                  ? 'bg-yt-red text-white'
                  : 'bg-yt-secondary text-yt-text-secondary hover:bg-yt-hover'
              }`}
            >
              {cat.category_name}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      {loading || loadingCats ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 border-yt-red border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="text-center py-20">
          <p className="text-yt-text-muted mb-4">{error}</p>
          <button
            onClick={() => selectedCat && loadItems(section, selectedCat)}
            className="px-5 py-2 bg-yt-red text-white rounded-full text-sm font-medium hover:bg-yt-red-hover transition-colors"
          >
            {t('retry')}
          </button>
        </div>
      ) : section === 'live' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {(items as Channel[]).map(ch => (
            <Link
              key={ch.stream_id}
              href={`/tv/watch/${ch.stream_id}?type=live&cat=${encodeURIComponent(selectedCat || '')}&name=${encodeURIComponent(ch.name)}&icon=${encodeURIComponent(ch.stream_icon || '')}`}
              className="group relative flex flex-col items-center gap-2 p-3 rounded-xl bg-yt-secondary hover:bg-yt-hover transition-colors border border-yt-border/30"
            >
              <FavButton id={String(ch.stream_id)} type="live" name={ch.name} icon={ch.stream_icon || ''} />
              <div className="w-16 h-16 rounded-xl bg-yt-bg flex items-center justify-center overflow-hidden">
                <IptvIcon src={ch.stream_icon} name={ch.name} />
              </div>
              <p className="text-yt-text text-xs font-medium text-center line-clamp-2 leading-tight">{ch.name}</p>
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-[10px] text-yt-text-muted">{t('iptv_live')}</span>
              </div>
            </Link>
          ))}
        </div>
      ) : section === 'vod' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {(items as VodItem[]).map(v => (
            <Link
              key={v.stream_id}
              href={`/tv/watch/${v.stream_id}?type=vod&ext=${v.container_extension || 'mp4'}&name=${encodeURIComponent(v.name)}&icon=${encodeURIComponent(v.stream_icon || '')}`}
              className="group relative flex flex-col rounded-xl overflow-hidden bg-yt-secondary hover:bg-yt-hover transition-colors border border-yt-border/30"
            >
              <div className="relative w-full aspect-[2/3] bg-yt-bg">
                <FavButton id={String(v.stream_id)} type="vod" name={v.name} icon={v.stream_icon || ''} />
                <CoverImage src={v.stream_icon} name={v.name} fallback={<Film className="w-10 h-10 text-yt-text-muted" />} />
              </div>
              <p className="text-yt-text text-xs font-medium line-clamp-2 leading-tight px-2 py-2">{v.name}</p>
            </Link>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {(items as SeriesItem[]).map(s => (
            <Link
              key={s.series_id}
              href={`/tv/series/${s.series_id}?name=${encodeURIComponent(s.name)}&icon=${encodeURIComponent(s.cover || '')}`}
              className="group relative flex flex-col rounded-xl overflow-hidden bg-yt-secondary hover:bg-yt-hover transition-colors border border-yt-border/30"
            >
              <div className="relative w-full aspect-[2/3] bg-yt-bg">
                <FavButton id={String(s.series_id)} type="series" name={s.name} icon={s.cover || ''} />
                <CoverImage src={s.cover} name={s.name} fallback={<Layers className="w-10 h-10 text-yt-text-muted" />} />
              </div>
              <p className="text-yt-text text-xs font-medium line-clamp-2 leading-tight px-2 py-2">{s.name}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
