'use client'

import { useState, useRef, useEffect, useCallback, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Shield, X, Clock, Trash2, Settings, AlertTriangle, RefreshCw } from 'lucide-react'
import { useRegion } from '@/lib/regionContext'
import SettingsPanel from './SettingsPanel'
import Logo from './Logo'
import {
  saveSearchQuery,
  getSearchHistory,
  clearSearchHistory,
  removeSearchEntry,
  type SearchHistoryEntry,
} from '@/lib/searchHistory'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export default function Header() {
  const router = useRouter()
  const { t } = useRegion()
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [history, setHistory] = useState<SearchHistoryEntry[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [vpnConnected, setVpnConnected] = useState(false)
  const [vpnConfName, setVpnConfName] = useState<string | null>(null)
  const [vpnAllFailed, setVpnAllFailed] = useState(false)
  const [vpnRotatedConf, setVpnRotatedConf] = useState<string | null>(null)
  const [shieldTooltip, setShieldTooltip] = useState('')
  const prevConfNameRef = useRef<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const fetchVpnStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/vpn/status`)
      if (res.ok) {
        const data = await res.json()
        const newConf: string | null = data.conf_name ?? null
        setVpnConnected(!!data.running)
        setVpnConfName(newConf)
        setVpnAllFailed(!!data.all_failed)
        if (
          data.running &&
          newConf !== null &&
          prevConfNameRef.current !== null &&
          prevConfNameRef.current !== newConf
        ) {
          setVpnRotatedConf(newConf)
          setTimeout(() => setVpnRotatedConf(null), 5000)
        }
        prevConfNameRef.current = newConf
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

  // Fetch VPN status on mount + poll every 10s
  useEffect(() => {
    fetchVpnStatus()
    fetchShieldTooltip()
    const interval = setInterval(fetchVpnStatus, 10_000)
    return () => clearInterval(interval)
  }, [fetchVpnStatus, fetchShieldTooltip])

  // "/" or Cmd/Ctrl+K focuses search, unless the user is already typing somewhere
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const typing = target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      const isK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'
      if (isK || (e.key === '/' && !typing)) {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      } else if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        inputRef.current?.blur()
        setFocused(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Load history when dropdown opens
  useEffect(() => {
    if (focused) setHistory(getSearchHistory())
  }, [focused])

  // Close search dropdown on outside click
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setFocused(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  function handleSearch(e?: FormEvent, q?: string) {
    e?.preventDefault()
    const term = (q ?? query).trim()
    if (!term) return
    saveSearchQuery(term)
    setQuery(term)
    setFocused(false)
    router.push(`/search?q=${encodeURIComponent(term)}`)
  }

  function clearSearch() {
    setQuery('')
    inputRef.current?.focus()
  }

  function handleRemoveEntry(entry: string, e: React.MouseEvent) {
    e.stopPropagation()
    removeSearchEntry(entry)
    setHistory(getSearchHistory())
  }

  function handleClearAll(e: React.MouseEvent) {
    e.stopPropagation()
    clearSearchHistory()
    setHistory([])
  }

  const filtered = query.trim()
    ? history.filter((h) => h.query.toLowerCase().includes(query.toLowerCase()))
    : history

  const showDropdown = focused && filtered.length > 0

  return (
    <>
    {/* VPN all-failed toast */}
    {vpnAllFailed && (
      <div role="alert" className="fixed top-[72px] left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-red-600/95 backdrop-blur-xl text-white text-sm shadow-elevated max-w-sm w-[calc(100%-2rem)] animate-fade-up">
        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
        <span className="flex-1">{t('settings_vpn_all_failed')}</span>
        <button onClick={() => setVpnAllFailed(false)} className="ml-1 p-1 rounded-full hover:bg-white/15 transition-colors" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </div>
    )}
    {/* VPN rotation toast — anchored top-right near the shield */}
    {vpnRotatedConf && (
      <div role="status" className="fixed top-[72px] right-4 z-50 flex items-center gap-2 px-3.5 py-2.5 rounded-2xl glass text-emerald-400 text-xs shadow-elevated animate-fade-up">
        <RefreshCw className="w-3.5 h-3.5 flex-shrink-0" />
        <span>{t('settings_vpn_rotated')} <span className="font-semibold text-yt-text">{vpnRotatedConf.replace(/\.conf$/, '')}</span></span>
      </div>
    )}
    <header className="fixed top-0 left-0 right-0 z-50 flex items-center h-14 px-3 sm:px-5 gap-3 bg-yt-bg/70 backdrop-blur-2xl backdrop-saturate-150 border-b border-yt-border/40">
      <Logo />

      {/* Search bar */}
      <form onSubmit={handleSearch} role="search" className="relative flex-1 max-w-xl mx-auto">
        <div className={`group flex items-center h-10 rounded-full border transition-all duration-200 ${
          focused
            ? 'border-yt-red/50 bg-yt-secondary shadow-[0_0_0_4px_rgb(var(--yt-red)/0.12)]'
            : 'border-yt-border/70 bg-yt-secondary/70 hover:border-yt-border'
        }`}>
          <Search className={`ml-3.5 w-[18px] h-[18px] flex-shrink-0 transition-colors ${focused ? 'text-yt-red' : 'text-yt-text-muted'}`} />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            placeholder={t('search_placeholder')}
            aria-label={t('search_placeholder')}
            enterKeyHint="search"
            className="flex-1 min-w-0 bg-transparent px-3 text-sm text-yt-text placeholder-yt-text-muted focus:outline-none [&::-webkit-search-cancel-button]:hidden"
            style={{ fontSize: '16px', touchAction: 'manipulation' }}
          />
          {query ? (
            <button type="button" onClick={clearSearch} className="mr-1.5 p-1.5 rounded-full hover:bg-yt-hover text-yt-text-secondary transition-colors" aria-label="Clear">
              <X className="w-4 h-4" />
            </button>
          ) : (
            <kbd className="hidden md:inline-flex mr-3 items-center rounded-md border border-yt-border/80 px-1.5 text-[11px] font-medium text-yt-text-muted">/</kbd>
          )}
        </div>

        {/* Search history dropdown */}
        {showDropdown && (
          <div
            ref={dropdownRef}
            className="absolute top-full left-0 right-0 mt-2 glass rounded-2xl shadow-elevated z-50 overflow-hidden animate-fade-in"
          >
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <span className="text-[11px] font-semibold text-yt-text-muted uppercase tracking-[0.08em]">
                {t('searchHistory_recent')}
              </span>
              <button
                type="button"
                onClick={handleClearAll}
                className="text-xs text-yt-text-muted hover:text-yt-red transition-colors flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" />
                {t('searchHistory_clearAll')}
              </button>
            </div>
            <div className="pb-2">
              {filtered.slice(0, 8).map((entry) => (
                <div
                  key={entry.query}
                  className="flex items-center gap-3 mx-2 px-3 py-2 rounded-xl hover:bg-yt-hover/80 cursor-pointer group"
                  onMouseDown={(e) => { e.preventDefault(); handleSearch(undefined, entry.query) }}
                >
                  <Clock className="w-4 h-4 text-yt-text-muted flex-shrink-0" />
                  <span className="flex-1 text-sm text-yt-text truncate">{entry.query}</span>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); handleRemoveEntry(entry.query, e) }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded-full hover:bg-yt-secondary text-yt-text-muted transition-opacity"
                    aria-label="Remove"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </form>

      {/* Right actions */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
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

        <button
          onClick={() => setShowSettings(true)}
          aria-label={t('settings_title')}
          title={t('settings_title')}
          className="hidden md:flex items-center justify-center w-9 h-9 rounded-full hover:bg-yt-hover text-yt-text-secondary hover:text-yt-text transition-all hover:rotate-45 duration-300"
        >
          <Settings className="w-[18px] h-[18px]" />
        </button>
      </div>

    </header>
    {/* Outside <header>: its backdrop-filter would become the containing block
        of the panel's position:fixed and clip it to the header's box */}
    <SettingsPanel open={showSettings} onClose={() => { setShowSettings(false); fetchVpnStatus(); fetchShieldTooltip() }} />
    </>
  )
}
