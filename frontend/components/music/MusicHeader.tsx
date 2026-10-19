'use client'

import { useState, useEffect, useCallback, FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Search, X, Shield } from 'lucide-react'
import { saveMusicSearchQuery } from '@/lib/musicSearchHistory'
import { useRegion } from '@/lib/regionContext'
import Logo from '@/components/layout/Logo'

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
    <header className="fixed top-0 left-0 right-0 z-50 flex items-center h-14 px-3 sm:px-5 gap-3 bg-yt-bg/70 backdrop-blur-2xl backdrop-saturate-150 border-b border-yt-border/40">
      <Logo href="/music" suffix="Music" />

      {/* Search bar */}
      <form onSubmit={handleSearch} role="search" className="flex-1 max-w-xl mx-auto">
        <div className="group flex items-center h-10 rounded-full border border-yt-border/70 bg-yt-secondary/70 px-3.5 gap-2.5 transition-all duration-200 hover:border-yt-border focus-within:border-yt-red/50 focus-within:bg-yt-secondary focus-within:shadow-[0_0_0_4px_rgb(var(--yt-red)/0.12)]">
          <Search className="w-[18px] h-[18px] text-yt-text-muted group-focus-within:text-yt-red transition-colors flex-shrink-0" />
          <input
            type="search"
            enterKeyHint="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('music_search_placeholder')}
            className="flex-1 min-w-0 bg-transparent text-sm text-yt-text placeholder-yt-text-muted focus:outline-none [&::-webkit-search-cancel-button]:hidden"
            style={{ fontSize: '16px', touchAction: 'manipulation' }}
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} className="text-yt-text-muted hover:text-yt-text transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </form>

      {/* Right */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <div
          className="flex items-center gap-2 pl-2.5 pr-3 h-9 rounded-full border border-yt-border/70 bg-yt-secondary/60 text-xs font-medium text-yt-text-secondary cursor-default"
          title={shieldTooltip || (vpnConnected ? 'VPN actif' : 'Sans VPN — votre IP réelle est utilisée')}
        >
          <span className="relative flex w-2 h-2">
            {vpnConnected && <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60" />}
            <span className={`relative w-2 h-2 rounded-full ${vpnConnected ? 'bg-emerald-400' : 'bg-amber-400'}`} />
          </span>
          <Shield className={`w-3.5 h-3.5 ${vpnConnected ? 'text-emerald-400' : 'text-yt-text-muted'}`} />
          <span className="hidden md:block">{t('privacy_badge')}</span>
        </div>

        <Link
          href="/"
          className="hidden sm:flex items-center gap-1.5 px-3.5 h-9 rounded-full border border-yt-border/70 bg-yt-secondary/60 hover:bg-yt-hover text-xs font-medium text-yt-text-secondary hover:text-yt-text transition-colors"
        >
          ← {t('music_back')}
        </Link>
      </div>

    </header>
  )
}
