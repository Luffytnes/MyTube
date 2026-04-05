'use client'

import { useState, useRef, useEffect, FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Search, Mic, Shield, Play, X, Sun, Moon, Monitor, Clock, Trash2, Check } from 'lucide-react'
import { useRegion } from '@/lib/regionContext'
import { useTheme, type ThemeMode } from '@/lib/themeContext'
import RegionSelector from './RegionSelector'
import InvidiousSelector from './InvidiousSelector'
import {
  saveSearchQuery,
  getSearchHistory,
  clearSearchHistory,
  removeSearchEntry,
  type SearchHistoryEntry,
} from '@/lib/searchHistory'

export default function Header() {
  const router = useRouter()
  const { t } = useRegion()
  const { mode, theme, setMode } = useTheme()
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [history, setHistory] = useState<SearchHistoryEntry[]>([])
  const [showThemeMenu, setShowThemeMenu] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const themeMenuRef = useRef<HTMLDivElement>(null)

  // Load history when dropdown opens
  useEffect(() => {
    if (focused) setHistory(getSearchHistory())
  }, [focused])

  // Close dropdowns on outside click
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
      if (themeMenuRef.current && !themeMenuRef.current.contains(e.target as Node)) {
        setShowThemeMenu(false)
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
    <header className="fixed top-0 left-0 right-0 z-50 flex items-center h-14 px-4 bg-yt-bg border-b border-yt-border/40">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-1.5 mr-4 flex-shrink-0 group" aria-label="MyTube Home">
        <div className="flex items-center justify-center w-8 h-8 bg-yt-red rounded group-hover:bg-yt-red-hover transition-colors">
          <Play className="w-4 h-4 text-white fill-white ml-0.5" />
        </div>
        <span className="text-yt-text font-bold text-xl tracking-tight hidden sm:block">MyTube</span>
      </Link>

      {/* Search bar */}
      <form onSubmit={handleSearch} className="flex-1 flex items-center justify-center max-w-2xl mx-auto gap-2 relative">
        <div className={`flex items-center flex-1 h-10 rounded-full border transition-colors ${
          focused ? 'border-[#1c62b9] bg-yt-bg' : 'border-yt-border bg-yt-secondary'
        }`}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            placeholder={t('search_placeholder')}
            aria-label={t('search_placeholder')}
            className="flex-1 bg-transparent px-4 text-sm text-yt-text placeholder-yt-text-muted focus:outline-none"
          />
          {query && (
            <button type="button" onClick={clearSearch} className="mr-2 p-1 rounded-full hover:bg-yt-hover text-yt-text-secondary" aria-label="Clear">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <button type="submit" aria-label={t('search_placeholder')} className="flex items-center justify-center w-10 h-10 rounded-full bg-yt-secondary hover:bg-yt-hover border border-yt-border text-yt-text-secondary hover:text-yt-text transition-colors flex-shrink-0">
          <Search className="w-5 h-5" />
        </button>
        <button type="button" aria-label="Voice search" className="flex items-center justify-center w-10 h-10 rounded-full bg-yt-secondary hover:bg-yt-hover border border-yt-border text-yt-text-secondary hover:text-yt-text transition-colors flex-shrink-0">
          <Mic className="w-5 h-5" />
        </button>

        {/* Search history dropdown */}
        {showDropdown && (
          <div
            ref={dropdownRef}
            className="absolute top-full left-0 right-12 mt-1 bg-yt-secondary border border-yt-border rounded-xl shadow-2xl z-50 overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-2 border-b border-yt-border/50">
              <span className="text-xs font-semibold text-yt-text-muted uppercase tracking-wide">
                {t('searchHistory_recent')}
              </span>
              <button
                type="button"
                onClick={handleClearAll}
                className="text-xs text-yt-text-muted hover:text-yt-text transition-colors flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" />
                {t('searchHistory_clearAll')}
              </button>
            </div>
            {filtered.slice(0, 8).map((entry) => (
              <div
                key={entry.query}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-yt-hover cursor-pointer group"
                onMouseDown={(e) => { e.preventDefault(); handleSearch(undefined, entry.query) }}
              >
                <Clock className="w-4 h-4 text-yt-text-muted flex-shrink-0" />
                <span className="flex-1 text-sm text-yt-text truncate">{entry.query}</span>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); handleRemoveEntry(entry.query, e) }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded-full hover:bg-yt-hover text-yt-text-muted transition-opacity"
                  aria-label="Remove"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </form>

      {/* Right actions */}
      <div className="flex items-center gap-2 ml-4 flex-shrink-0">
        <RegionSelector />
        <InvidiousSelector />

        {/* Theme dropdown */}
        <div ref={themeMenuRef} className="relative">
          <button
            onClick={() => setShowThemeMenu((v) => !v)}
            aria-label="Theme"
            className="flex items-center justify-center w-9 h-9 rounded-full hover:bg-yt-hover text-yt-text-secondary hover:text-yt-text transition-colors"
          >
            {theme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>

          {showThemeMenu && (
            <div className="absolute right-0 top-full mt-1 bg-yt-secondary border border-yt-border rounded-xl shadow-2xl py-1 z-50 min-w-[150px]">
              {([
                { value: 'light' as ThemeMode, label: 'Clair', icon: Sun },
                { value: 'dark' as ThemeMode, label: 'Sombre', icon: Moon },
                { value: 'auto' as ThemeMode, label: 'Automatique', icon: Monitor },
              ]).map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => { setMode(value); setShowThemeMenu(false) }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-yt-hover transition-colors text-yt-text"
                >
                  <Icon className="w-4 h-4 text-yt-text-muted flex-shrink-0" />
                  <span className="flex-1 text-left">{label}</span>
                  {mode === value && <Check className="w-3.5 h-3.5 text-yt-red" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div
          className="flex items-center gap-1.5 px-3 h-8 rounded-full bg-yt-secondary border border-yt-border text-xs text-yt-text-secondary hover:text-yt-text hover:bg-yt-hover cursor-default transition-colors"
          title="Privacy-focused: no tracking, no ads, no Google fonts"
        >
          <Shield className="w-3.5 h-3.5 text-green-400" />
          <span className="hidden md:block">{t('privacy_badge')}</span>
        </div>
      </div>
    </header>
  )
}
