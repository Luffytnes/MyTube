'use client'

import { useState, useRef, useEffect, FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Music2, Search, X, Sun, Moon, Monitor, Check, Shield } from 'lucide-react'
import { useTheme, type ThemeMode } from '@/lib/themeContext'
import { saveMusicSearchQuery } from '@/lib/musicSearchHistory'
import RegionSelector from '@/components/layout/RegionSelector'
import InvidiousSelector from '@/components/layout/InvidiousSelector'
import { useRegion } from '@/lib/regionContext'

export default function MusicHeader() {
  const router = useRouter()
  const { mode, theme, setMode } = useTheme()
  const { t } = useRegion()
  const [query, setQuery] = useState('')
  const [showThemeMenu, setShowThemeMenu] = useState(false)
  const themeMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (themeMenuRef.current && !themeMenuRef.current.contains(e.target as Node)) {
        setShowThemeMenu(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

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
      <form onSubmit={handleSearch} className="flex-1 flex items-center max-w-xl mx-auto gap-2">
        <div className="flex-1 flex items-center h-10 rounded-full border border-yt-border bg-yt-secondary px-4 gap-2 focus-within:border-yt-red transition-colors">
          <Search className="w-4 h-4 text-yt-text-muted flex-shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('music_search_placeholder')}
            className="flex-1 bg-transparent text-sm text-yt-text placeholder-yt-text-muted focus:outline-none"
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
        <RegionSelector />
        <InvidiousSelector />

        {/* Theme */}
        <div ref={themeMenuRef} className="relative">
          <button
            onClick={() => setShowThemeMenu((v) => !v)}
            className="flex items-center justify-center w-9 h-9 rounded-full hover:bg-yt-hover text-yt-text-secondary hover:text-yt-text transition-colors"
          >
            {theme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>
          {showThemeMenu && (
            <div className="absolute right-0 top-full mt-1 bg-yt-secondary border border-yt-border rounded-xl shadow-2xl py-1 z-50 min-w-[150px]">
              {([
                { value: 'light' as ThemeMode, labelKey: 'theme_light', icon: Sun },
                { value: 'dark' as ThemeMode, labelKey: 'theme_dark', icon: Moon },
                { value: 'auto' as ThemeMode, labelKey: 'theme_auto', icon: Monitor },
              ] as const).map(({ value, labelKey, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => { setMode(value); setShowThemeMenu(false) }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-yt-hover transition-colors text-yt-text"
                >
                  <Icon className="w-4 h-4 text-yt-text-muted flex-shrink-0" />
                  <span className="flex-1 text-left">{t(labelKey)}</span>
                  {mode === value && <Check className="w-3.5 h-3.5 text-yt-red" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Privacy badge */}
        <div
          className="flex items-center gap-1.5 px-3 h-8 rounded-full bg-yt-secondary border border-yt-border text-xs text-yt-text-secondary cursor-default"
          title="Privacy-focused: no tracking, no ads, no Google fonts"
        >
          <Shield className="w-3.5 h-3.5 text-green-400" />
          <span className="hidden md:block">{t('privacy_badge')}</span>
        </div>

        {/* Back to MyTube */}
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
