'use client'

import { useState, useEffect, useCallback, FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Music2, Search, X, Shield } from 'lucide-react'
import { saveMusicSearchQuery } from '@/lib/musicSearchHistory'
import { useRegion } from '@/lib/regionContext'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export default function MusicHeader() {
  const router = useRouter()
  const { t } = useRegion()
  const [query, setQuery] = useState('')
  const [vpnConnected, setVpnConnected] = useState(false)
  const [shieldTooltip, setShieldTooltip] = useState('')

  const fetchVpnStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/vpn/status`)
      if (res.ok) {
        const data = await res.json()
        setVpnConnected(!!data.running)
      }
    } catch {}
  }, [])

  const fetchShieldTooltip = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/vpn/myip`)
      if (res.ok) {
        const d = await res.json()
        const parts = [d.ip, d.city, d.country].filter(Boolean).join(' — ')
        const org = d.org ? `\n${d.org}` : ''
        setShieldTooltip(parts + org)
      } else {
        setShieldTooltip('')
      }
    } catch {
      setShieldTooltip('')
    }
  }, [])

  useEffect(() => {
    fetchVpnStatus()
    fetchShieldTooltip()
  }, [fetchVpnStatus, fetchShieldTooltip])

  function handleSearch(e: FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    saveMusicSearchQuery(q)
    router.push(`/music/search?q=${encodeURIComponent(q)}`)
  }

  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex items-center h-14 px-4 bg-yt-bg border-b border-yt-border/40 gap-4">
      {/* Logo */}
      <Link href="/music" className="flex items-center gap-2 flex-shrink-0 group">
        <div className="flex items-center justify-center w-8 h-8 bg-yt-red rounded-full group-hover:bg-yt-red-hover transition-colors">
          <Music2 className="w-4 h-4 text-white" />
        </div>
        <div className="hidden sm:flex flex-col leading-none">
          <span className="text-yt-text font-bold text-base tracking-tight">MyTube</span>
          <span className="text-yt-red text-[10px] font-semibold tracking-widest uppercase">Music</span>
        </div>
      </Link>

      {/* Search bar */}
      <form onSubmit={handleSearch} className="flex-1 flex items-center max-w-lg mx-auto gap-2">
        <div className="flex-1 flex items-center h-10 rounded-full border border-yt-border bg-yt-secondary px-4 gap-2 focus-within:border-yt-red transition-colors">
          <Search className="w-4 h-4 text-yt-text-muted flex-shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('music_search_placeholder')}
            className="flex-1 bg-transparent text-sm text-yt-text placeholder-yt-text-muted focus:outline-none"
            style={{ fontSize: '16px', touchAction: 'manipulation' }}
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} className="text-yt-text-muted hover:text-yt-text transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <button type="submit" className="flex items-center justify-center w-10 h-10 rounded-full bg-yt-secondary hover:bg-yt-hover border border-yt-border text-yt-text-secondary hover:text-yt-text transition-colors flex-shrink-0">
          <Search className="w-4 h-4" />
        </button>
      </form>

      {/* Right */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <div
          className="flex items-center gap-1.5 px-3 h-8 rounded-full bg-yt-secondary border border-yt-border text-xs text-yt-text-secondary cursor-default"
          title={shieldTooltip || (vpnConnected ? 'VPN actif' : 'Sans VPN — votre IP réelle est utilisée')}
        >
          <Shield className={`w-3.5 h-3.5 ${vpnConnected ? 'text-green-400' : 'text-red-400'}`} />
          <span className="hidden md:block">{t('privacy_badge')}</span>
        </div>

        <Link
          href="/"
          className="hidden sm:flex items-center gap-1.5 px-3 h-9 rounded-full bg-yt-secondary hover:bg-yt-hover border border-yt-border text-xs text-yt-text-secondary hover:text-yt-text transition-colors"
        >
          ← {t('music_back')}
        </Link>
      </div>

    </header>
  )
}
