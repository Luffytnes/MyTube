'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Home, Search, Tv, Film, Layers, Star, ChevronLeft, MoreHorizontal, X, Settings, Radio } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRegion } from '@/lib/regionContext'
import type { Translations } from '@/lib/translations'
import { getTvFavorites, type TvFavorite } from '@/lib/tvFavorites'
import SettingsPanel from '@/components/layout/SettingsPanel'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

const NAV_KEYS: { icon: typeof Home; labelKey: keyof Translations; href: string; exact?: boolean }[] = [
  { icon: Home, labelKey: 'tv_home', href: '/tv', exact: true },
  { icon: Tv, labelKey: 'iptv_tab_channels', href: '/tv?tab=live' },
  { icon: Film, labelKey: 'iptv_tab_vod', href: '/tv?tab=vod' },
  { icon: Layers, labelKey: 'iptv_tab_series', href: '/tv?tab=series' },
  { icon: Search, labelKey: 'music_search', href: '/tv/search' },
  { icon: Star, labelKey: 'tv_favorites', href: '/tv/favorites' },
]

const FAV_ICON: Record<string, typeof Home> = {}

export default function TvSidebar() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { t } = useRegion()
  const [favorites, setFavorites] = useState<TvFavorite[]>([])
  const [showMoreDrawer, setShowMoreDrawer] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    setFavorites(getTvFavorites())
    function onFocus() { setFavorites(getTvFavorites()) }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  useEffect(() => { setShowMoreDrawer(false) }, [pathname])

  function isActive(href: string, exact?: boolean) {
    const [path, qs] = href.split('?')
    if (exact) return pathname === path && !searchParams.get('tab')
    if (qs) {
      const tab = new URLSearchParams(qs).get('tab')
      return pathname === path && searchParams.get('tab') === tab
    }
    return pathname.startsWith(path) && path !== '/tv'
  }

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────────── */}
      <aside className="fixed left-0 top-14 bottom-0 z-40 hidden md:flex flex-col w-20 xl:w-56 bg-yt-bg border-r border-yt-border/40 pt-3 pb-4 overflow-y-auto overflow-x-hidden">
        <nav className="flex flex-col gap-0.5 px-2">
          {NAV_KEYS.map(({ icon: Icon, labelKey, href, exact }) => {
            const active = isActive(href, exact)
            const label = t(labelKey)
            return (
              <Link
                key={href}
                href={href}
                title={label}
                className={cn(
                  'flex items-center gap-4 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors group',
                  active ? 'bg-yt-hover text-yt-text' : 'text-yt-text-secondary hover:bg-yt-hover hover:text-yt-text'
                )}
              >
                <Icon className={cn('w-5 h-5 flex-shrink-0 transition-colors', active ? 'text-yt-red' : 'text-yt-text-secondary group-hover:text-yt-red')} />
                <span className="hidden xl:block truncate">{label}</span>
              </Link>
            )
          })}
        </nav>

        {/* Favorites section — films/séries seulement (pas les chaînes) */}
        {favorites.filter(f => f.type !== 'live').length > 0 && (
          <>
            <div className="border-t border-yt-border/40 my-3 mx-3" />
            <div className="px-2">
              <p className="hidden xl:block px-3 pb-2 text-xs font-semibold text-yt-text-muted uppercase tracking-wider truncate">
                {t('tv_favorites')}
              </p>
              <div className="flex flex-col gap-0.5">
                {favorites.filter(f => f.type !== 'live').slice(0, 4).map((fav) => {
                  const active = pathname.includes(fav.id)
                  return (
                    <Link
                      key={`${fav.type}-${fav.id}`}
                      href={
                        fav.type === 'series'
                          ? `/tv/series/${fav.id}?name=${encodeURIComponent(fav.name)}&icon=${encodeURIComponent(fav.icon)}`
                          : `/tv/watch/${fav.id}?type=${fav.type === 'live' ? 'live' : 'vod'}&ext=${fav.ext ?? 'mp4'}&media=${fav.media ?? 'movie'}&name=${encodeURIComponent(fav.name)}&icon=${encodeURIComponent(fav.icon)}`
                      }
                      title={fav.name}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-colors group',
                        active ? 'bg-yt-hover text-yt-text' : 'text-yt-text-secondary hover:bg-yt-hover hover:text-yt-text'
                      )}
                    >
                      <div className="w-6 h-6 rounded flex-shrink-0 overflow-hidden bg-yt-secondary flex items-center justify-center">
                        {fav.icon ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`${API_BASE}/api/iptv/icon?url=${encodeURIComponent(fav.icon)}`}
                            alt=""
                            className="w-full h-full object-contain p-0.5"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                          />
                        ) : (
                          <Radio className="w-3.5 h-3.5 text-yt-text-muted" />
                        )}
                      </div>
                      <span className="hidden xl:block truncate text-sm">{fav.name}</span>
                    </Link>
                  )
                })}
                {favorites.filter(f => f.type !== 'live').length > 4 && (
                  <Link
                    href="/tv/favorites"
                    className="hidden xl:flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-yt-text-muted hover:bg-yt-hover hover:text-yt-text transition-colors"
                  >
                    <span className="w-6 h-6 flex-shrink-0 flex items-center justify-center text-xs font-bold">+{favorites.filter(f => f.type !== 'live').length - 4}</span>
                    <span>Plus...</span>
                  </Link>
                )}
              </div>
            </div>
          </>
        )}

        <div className="border-t border-yt-border/40 my-3 mx-3" />
        <nav className="px-2">
          <Link
            href="/"
            title={t('tv_back')}
            className="flex items-center gap-4 px-3 py-2.5 rounded-xl text-sm font-medium text-yt-text-secondary hover:bg-yt-hover hover:text-yt-text transition-colors group"
          >
            <ChevronLeft className="w-5 h-5 flex-shrink-0 group-hover:text-yt-text transition-colors" />
            <span className="hidden xl:block truncate">{t('tv_back')}</span>
          </Link>
        </nav>
      </aside>

      {/* ── Mobile bottom nav — floating pill ───────────────── */}
      <nav
        className="fixed left-1/2 -translate-x-1/2 z-40 md:hidden flex items-center justify-around h-20 px-4 rounded-2xl bg-yt-bg/95 backdrop-blur-xl border border-yt-border/30 shadow-[0_8px_32px_rgba(0,0,0,0.45)] w-[360px] max-w-[calc(100vw-16px)]"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}
      >
        {NAV_KEYS.slice(0, 4).map(({ icon: Icon, labelKey, href, exact }) => {
          const active = isActive(href, exact)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center gap-1 py-2 px-2 rounded-xl transition-colors flex-1',
                active ? 'text-yt-red' : 'text-yt-text-muted hover:text-yt-text'
              )}
            >
              <Icon className="w-6 h-6" />
              <span className="text-[11px] truncate max-w-[52px] text-center leading-tight">{t(labelKey)}</span>
            </Link>
          )
        })}
        <button
          onClick={() => setShowMoreDrawer((v) => !v)}
          className={cn(
            'flex flex-col items-center gap-1 py-2 px-2 rounded-xl transition-colors flex-1',
            showMoreDrawer ? 'text-yt-red' : 'text-yt-text-muted hover:text-yt-text'
          )}
        >
          <MoreHorizontal className="w-6 h-6" />
          <span className="text-[11px]">Plus</span>
        </button>
      </nav>

      {/* ── Mobile drawer ───────────────────────────────────── */}
      {showMoreDrawer && (
        <>
          <div className="fixed inset-0 z-[45] md:hidden" onClick={() => setShowMoreDrawer(false)} />
          <div
            className="fixed left-0 right-0 z-[46] md:hidden bg-yt-bg rounded-t-2xl shadow-2xl max-h-[80vh] overflow-y-auto"
            style={{ bottom: 'calc(env(safe-area-inset-bottom) + 100px)' }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-yt-border/40">
              <p className="text-sm font-semibold text-yt-text">MyTube TV</p>
              <button onClick={() => setShowMoreDrawer(false)} className="text-yt-text-muted hover:text-yt-text">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="py-2">
              {NAV_KEYS.map(({ icon: Icon, labelKey, href, exact }) => {
                const active = isActive(href, exact)
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      'flex items-center gap-4 px-4 py-3 text-sm transition-colors',
                      active ? 'text-yt-text font-medium' : 'text-yt-text-secondary hover:bg-yt-hover hover:text-yt-text'
                    )}
                  >
                    <Icon className={cn('w-5 h-5 flex-shrink-0', active ? 'text-yt-red' : 'text-yt-text-secondary')} />
                    {t(labelKey)}
                  </Link>
                )
              })}

              {favorites.length > 0 && (
                <>
                  <div className="border-t border-yt-border/40 my-2 mx-4" />
                  <p className="px-4 pb-1 text-xs font-semibold text-yt-text-muted uppercase tracking-wider">{t('tv_favorites')}</p>
                  {favorites.map((fav) => (
                    <Link
                      key={`${fav.type}-${fav.id}`}
                      href={
                        fav.type === 'series'
                          ? `/tv/series/${fav.id}?name=${encodeURIComponent(fav.name)}&icon=${encodeURIComponent(fav.icon)}`
                          : `/tv/watch/${fav.id}?type=${fav.type === 'live' ? 'live' : 'vod'}&ext=${fav.ext ?? 'mp4'}&media=${fav.media ?? 'movie'}&name=${encodeURIComponent(fav.name)}&icon=${encodeURIComponent(fav.icon)}`
                      }
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-yt-text-secondary hover:bg-yt-hover hover:text-yt-text transition-colors"
                    >
                      <div className="w-7 h-7 rounded flex-shrink-0 overflow-hidden bg-yt-secondary flex items-center justify-center">
                        {fav.icon ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`${API_BASE}/api/iptv/icon?url=${encodeURIComponent(fav.icon)}`}
                            alt=""
                            className="w-full h-full object-contain p-0.5"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                          />
                        ) : (
                          <Radio className="w-4 h-4 text-yt-text-muted" />
                        )}
                      </div>
                      <span className="truncate">{fav.name}</span>
                    </Link>
                  ))}
                </>
              )}

              <div className="border-t border-yt-border/40 my-2 mx-4" />
              <button
                onClick={() => { setShowMoreDrawer(false); setShowSettings(true) }}
                className="w-full flex items-center gap-4 px-4 py-3 text-sm text-yt-text-secondary hover:bg-yt-hover hover:text-yt-text transition-colors"
              >
                <Settings className="w-5 h-5 flex-shrink-0" />
                {t('settings_title')}
              </button>
              <Link
                href="/"
                className="flex items-center gap-4 px-4 py-3 text-sm text-yt-text-secondary hover:bg-yt-hover hover:text-yt-text transition-colors"
              >
                <ChevronLeft className="w-5 h-5 flex-shrink-0" />
                {t('tv_back')}
              </Link>
            </div>
          </div>
        </>
      )}

      <SettingsPanel open={showSettings} onClose={() => setShowSettings(false)} />
    </>
  )
}
