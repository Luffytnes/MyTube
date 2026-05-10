'use client'

import { useState, useEffect, useCallback } from 'react'
import { Search, Tv, Radio } from 'lucide-react'
import { useRegion } from '@/lib/regionContext'
import Link from 'next/link'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

interface Category { category_id: string; category_name: string; parent_id: number }
interface Channel {
  stream_id: number; name: string; stream_icon: string
  epg_channel_id: string; added: string; category_id: string
  stream_type: string; num: number
}

export default function IPTVPage() {
  const { t } = useRegion()
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [selectedCat, setSelectedCat] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${API_BASE}/api/iptv/status`)
      .then(r => r.json())
      .then(d => setConfigured(d.configured))
      .catch(() => setConfigured(false))
  }, [])

  useEffect(() => {
    if (!configured) return
    fetch(`${API_BASE}/api/iptv/categories`)
      .then(r => r.json())
      .then(d => Array.isArray(d) ? setCategories(d) : setCategories([]))
      .catch(() => {})
  }, [configured])

  const loadChannels = useCallback(async (catId: string | null) => {
    setLoading(true)
    setError(null)
    try {
      const url = catId
        ? `${API_BASE}/api/iptv/channels?category_id=${catId}`
        : `${API_BASE}/api/iptv/channels`
      const res = await fetch(url)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setChannels(Array.isArray(data) ? data : [])
    } catch {
      setError(t('iptv_error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (configured) loadChannels(selectedCat)
  }, [configured, selectedCat, loadChannels])

  const filtered = channels.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase())
  )

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

  return (
    <div className="min-h-screen px-4 py-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-yt-text text-2xl font-semibold flex items-center gap-2">
          <Tv className="w-6 h-6 text-yt-red" />
          {t('iptv_title')}
        </h1>
      </div>

      {/* Search */}
      <div className="relative mb-6">
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

      {/* Categories */}
      {categories.length > 0 && (
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2 scrollbar-hide">
          <button
            onClick={() => setSelectedCat(null)}
            className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              !selectedCat ? 'bg-yt-text text-yt-bg' : 'bg-yt-secondary text-yt-text-secondary hover:bg-yt-hover'
            }`}
          >
            {t('iptv_all_cats')}
          </button>
          {categories.map(cat => (
            <button
              key={cat.category_id}
              onClick={() => setSelectedCat(cat.category_id)}
              className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                selectedCat === cat.category_id ? 'bg-yt-text text-yt-bg' : 'bg-yt-secondary text-yt-text-secondary hover:bg-yt-hover'
              }`}
            >
              {cat.category_name}
            </button>
          ))}
        </div>
      )}

      {/* Channels grid */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 border-yt-red border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="text-center py-20">
          <p className="text-yt-text-muted">{error}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {filtered.map(channel => (
            <Link
              key={channel.stream_id}
              href={`/iptv/watch/${channel.stream_id}?name=${encodeURIComponent(channel.name)}&icon=${encodeURIComponent(channel.stream_icon || '')}`}
              className="group flex flex-col items-center gap-2 p-3 rounded-xl bg-yt-secondary hover:bg-yt-hover transition-colors border border-yt-border/30 cursor-pointer"
            >
              <div className="w-16 h-16 rounded-xl bg-yt-bg flex items-center justify-center overflow-hidden">
                {channel.stream_icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={channel.stream_icon} alt={channel.name} className="w-full h-full object-contain p-1" onError={e => { (e.target as HTMLImageElement).style.display='none' }} />
                ) : (
                  <Radio className="w-8 h-8 text-yt-text-muted" />
                )}
              </div>
              <p className="text-yt-text text-xs font-medium text-center line-clamp-2 leading-tight">{channel.name}</p>
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
