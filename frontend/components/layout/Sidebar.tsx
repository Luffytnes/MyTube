'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Home, TrendingUp, History, Clock, Music2, ThumbsUp,
  ListVideo, ListOrdered, Newspaper, Settings, MoreHorizontal, X, Tv,
  Radio, Clapperboard, Baby, ShieldCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRegion } from '@/lib/regionContext'
import { useSubscriptions } from '@/lib/subscriptionsContext'
import type { Translations } from '@/lib/translations'
import SettingsPanel from './SettingsPanel'
import { imageSrc } from '@/lib/thumbnails'

type NavItem = { icon: typeof Home; labelKey: keyof Translations; href: string }

const DISCOVER_ITEMS: NavItem[] = [
  { icon: Home, labelKey: 'nav_home', href: '/' },
  { icon: TrendingUp, labelKey: 'nav_trending', href: '/trending' },
  { icon: Radio, labelKey: 'nav_live', href: '/live' },
  { icon: Clapperboard, labelKey: 'nav_shorts', href: '/shorts' },
  { icon: Baby, labelKey: 'nav_kids', href: '/kids' },
]

const LIBRARY_ITEMS: NavItem[] = [
  { icon: History, labelKey: 'nav_history', href: '/history' },
  { icon: Clock, labelKey: 'nav_watchLater', href: '/watch-later' },
  { icon: ThumbsUp, labelKey: 'nav_likes', href: '/likes' },
  { icon: ListVideo, labelKey: 'nav_playlists', href: '/playlists' },
  { icon: ListOrdered, labelKey: 'nav_queue', href: '/queue' },
]

const NAV_ITEMS: NavItem[] = [...DISCOVER_ITEMS, ...LIBRARY_ITEMS]

function SideLink({ href, icon: Icon, label, active }: { href: string; icon: typeof Home; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      title={label}
      className={cn(
        'relative flex items-center justify-center xl:justify-start gap-3.5 px-3 h-10 rounded-xl text-[13.5px] font-medium transition-all duration-200 group',
        active
          ? 'bg-yt-red/[0.12] text-yt-text'
          : 'text-yt-text-secondary hover:bg-yt-hover/70 hover:text-yt-text'
      )}
    >
      {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-accent-gradient" />}
      <Icon className={cn('w-[19px] h-[19px] flex-shrink-0 transition-all duration-200', active ? 'text-yt-red' : 'text-yt-text-muted group-hover:text-yt-text group-hover:scale-110')} />
      <span className="hidden xl:block truncate">{label}</span>
    </Link>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="hidden xl:block px-3 pt-1 pb-1.5 text-[11px] font-semibold text-yt-text-muted uppercase tracking-[0.1em]">
      {children}
    </p>
  )
}

function Divider() {
  return <div className="my-3 mx-3 h-px bg-gradient-to-r from-transparent via-yt-border/70 to-transparent" />
}

const SUB_PREVIEW = 4

function SubAvatar({ name, thumbnail, size }: { name: string; thumbnail?: string | null; size: string }) {
  return (
    <div className={cn('rounded-full flex-shrink-0 relative ring-1 ring-yt-border/60', size)}>
      <div className="absolute inset-0 rounded-full flex items-center justify-center text-[10px] font-bold text-white bg-accent-gradient">
        {name[0]?.toUpperCase()}
      </div>
      {thumbnail && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageSrc(thumbnail)}
          alt=""
          className="absolute inset-0 w-full h-full rounded-full object-cover"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
      )}
    </div>
  )
}

