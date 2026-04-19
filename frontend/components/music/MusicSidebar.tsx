'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Search, ListMusic, ChevronLeft, Mic2, Bell, Radio } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRegion } from '@/lib/regionContext'
import type { Translations } from '@/lib/translations'

const NAV_KEYS: { icon: typeof Home; labelKey: keyof Translations; href: string }[] = [
  { icon: Home, labelKey: 'music_home', href: '/music' },
  { icon: Search, labelKey: 'music_search', href: '/music/search' },
  { icon: Radio, labelKey: 'music_radio', href: '/music/radio' },
  { icon: Mic2, labelKey: 'podcast_nav', href: '/music/podcasts' },
  { icon: Bell, labelKey: 'podcast_my_subscriptions', href: '/music/podcasts/subscriptions' },
  { icon: ListMusic, labelKey: 'music_my_playlists', href: '/music/playlists' },
]

export default function MusicSidebar() {
  const pathname = usePathname()
  const { t } = useRegion()

  function isActive(href: string) {
    if (href === '/music') return pathname === '/music'
    return pathname.startsWith(href)
  }

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="fixed left-0 top-14 bottom-20 z-40 hidden md:flex flex-col w-20 xl:w-56 bg-yt-bg border-r border-yt-border/40 pt-3 pb-4 overflow-y-auto overflow-x-hidden">
        <nav className="flex flex-col gap-0.5 px-2">
          {NAV_KEYS.map(({ icon: Icon, labelKey, href }) => {
            const active = isActive(href)
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

        <div className="border-t border-yt-border/40 my-3 mx-3" />

        <nav className="px-2">
          <Link
            href="/"
            title={t('music_back')}
            className="flex items-center gap-4 px-3 py-2.5 rounded-xl text-sm font-medium text-yt-text-secondary hover:bg-yt-hover hover:text-yt-text transition-colors group"
          >
            <ChevronLeft className="w-5 h-5 flex-shrink-0 group-hover:text-yt-text transition-colors" />
            <span className="hidden xl:block truncate">{t('music_back')}</span>
          </Link>
        </nav>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-20 left-0 right-0 z-40 md:hidden flex items-center justify-around bg-yt-bg border-t border-yt-border/40 h-12 px-2">
        {NAV_KEYS.map(({ icon: Icon, labelKey, href }) => {
          const active = isActive(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center gap-0.5 py-1 px-3 rounded-xl text-xs transition-colors',
                active ? 'text-yt-red' : 'text-yt-text-muted hover:text-yt-text'
              )}
            >
              <Icon className="w-5 h-5" />
              <span>{t(labelKey)}</span>
            </Link>
          )
        })}
        <Link
          href="/"
          className="flex flex-col items-center gap-0.5 py-1 px-3 rounded-xl text-xs text-yt-text-muted hover:text-yt-text transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
          <span>MyTube</span>
        </Link>
      </nav>
    </>
  )
}
