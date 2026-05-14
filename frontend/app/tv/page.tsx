'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Tv, Film, Layers, Radio, Star, Play, Clock, TrendingUp, X } from 'lucide-react'
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

interface TmdbItem {
  id: number
  title?: string
  name?: string
  poster_path: string | null
  backdrop_path: string | null
  vote_average: number
  release_date?: string
  first_air_date?: string
  overview: string
  genre_ids: number[]
}

interface TmdbSectionData {
  key: string
  label: string
  type: 'movie' | 'tv'
  list: 'popular' | 'top_rated'
  icon: React.ReactNode
  items: TmdbItem[]
  loading: boolean
}

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

// Jacket avec fallback TMDB : essaie l'icône IPTV, puis le poster TMDB par nom
function SmartCover({ src, name, type, fallback }: { src: string; name: string; type: 'movie' | 'tv'; fallback: React.ReactNode }) {
  const [phase, setPhase] = useState<'iptv' | 'tmdb' | 'none'>('iptv')
  const iptvSrc = src ? `${API_BASE}/api/iptv/icon?url=${encodeURIComponent(src)}` : null
  const tmdbSrc = `${API_BASE}/api/tmdb/poster?name=${encodeURIComponent(name)}&type=${type}`

  if (phase === 'none') return <div className="w-full h-full flex items-center justify-center">{fallback}</div>
  return (
    <img
      src={phase === 'iptv' && iptvSrc ? iptvSrc : tmdbSrc}
      alt={name}
      loading="lazy"
      className="w-full h-full object-cover"
      onError={() => setPhase(prev => prev === 'iptv' ? 'tmdb' : 'none')}
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

function TmdbPoster({ path, title }: { path: string | null; title: string }) {
  const [err, setErr] = useState(false)
  if (!path || err) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-yt-secondary">
        <Film className="w-8 h-8 text-yt-text-muted" />
      </div>
    )
  }
  return (
    <img
      src={`${API_BASE}/api/tmdb/image?path=/w342${path}`}
      alt={title}
      loading="lazy"
      className="w-full h-full object-cover"
      onError={() => setErr(true)}
    />
  )
}

function TmdbCard({ item, type, onClick }: { item: TmdbItem; type: 'movie' | 'tv'; onClick: () => void }) {
  const title = item.title || item.name || ''
  const year = (item.release_date || item.first_air_date || '').substring(0, 4)
  const rating = item.vote_average ? item.vote_average.toFixed(1) : null
  return (
    <button
      onClick={onClick}
      className="flex-shrink-0 w-32 group text-left focus:outline-none"
    >
      <div className="relative w-full aspect-[2/3] rounded-xl overflow-hidden bg-yt-secondary border border-yt-border/30 group-hover:border-yt-red/50 transition-colors">
        <TmdbPoster path={item.poster_path} title={title} />
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-8 h-8 rounded-full bg-yt-red/90 flex items-center justify-center">
            <Play className="w-4 h-4 text-white fill-white ml-0.5" />
          </div>
        </div>
        {rating && (
          <div className="absolute bottom-1.5 left-1.5 flex items-center gap-0.5 bg-black/70 rounded-md px-1.5 py-0.5">
            <Star className="w-2.5 h-2.5 text-yellow-400 fill-yellow-400" />
            <span className="text-[10px] text-white font-medium">{rating}</span>
          </div>
        )}
      </div>
      <p className="text-yt-text text-xs font-medium line-clamp-2 leading-tight mt-1.5">{title}</p>
      {year && <p className="text-yt-text-muted text-[10px] mt-0.5">{year}</p>}
    </button>
  )
}

