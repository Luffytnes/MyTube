'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, TrendingUp, History, Clock, Music2, ThumbsUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRegion } from '@/lib/regionContext'
import { useSubscriptions } from '@/lib/subscriptionsContext'
import type { Translations } from '@/lib/translations'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

const NAV_ITEMS: { icon: typeof Home; labelKey: keyof Translations; href: string }[] = [
  { icon: Home, labelKey: 'nav_home', href: '/' },
  { icon: TrendingUp, labelKey: 'nav_trending', href: '/trending' },
  { icon: History, labelKey: 'nav_history', href: '/history' },
  { icon: Clock, labelKey: 'nav_watchLater', href: '/watch-later' },
  { icon: ThumbsUp, labelKey: 'nav_likes', href: '/likes' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const { t } = useRegion()
  const { subscriptions } = useSubscriptions()

  function isActive(href: string) {
    if (href === '/') return pathname === '/'
    return pathname === href || pathname.startsWith(href.split('?')[0] + '/')
  }

  return (
    <>
      {/* Desktop sidebar */}
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

        {/* Music */}
        <div className="border-t border-yt-border/40 my-3 mx-3" />
        <nav className="px-2">
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
                {subscriptions.slice(0, 10).map((sub) => {
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
                            src={`${API_BASE}${sub.thumbnail.startsWith('/') ? sub.thumbnail : '/' + sub.thumbnail}`}
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

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden flex items-center justify-around bg-yt-bg border-t border-yt-border/40 h-14 px-2">
        {NAV_ITEMS.slice(0, 4).map(({ icon: Icon, labelKey, href }) => {
          const active = isActive(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center gap-1 py-2 px-3 rounded-xl text-xs transition-colors',
                active ? 'text-yt-text' : 'text-yt-text-muted hover:text-yt-text'
              )}
            >
              <Icon className={cn('w-5 h-5', active ? 'text-yt-red' : '')} />
              <span>{t(labelKey)}</span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