export default function Sidebar() {
  const pathname = usePathname()
  const { t } = useRegion()
  const { subscriptions } = useSubscriptions()
  const [showAllSubs, setShowAllSubs] = useState(false)
  const [showDrawerSubs, setShowDrawerSubs] = useState(false)
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
  useEffect(() => { setShowDrawer(false); setShowDrawerSubs(false) }, [pathname])

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────────── */}
      <aside className="fixed left-0 top-14 bottom-0 z-40 hidden md:flex flex-col w-20 xl:w-56 bg-yt-bg/60 backdrop-blur-xl border-r border-yt-border/30 pt-4 pb-4 overflow-y-auto overflow-x-hidden scrollbar-none">
        <nav className="flex flex-col gap-0.5 px-2.5" aria-label="Discover">
          {DISCOVER_ITEMS.map(({ icon, labelKey, href }) => (
            <SideLink key={href} href={href} icon={icon} label={t(labelKey)} active={isActive(href)} />
          ))}
        </nav>

        <Divider />
        <nav className="flex flex-col gap-0.5 px-2.5" aria-label={t('nav_library')}>
          <SectionLabel>{t('nav_library')}</SectionLabel>
          {LIBRARY_ITEMS.map(({ icon, labelKey, href }) => (
            <SideLink key={href} href={href} icon={icon} label={t(labelKey)} active={isActive(href)} />
          ))}
        </nav>

        {/* MyTube Apps */}
        <Divider />
        <nav className="px-2.5 flex flex-col gap-0.5" aria-label={t('nav_apps')}>
          <SectionLabel>{t('nav_apps')}</SectionLabel>
          {[
            { href: '/tv', icon: Tv, label: t('nav_iptv'), active: pathname.startsWith('/tv') },
            { href: '/music', icon: Music2, label: t('nav_music'), active: pathname.startsWith('/music') },
            { href: '/news', icon: Newspaper, label: t('nav_news'), active: pathname.startsWith('/news') },
          ].map((item) => <SideLink key={item.href} {...item} />)}
        </nav>

        {/* Subscriptions */}
        {subscriptions.length > 0 && (
          <>
            <Divider />
            <div className="px-2.5">
              <SectionLabel>{t('nav_subscriptions')}</SectionLabel>
              <div className="flex flex-col gap-0.5">
                {(showAllSubs ? subscriptions : subscriptions.slice(0, SUB_PREVIEW)).map((sub) => {
                  const active = pathname === `/channel/${sub.id}`
                  return (
                    <Link
                      key={sub.id}
                      href={`/channel/${sub.id}`}
                      className={cn(
                        'flex items-center justify-center xl:justify-start gap-3 px-3 h-10 rounded-xl text-[13.5px] transition-colors group',
                        active ? 'bg-yt-red/[0.12] text-yt-text' : 'text-yt-text-secondary hover:bg-yt-hover/70 hover:text-yt-text'
                      )}
                      title={sub.name}
                    >
                      <SubAvatar name={sub.name} thumbnail={sub.thumbnail} size="w-6 h-6" />
                      <span className="hidden xl:block truncate">{sub.name}</span>
                    </Link>
                  )
                })}
                {subscriptions.length > SUB_PREVIEW && (
                  <button
                    onClick={() => setShowAllSubs((p) => !p)}
                    className="flex items-center justify-center xl:justify-start gap-3 px-3 h-10 rounded-xl text-sm text-yt-text-muted hover:bg-yt-hover/70 hover:text-yt-text transition-colors text-left"
                  >
                    <span className="w-6 h-6 rounded-full flex-shrink-0 bg-yt-secondary flex items-center justify-center text-[10px] font-semibold">
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

        <div className="mt-auto hidden xl:block px-3 pt-6">
          <div className="relative overflow-hidden rounded-2xl border border-yt-border/50 bg-yt-secondary/50 p-3.5">
            <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-yt-red/20 blur-2xl" />
            <p className="relative flex items-center gap-2 text-xs font-semibold text-yt-text">
              <ShieldCheck className="w-4 h-4 text-yt-red" />
              {t('nav_privacyFirst')}
            </p>
            <p className="relative mt-1.5 text-[11px] leading-relaxed text-yt-text-muted">{t('nav_noTracking')}</p>
          </div>
        </div>
      </aside>

      {/* ── Mobile bottom nav — floating glass pill ─────────── */}
      <nav
        className="fixed left-1/2 -translate-x-1/2 z-40 md:hidden flex items-center justify-around h-[68px] px-2 rounded-[22px] glass shadow-elevated w-[360px] max-w-[calc(100vw-16px)]"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}
        aria-label="Navigation"
      >
        {[
          { href: '/', icon: Home, label: t('nav_home'), active: isActive('/') },
          { href: '/trending', icon: TrendingUp, label: t('nav_trending'), active: isActive('/trending') },
          { href: '/music', icon: Music2, label: t('nav_music'), active: pathname.startsWith('/music') },
          { href: '/history', icon: History, label: t('nav_history'), active: isActive('/history') },
        ].map(({ href, icon: Icon, label, active }) => (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn('relative flex flex-col items-center gap-1 py-2 px-2 rounded-2xl transition-colors flex-1 min-w-0', active ? 'text-yt-text' : 'text-yt-text-muted')}
          >
            <Icon className={cn('w-[22px] h-[22px]', active && 'text-yt-red')} />
            <span className="text-[10.5px] font-medium truncate max-w-full">{label}</span>
            {active && <span className="absolute -bottom-0.5 w-1 h-1 rounded-full bg-yt-red" />}
          </Link>
        ))}
        <button
          onClick={() => setShowDrawer(true)}
          className="flex flex-col items-center gap-1 py-2 px-2 rounded-2xl text-yt-text-muted flex-1"
          aria-label="Plus"
        >
          <MoreHorizontal className="w-[22px] h-[22px]" />
          <span className="text-[10.5px] font-medium">Plus</span>
        </button>
      </nav>

      {/* ── Mobile drawer overlay ─────────────────────────────── */}
      {showDrawer && (
        <div className="fixed inset-0 z-[60] md:hidden">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" />
          {/* Sheet — positioned above the floating nav pill */}
          <div
            ref={drawerRef}
            className="absolute left-2 right-2 glass rounded-3xl pb-6 pt-3 max-h-[75vh] overflow-y-auto shadow-elevated animate-fade-up"
            style={{ bottom: 'calc(env(safe-area-inset-bottom) + 100px)' }}
          >
            {/* Close */}
            <div className="flex items-center justify-between px-4 mb-3">
              <span className="font-display text-lg font-bold text-yt-text">MyTube</span>
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

            {/* MyTube Apps */}
            <div className="px-2 flex flex-col gap-0.5">
              {[
                { href: '/tv', icon: Tv, label: t('nav_iptv'), active: pathname.startsWith('/tv') },
                { href: '/music', icon: Music2, label: t('nav_music'), active: pathname.startsWith('/music') },
                { href: '/news', icon: Newspaper, label: t('nav_news'), active: pathname.startsWith('/news') },
              ].map(({ href, icon: Icon, label, active }) => (
                <Link
                  key={href}
                  href={href}
                  className={cn('flex items-center gap-4 px-4 py-3 rounded-xl text-sm font-medium transition-colors', active ? 'bg-yt-hover text-yt-text' : 'text-yt-text-secondary hover:bg-yt-hover hover:text-yt-text')}
                >
                  <Icon className={cn('w-5 h-5 flex-shrink-0', active ? 'text-yt-red' : 'text-yt-text-secondary')} />
                  {label}
                </Link>
              ))}
            </div>

            {/* Subscriptions in drawer */}
            {subscriptions.length > 0 && (
              <>
                <div className="border-t border-yt-border/40 my-3 mx-4" />
                <p className="px-6 pb-2 text-xs font-semibold text-yt-text-muted uppercase tracking-wider">{t('nav_subscriptions')}</p>
                <div className="px-2 flex flex-col gap-0.5">
                  {(showDrawerSubs ? subscriptions : subscriptions.slice(0, 1)).map((sub) => (
                    <Link
                      key={sub.id}
                      href={`/channel/${sub.id}`}
                      className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm text-yt-text-secondary hover:bg-yt-hover hover:text-yt-text transition-colors"
                    >
                      <SubAvatar name={sub.name} thumbnail={sub.thumbnail} size="w-7 h-7" />
                      <span className="truncate">{sub.name}</span>
                    </Link>
                  ))}
                  {subscriptions.length > 1 && (
                    <button
                      onClick={() => setShowDrawerSubs((v) => !v)}
                      className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm text-yt-text-muted hover:bg-yt-hover hover:text-yt-text transition-colors w-full text-left"
                    >
                      <span className="w-7 h-7 rounded-full flex-shrink-0 bg-yt-secondary flex items-center justify-center text-xs font-bold">
                        {showDrawerSubs ? '↑' : `+${subscriptions.length - 1}`}
                      </span>
                      <span>{showDrawerSubs ? t('home_show_less') : t('home_see_all')}</span>
                    </button>
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