function TmdbSectionRow({ section, onCardClick }: { section: TmdbSectionData; onCardClick: (item: TmdbItem) => void }) {
  return (
    <div className="mb-8">
      <h2 className="text-yt-text text-base font-semibold flex items-center gap-2 mb-4">
        {section.icon}
        {section.label}
      </h2>
      {section.loading ? (
        <div className="flex gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex-shrink-0 w-32 aspect-[2/3] rounded-xl bg-yt-secondary animate-pulse" />
          ))}
        </div>
      ) : section.items.length === 0 ? null : (
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
          {section.items.map(item => (
            <TmdbCard
              key={item.id}
              item={item}
              type={section.type}
              onClick={() => onCardClick(item)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface CatalogMatch {
  // VOD (movie)
  stream_id?: number
  stream_icon?: string
  container_extension?: string
  // Series
  series_id?: number
  cover?: string
  // Common
  name: string
}

function TmdbModal({ item, type, onClose }: { item: TmdbItem; type: 'movie' | 'tv'; onClose: () => void }) {
  const title = item.title || item.name || ''
  const year = (item.release_date || item.first_air_date || '').substring(0, 4)
  const rating = item.vote_average ? item.vote_average.toFixed(1) : null
  const [match, setMatch] = useState<CatalogMatch | null | 'loading'>('loading')

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const query = year ? `${title} (${year})` : title
    fetch(`${API_BASE}/api/iptv/search_catalog?q=${encodeURIComponent(query)}&type=${type}`)
      .then(r => r.ok ? r.json() : [])
      .then((results: CatalogMatch[]) => setMatch(results[0] ?? null))
      .catch(() => setMatch(null))
  }, [title, year, type])

  const watchHref = match && match !== 'loading'
    ? type === 'tv' && match.series_id
      ? `/tv/series/${match.series_id}?name=${encodeURIComponent(match.name)}&icon=${encodeURIComponent(match.cover || '')}`
      : match.stream_id
        ? `/tv/watch/${match.stream_id}?type=vod&ext=${match.container_extension || 'mp4'}&media=movie&name=${encodeURIComponent(match.name)}&icon=${encodeURIComponent(match.stream_icon || '')}`
        : null
    : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full sm:max-w-lg bg-yt-bg border border-yt-border rounded-t-2xl sm:rounded-2xl overflow-hidden max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Backdrop */}
        {item.backdrop_path && (
          <div className="relative w-full h-36 sm:h-48 flex-shrink-0">
            <img
              src={`${API_BASE}/api/tmdb/image?path=/w780${item.backdrop_path}`}
              alt={title}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-yt-bg via-yt-bg/30 to-transparent" />
          </div>
        )}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex gap-3 p-4 flex-shrink-0">
          <div className="flex-shrink-0 w-20 aspect-[2/3] rounded-lg overflow-hidden bg-yt-secondary">
            <TmdbPoster path={item.poster_path} title={title} />
          </div>
          <div className="min-w-0">
            <h3 className="text-yt-text font-semibold text-base leading-tight">{title}</h3>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {year && <span className="text-yt-text-muted text-xs">{year}</span>}
              {rating && (
                <span className="flex items-center gap-0.5 text-xs text-yellow-400">
                  <Star className="w-3 h-3 fill-yellow-400" />
                  {rating}
                </span>
              )}
              <span className="text-yt-text-muted text-xs">{type === 'movie' ? 'Film' : 'Série'}</span>
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
            <Link
              href={watchHref}
              onClick={onClose}
              className="w-full py-2.5 bg-yt-red hover:bg-yt-red-hover text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              <Play className="w-4 h-4 fill-white" />
              {type === 'tv' ? 'Voir les épisodes' : 'Regarder'}
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

const TMDB_SECTIONS: Pick<TmdbSectionData, 'key' | 'label' | 'type' | 'list' | 'icon'>[] = [
  { key: 'movie_popular',   label: 'Films populaires',          type: 'movie', list: 'popular',   icon: <TrendingUp className="w-5 h-5 text-yt-red" /> },
  { key: 'tv_popular',      label: 'Séries populaires',         type: 'tv',    list: 'popular',   icon: <TrendingUp className="w-5 h-5 text-yt-red" /> },
  { key: 'movie_top_rated', label: 'Films les mieux notés',     type: 'movie', list: 'top_rated', icon: <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" /> },
  { key: 'tv_top_rated',    label: 'Séries les mieux notées',   type: 'tv',    list: 'top_rated', icon: <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" /> },
]

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
  const [continueItems, setContinueItems] = useState<ContinueItem[]>([])

  const [tmdbSections, setTmdbSections] = useState<TmdbSectionData[]>(
    TMDB_SECTIONS.map(s => ({ ...s, items: [], loading: true }))
  )
  const [tmdbKeySet, setTmdbKeySet] = useState<boolean | null>(null)
  const [modal, setModal] = useState<{ item: TmdbItem; type: 'movie' | 'tv' } | null>(null)
  const tmdbFetched = useRef(false)

  useEffect(() => {
    const refresh = () => setContinueItems(getContinueWatching())
    refresh()
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])

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

  // Fetch TMDB home sections once
  useEffect(() => {
    if (tmdbFetched.current) return
    tmdbFetched.current = true
    fetch(`${API_BASE}/api/tmdb/key`)
      .then(r => r.json())
      .then(d => {
        const hasKey = !!(d.key)
        setTmdbKeySet(hasKey)
        if (!hasKey) {
          setTmdbSections(prev => prev.map(s => ({ ...s, loading: false })))
          return
        }
        TMDB_SECTIONS.forEach((sec, idx) => {
          fetch(`${API_BASE}/api/tmdb/discover?type=${sec.type}&list=${sec.list}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              setTmdbSections(prev => prev.map((s, i) =>
                i === idx ? { ...s, items: data?.results?.slice(0, 20) ?? [], loading: false } : s
              ))
            })
            .catch(() => {
              setTmdbSections(prev => prev.map((s, i) =>
                i === idx ? { ...s, loading: false } : s
              ))
            })
        })
      })
      .catch(() => {
        setTmdbKeySet(false)
        setTmdbSections(prev => prev.map(s => ({ ...s, loading: false })))
      })
  }, [])

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

  /* ── Home page ─────────────────────────────────────────────── */
  if (isHome) {
    return (
      <div className="px-4 py-6 max-w-7xl mx-auto">
        {modal && (
          <TmdbModal
            item={modal.item}
            type={modal.type}
            onClose={() => setModal(null)}
          />
        )}

        <ContinueSection items={continueItems} onRemove={() => setContinueItems(getContinueWatching())} />

        {tmdbKeySet === false ? (
          <div className="text-center py-16 text-yt-text-muted text-sm">
            <Film className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>Configurez votre clé TMDB dans les paramètres pour découvrir films et séries.</p>
          </div>
        ) : (
          tmdbSections.map(section => (
            <TmdbSectionRow
              key={section.key}
              section={section}
              onCardClick={item => setModal({ item, type: section.type })}
            />
          ))
        )}
      </div>
    )
  }

  /* ── Section tabs: live / vod / series ─────────────────────── */
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
              href={`/tv/film/${v.stream_id}?ext=${v.container_extension || 'mp4'}&name=${encodeURIComponent(v.name)}&icon=${encodeURIComponent(v.stream_icon || '')}&cat=${encodeURIComponent(selectedCat || '')}`}
              className="group relative flex flex-col rounded-xl overflow-hidden bg-yt-secondary hover:bg-yt-hover transition-colors border border-yt-border/30"
            >
              <div className="relative w-full aspect-[2/3] bg-yt-bg">
                <FavButton id={String(v.stream_id)} type="vod" name={v.name} icon={v.stream_icon || ''} />
                <SmartCover src={v.stream_icon} name={v.name} type="movie" fallback={<Film className="w-10 h-10 text-yt-text-muted" />} />
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
                <SmartCover src={s.cover} name={s.name} type="tv" fallback={<Layers className="w-10 h-10 text-yt-text-muted" />} />
              </div>
              <p className="text-yt-text text-xs font-medium line-clamp-2 leading-tight px-2 py-2">{s.name}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
