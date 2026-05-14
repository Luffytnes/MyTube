'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, Tv, Radio, Film, Layers } from 'lucide-react'
import { useRegion } from '@/lib/regionContext'
import Link from 'next/link'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

type Section = 'live' | 'vod' | 'series'

interface Category { category_id: string; category_name: string; parent_id: number }
interface Channel { stream_id: number; name: string; stream_icon: string; category_id: string }
interface VodItem { stream_id: number; name: string; stream_icon: string; category_id: string; container_extension: string }
interface SeriesItem { series_id: number; name: string; cover: string; category_id: string }

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

export default function IPTVPage() {
  const { t } = useRegion()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [configured, setConfigured] = useState<boolean | null>(null)
  const [section, setSection] = useState<Section>((searchParams.get('tab') as Section) || 'live')
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCat, setSelectedCat] = useState<string | null>(searchParams.get('cat'))
  const [items, setItems] = useState<(Channel | VodItem | SeriesItem)[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingCats, setLoadingCats] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pushUrl = useCallback((tab: Section, cat: string | null) => {
    const params = new URLSearchParams()
    params.set('tab', tab)
    if (cat) params.set('cat', cat)
    router.replace(`/iptv?${params.toString()}`, { scroll: false })
  }, [router])

  useEffect(() => {
    fetch(`${API_BASE}/api/iptv/status`)
      .then(r => r.json())
      .then(d => setConfigured(d.configured))
      .catch(() => setConfigured(false))
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
    if (configured) loadCategories(section, searchParams.get('cat'))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, section])

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
    if (configured && selectedCat) loadItems(section, selectedCat)
  }, [configured, section, selectedCat, loadItems])

  const filtered = items.filter(item => {
    if (!search) return true
    const name = 'name' in item ? (item as { name: string }).name : ''
    return name.toLowerCase().includes(search.toLowerCase())
  })

  if (configured === null) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-2 border-yt-red border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (!configured) return (
    <div className="flex flex-col items-center justify-center min-h-screen text-center px-4">
      <div className="w-16 h-16 rounded-full bg-yt-secondary flex items-center justify-center mb-4">
        <Tv className="w-8 h-8 text-yt-text-muted" />
      </div>
      <h2 className="text-yt-text text-xl font-semibold mb-2">{t('iptv_not_configured')}</h2>
      <p className="text-yt-text-muted text-sm max-w-sm mb-6">{t('iptv_not_configured_desc')}</p>
    </div>
  )

  const tabs: { id: Section; label: string; icon: React.ReactNode }[] = [
    { id: 'live', label: t('iptv_tab_channels'), icon: <Tv className="w-4 h-4" /> },
    { id: 'vod', label: t('iptv_tab_vod'), icon: <Film className="w-4 h-4" /> },
    { id: 'series', label: t('iptv_tab_series'), icon: <Layers className="w-4 h-4" /> },
  ]

  return (
    <div className="min-h-screen px-4 py-6 max-w-7xl mx-auto">
      <h1 className="text-yt-text text-2xl font-semibold flex items-center gap-2 mb-6">
        <Tv className="w-6 h-6 text-yt-red" />
        {t('iptv_title')}
      </h1>

      {/* Section tabs */}
      <div className="flex gap-2 mb-6">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => { setSection(tab.id); setSelectedCat(null); setSearch('') }}
            className={`flex items-center gap-2 px-5 py-2 rounded-full text-sm font-semibold transition-colors ${
              section === tab.id ? 'bg-yt-text text-yt-bg' : 'bg-yt-secondary text-yt-text-secondary hover:bg-yt-hover'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-yt-text-muted" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('iptv_search')}
          className="w-full max-w-md bg-yt-secondary border border-yt-border rounded-full pl-10 pr-4 py-2 text-sm text-yt-text placeholder-yt-text-muted focus:outline-none focus:border-yt-red"
          style={{ fontSize: '16px' }}
        />
      </div>

      {/* Category pills */}
      {!loadingCats && categories.length > 0 && (
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2 scrollbar-none">
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
          {(filtered as Channel[]).map(ch => (
            <Link
              key={ch.stream_id}
              href={`/iptv/watch/${ch.stream_id}?type=live&name=${encodeURIComponent(ch.name)}&icon=${encodeURIComponent(ch.stream_icon || '')}`}
              className="group flex flex-col items-center gap-2 p-3 rounded-xl bg-yt-secondary hover:bg-yt-hover transition-colors border border-yt-border/30"
            >
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
          {(filtered as VodItem[]).map(v => (
            <Link
              key={v.stream_id}
              href={`/iptv/watch/${v.stream_id}?type=vod&ext=${v.container_extension || 'mp4'}&name=${encodeURIComponent(v.name)}&icon=${encodeURIComponent(v.stream_icon || '')}`}
              className="group flex flex-col rounded-xl overflow-hidden bg-yt-secondary hover:bg-yt-hover transition-colors border border-yt-border/30"
            >
              <div className="relative w-full aspect-[2/3] bg-yt-bg">
                <CoverImage src={v.stream_icon} name={v.name} fallback={<Film className="w-10 h-10 text-yt-text-muted" />} />
              </div>
              <p className="text-yt-text text-xs font-medium line-clamp-2 leading-tight px-2 py-2">{v.name}</p>
            </Link>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {(filtered as SeriesItem[]).map(s => (
            <Link
              key={s.series_id}
              href={`/iptv/series/${s.series_id}?name=${encodeURIComponent(s.name)}&icon=${encodeURIComponent(s.cover || '')}`}
              className="group flex flex-col rounded-xl overflow-hidden bg-yt-secondary hover:bg-yt-hover transition-colors border border-yt-border/30"
            >
              <div className="relative w-full aspect-[2/3] bg-yt-bg">
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
