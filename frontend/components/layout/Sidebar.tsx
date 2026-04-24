'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Home, TrendingUp, History, Clock, Music2, ThumbsUp,
  ListVideo, ListOrdered, Newspaper, Settings, MoreHorizontal, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRegion } from '@/lib/regionContext'
import { useSubscriptions } from '@/lib/subscriptionsContext'
import type { Translations } from '@/lib/translations'
import SettingsPanel from './SettingsPanel'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

const NAV_ITEMS: { icon: typeof Home; labelKey: keyof Translations; href: string }[] = [
  { icon: Home, labelKey: 'nav_home', href: '/' },
  { icon: TrendingUp, labelKey: 'nav_trending', href: '/trending' },
  { icon: History, labelKey: 'nav_history', href: '/history' },
  { icon: Clock, labelKey: 'nav_watchLater', href: '/watch-later' },
  { icon: ThumbsUp, labelKey: 'nav_likes', href: '/likes' },
  { icon: ListVideo, labelKey: 'nav_playlists', href: '/playlists' },
  { icon: ListOrdered, labelKey: 'nav_queue', href: '/queue' },
]

// Items shown in mobile bottom bar
const MOBILE_PRIMARY: (keyof Translations)[] = ['nav_home', 'nav_trending', 'nav_music', 'nav_history']

const SUB_PREVIEW = 4

export default function Sidebar() {
  const pathname = usePathname()
  const { t } = useRegion()
  const { subscriptions } = useSubscriptions()
  const [showAllSubs, setShowAllSubs] = useState(false)
  const [showDrawer, setShowDrawer] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const drawerRef = useRef<HTMLDivElement>(null)

  function isActive(href: string) {
    if (href === '/') return pathname === '/'
    return pathname === href || pathname.startsWith(href.split('?')[0] + '/')
  }

  // Close drawer on outside tap
  useEffect(() => {
    if (!showDrawer) return
    function onTap(e: MouseEvent | TouchEvent) {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        setShowDrawer(false)
      }
    }
    document.addEventListener('mousedown', onTap)
    document.addEventListener('touchstart', onTap)
    return () => {
      document.removeEventListener('mousedown', onTap)
      document.removeEventListener('touchstart', onTap)
    }
  }, [showDrawer])

  // Close drawer on navigation
  useEffect(() => { setShowDrawer(false) }, [pathname])

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────────── */}
      <aside className="fixed left-0 top-14 bottom-0 z-40 hidden md:flex flex-col w-20 xl:w-56 bg-yt-bg border-r border-yt-border/40 pt-3 pb-4 overflow-y-auto overflow-x-hidden transition-all">
        <nav className="flex flex-col gap-0.5 px-2">
          {NAV_ITEMS.map(({ icon: Icon, labelKey, href }) => {
            const active = isActive(href)
            const label = t(labelKey)
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-4 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors group',
                  active ? 'bg-yt-hover text-yt-text' : 'text-yt-text-secondary hover:bg-yt-hover hover:text-yt-text'
                )}
                title={label}
              >
                <Icon className={cn('w-5 h-5 flex-shrink-0 transition-colors', active ? 'text-yt-red' : 'text-yt-text-secondary group-hover:text-yt-red')} />
                <span className="hidden xl:block truncate">{label}</span>
              </Link>
            )
          })}
        </nav>

        {/* Music + News */}
        <div className="border-t border-yt-border/40 my-3 mx-3" />
        <nav className="px-2 flex flex-col gap-0.5">
          <Link
            href="/music"
            className={cn(
              'flex items-center gap-4 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors group',
              pathname.startsWith('/music') ? 'bg-yt-hover text-yt-text' : 'text-yt-text-secondary hover:bg-yt-hover hover:text-yt-text'
            )}
            title={t('nav_music')}
          >
            <Music2 className={cn('w-5 h-5 flex-shrink-0', pathname.startsWith('/music') ? 'text-yt-red' : 'text-yt-text-secondary group-hover:text-yt-red transition-colors')} />
            <span className="hidden xl:block truncate">{t('nav_music')}</span>
          </Link>
          <Link
            href="/news"
            className={cn(
              'flex items-center gap-4 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors group',
              pathname.startsWith('/news') ? 'bg-yt-hover text-yt-text' : 'text-yt-text-secondary hover:bg-yt-hover hover:text-yt-text'
            )}
            title={t('nav_news')}
          >
            <Newspaper className={cn('w-5 h-5 flex-shrink-0', pathname.startsWith('/news') ? 'text-yt-red' : 'text-yt-text-secondary group-hover:text-yt-red transition-colors')} />
            <span className="hidden xl:block truncate">{t('nav_news')}</span>
          </Link>
        </nav>

        {/* Subscriptions */}
        {subscriptions.length > 0 && (
          <>
            <div className="border-t border-yt-border/40 my-3 mx-3" />
            <div className="px-2">
              <p className="hidden xl:block px-3 pb-2 text-xs font-semibold text-yt-text-muted uppercase tracking-wider">
                {t('nav_subscriptions')}
              </p>
              <div className="flex flex-col gap-0.5">
                {(showAllSubs ? subscriptions : subscriptions.slice(0, SUB_PREVIEW)).map((sub) => {
                  const active = pathname === `/channel/${sub.id}`
                  return (
                    <Link
                      key={sub.id}
                      href={`/channel/${sub.id}`}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-colors group',
                        active ? 'bg-yt-hover text-yt-text' : 'text-yt-text-secondary hover:bg-yt-hover hover:text-yt-text'
                      )}
                      title={sub.name}
                    >
                      <div className="w-6 h-6 rounded-full flex-shrink-0 relative">
                        <div className="absolute inset-0 rounded-full flex items-center justify-center text-xs font-bold text-white bg-blue-600">
                          {sub.name[0]?.toUpperCase()}
                        </div>
                        {sub.thumbnail && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={sub.thumbnail.startsWith('http') ? sub.thumbnail : `${API_BASE}${sub.thumbnail.startsWith('/') ? sub.thumbnail : '/' + sub.thumbnail}`}
                            alt={sub.name}
                            className="absolute inset-0 w-full h-full rounded-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                          />
                        )}
                      </div>
                      <span className="hidden xl:block truncate">{sub.name}</span>
                    </Link>
                  )
                })}
                {subscriptions.length > SUB_PREVIEW && (
                  <button
                    onClick={() => setShowAllSubs((p) => !p)}
                    className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-yt-text-muted hover:bg-yt-hover hover:text-yt-text transition-colors text-left"
                  >
                    <span className="w-6 h-6 rounded-full flex-shrink-0 bg-yt-secondary flex items-center justify-center text-xs">
                      {showAllSubs ? '↑' : `+${subscriptions.length - SUB_PREVIEW}`}
                    </span>
                    <span className="hidden xl:block truncate text-xs">
                      {showAllSubs ? t('home_show_less') : t('home_see_all')}
                    </span>
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        <div className="border-t border-yt-border/40 my-3 mx-3" />
        <div className="hidden xl:block px-5 text-xs text-yt-text-muted leading-relaxed">
          <p className="font-medium text-yt-text-secondary mb-1">{t('nav_privacyFirst')}</p>
          <p>{t('nav_noTracking')}</p>
          <p className="mt-2">{t('nav_selfHosted')}</p>
        </div>
      </aside>

      {/* ── Mobile bottom nav — floating pill ───────────────── */}
      <nav
        className="fixed left-1/2 -translate-x-1/2 z-40 md:hidden flex items-center justify-around h-20 px-4 rounded-2xl bg-yt-bg/95 backdrop-blur-xl border border-yt-border/30 shadow-[0_8px_32px_rgba(0,0,0,0.45)] w-[360px] max-w-[calc(100vw-16px)]"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}
      >
        <Link href="/" className={cn('flex flex-col items-center gap-1 py-2 px-3 rounded-xl transition-colors flex-1', isActive('/') ? 'text-yt-red' : 'text-yt-text-muted')}>
          <Home className="w-6 h-6" />
          <span className="text-[11px]">{t('nav_home')}</span>
        </Link>
        <Link href="/trending" className={cn('flex flex-col items-center gap-1 py-2 px-3 rounded-xl transition-colors flex-1', isActive('/trending') ? 'text-yt-red' : 'text-yt-text-muted')}>
          <TrendingUp className="w-6 h-6" />
          <span className="text-[11px]">{t('nav_trending')}</span>
        </Link>
        <Link href="/music" className={cn('flex flex-col items-center gap-1 py-2 px-3 rounded-xl transition-colors flex-1', pathname.startsWith('/music') ? 'text-yt-red' : 'text-yt-text-muted')}>
          <Music2 className="w-6 h-6" />
          <span className="text-[11px]">{t('nav_music')}</span>
        </Link>
        <Link href="/history" className={cn('flex flex-col items-center gap-1 py-2 px-3 rounded-xl transition-colors flex-1', isActive('/history') ? 'text-yt-red' : 'text-yt-text-muted')}>
          <History className="w-6 h-6" />
          <span className="text-[11px]">{t('nav_history')}</span>
        </Link>
        <button
          onClick={() => setShowDrawer(true)}
          className="flex flex-col items-center gap-1 py-2 px-3 rounded-xl text-yt-text-muted flex-1"
        >
          <MoreHorizontal className="w-6 h-6" />
          <span className="text-[11px]">Plus</span>
        </button>
      </nav>

      {/* ── Mobile drawer overlay ─────────────────────────────── */}
      {showDrawer && (
        <div className="fixed inset-0 z-[60] md:hidden">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50" />
          {/* Sheet — positioned above the floating nav pill */}
          <div
            ref={drawerRef}
            className="absolute left-0 right-0 bg-yt-bg rounded-t-2xl pb-6 pt-2 max-h-[80vh] overflow-y-auto"
            style={{ bottom: 'calc(env(safe-area-inset-bottom) + 100px)' }}
          >
            {/* Handle */}
            <div className="w-10 h-1 rounded-full bg-yt-border mx-auto mb-4" />
            {/* Close */}
            <div className="flex items-center justify-between px-4 mb-3">
              <span className="text-yt-text font-semibold">MyTube</span>
              <button onClick={() => setShowDrawer(false)} className="p-2 rounded-full hover:bg-yt-hover text-yt-text-muted">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* All nav items */}
            <div className="px-2 flex flex-col gap-0.5">
              {NAV_ITEMS.map(({ icon: Icon, labelKey, href }) => {
                const active = isActive(href)
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      'flex items-center gap-4 px-4 py-3 rounded-xl text-sm font-medium transition-colors',
                      active ? 'bg-yt-hover text-yt-text' : 'text-yt-text-secondary hover:bg-yt-hover hover:text-yt-text'
                    )}
                  >
                    <Icon className={cn('w-5 h-5 flex-shrink-0', active ? 'text-yt-red' : 'text-yt-text-secondary')} />
                    {t(labelKey)}
                  </Link>
                )
              })}
            </div>

            <div className="border-t border-yt-border/40 my-3 mx-4" />

            {/* Music & News */}
            <div className="px-2 flex flex-col gap-0.5">
              <Link
                href="/music"
                className={cn('flex items-center gap-4 px-4 py-3 rounded-xl text-sm font-medium transition-colors', pathname.startsWith('/music') ? 'bg-yt-hover text-yt-text' : 'text-yt-text-secondary hover:bg-yt-hover hover:text-yt-text')}
              >
                <Music2 className={cn('w-5 h-5 flex-shrink-0', pathname.startsWith('/music') ? 'text-yt-red' : 'text-yt-text-secondary')} />
                {t('nav_music')}
              </Link>
              <Link
                href="/news"
                className={cn('flex items-center gap-4 px-4 py-3 rounded-xl text-sm font-medium transition-colors', pathname.startsWith('/news') ? 'bg-yt-hover text-yt-text' : 'text-yt-text-secondary hover:bg-yt-hover hover:text-yt-text')}
              >
                <Newspaper className={cn('w-5 h-5 flex-shrink-0', pathname.startsWith('/news') ? 'text-yt-red' : 'text-yt-text-secondary')} />
                {t('nav_news')}
              </Link>
            </div>

            {/* Subscriptions in drawer */}
            {subscriptions.length > 0 && (
              <>
                <div className="border-t border-yt-border/40 my-3 mx-4" />
                <p className="px-6 pb-2 text-xs font-semibold text-yt-text-muted uppercase tracking-wider">{t('nav_subscriptions')}</p>
                <div className="px-2 flex flex-col gap-0.5">
                  {subscriptions.slice(0, 1).map((sub) => (
                    <Link
                      key={sub.id}
                      href={`/channel/${sub.id}`}
                      className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm text-yt-text-secondary hover:bg-yt-hover hover:text-yt-text transition-colors"
                    >
                      <div className="w-7 h-7 rounded-full flex-shrink-0 relative">
                        <div className="absolute inset-0 rounded-full flex items-center justify-center text-xs font-bold text-white bg-blue-600">
                          {sub.name[0]?.toUpperCase()}
                        </div>
                        {sub.thumbnail && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={sub.thumbnail.startsWith('http') ? sub.thumbnail : `${API_BASE}${sub.thumbnail.startsWith('/') ? sub.thumbnail : '/' + sub.thumbnail}`}
                            alt={sub.name}
                            className="absolute inset-0 w-full h-full rounded-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                          />
                        )}
                      </div>
                      <span className="truncate">{sub.name}</span>
                    </Link>
                  ))}
                  {subscriptions.length > 1 && (
                    <Link
                      href="/subscriptions"
                      onClick={() => setShowDrawer(false)}
                      className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm text-yt-text-muted hover:bg-yt-hover hover:text-yt-text transition-colors"
                    >
                      <span className="w-7 h-7 rounded-full flex-shrink-0 bg-yt-secondary flex items-center justify-center text-xs font-bold">
                        +{subscriptions.length - 1}
                      </span>
                      <span>{t('home_see_all')}</span>
                    </Link>
                  )}
                </div>
              </>
            )}

            <div className="border-t border-yt-border/40 my-3 mx-4" />

            {/* Settings */}
            <div className="px-2">
              <button
                onClick={() => { setShowDrawer(false); setShowSettings(true) }}
                className="w-full flex items-center gap-4 px-4 py-3 rounded-xl text-sm font-medium text-yt-text-secondary hover:bg-yt-hover hover:text-yt-text transition-colors"
              >
                <Settings className="w-5 h-5 flex-shrink-0" />
                {t('settings_title')}
              </button>
            </div>
          </div>
        </div>
      )}

      <SettingsPanel open={showSettings} onClose={() => setShowSettings(false)} />
    </>
  )
}
