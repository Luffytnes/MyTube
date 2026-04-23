'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Search, ListMusic, ChevronLeft, Mic2, Bell, Radio, Plus, ChevronDown, ChevronUp, MoreHorizontal, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRegion } from '@/lib/regionContext'
import { useMusic } from '@/lib/musicContext'
import type { Translations } from '@/lib/translations'
import { getMusicPlaylists, type MusicPlaylist } from '@/lib/musicPlaylists'

const NAV_KEYS: { icon: typeof Home; labelKey: keyof Translations; href: string }[] = [
  { icon: Home, labelKey: 'music_home', href: '/music' },
  { icon: Search, labelKey: 'music_search', href: '/music/search' },
  { icon: Radio, labelKey: 'music_radio', href: '/music/radio' },
  { icon: Mic2, labelKey: 'podcast_nav', href: '/music/podcasts' },
  { icon: Bell, labelKey: 'podcast_my_subscriptions', href: '/music/podcasts/subscriptions' },
  { icon: ListMusic, labelKey: 'music_my_playlists', href: '/music/playlists' },
]

const PLAYLIST_PREVIEW = 5

export default function MusicSidebar() {
  const pathname = usePathname()
  const { t } = useRegion()
  const { currentTrack } = useMusic()
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([])
  const [showAllPlaylists, setShowAllPlaylists] = useState(false)
  const [showMoreDrawer, setShowMoreDrawer] = useState(false)

  useEffect(() => {
    setPlaylists(getMusicPlaylists())
    // Refresh on focus (user might add a playlist in another tab)
    function onFocus() { setPlaylists(getMusicPlaylists()) }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  // Close drawer on navigation
  useEffect(() => {
    setShowMoreDrawer(false)
  }, [pathname])

  function isActive(href: string) {
    if (href === '/music') return pathname === '/music'
    return pathname.startsWith(href)
  }

  const visiblePlaylists = showAllPlaylists ? playlists : playlists.slice(0, PLAYLIST_PREVIEW)

  return (
    <>
      {/* ── Desktop sidebar — floating liquid glass ─────────── */}
      <aside className="fixed left-3 top-[57px] bottom-20 z-40 hidden md:flex flex-col w-[72px] xl:w-52 liquid-glass rounded-2xl pt-3 pb-4 overflow-y-auto overflow-x-hidden transition-all">
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
                  'liquid-glass-btn flex items-center gap-4 px-3 py-2.5 text-sm font-medium group',
                  active ? 'active text-yt-text' : 'text-yt-text-secondary hover:text-yt-text'
                )}
              >
                <Icon className={cn('w-5 h-5 flex-shrink-0 transition-colors z-10 relative', active ? 'text-yt-red' : 'text-yt-text-secondary group-hover:text-yt-red')} />
                <span className="hidden xl:block truncate z-10 relative">{label}</span>
              </Link>
            )
          })}
        </nav>

        {/* Playlists section */}
        {playlists.length > 0 && (
          <>
            <div className="border-t border-white/8 my-3 mx-3" />
            <div className="px-2">
              <div className="hidden xl:flex items-center justify-between px-3 pb-2">
                <p className="text-xs font-semibold text-yt-text-muted uppercase tracking-wider truncate z-10 relative">
                  {t('music_my_playlists')}
                </p>
                <Link href="/music/playlists" className="text-yt-text-muted hover:text-yt-text transition-colors flex-shrink-0 z-10 relative">
                  <Plus className="w-3.5 h-3.5" />
                </Link>
              </div>

              <div className="flex flex-col gap-0.5">
                {visiblePlaylists.map((p) => {
                  const active = pathname === `/music/playlists/${p.id}`
                  const thumb = p.tracks[0]?.thumbnail
                  return (
                    <Link
                      key={p.id}
                      href={`/music/playlists/${p.id}`}
                      title={p.name}
                      className={cn(
                        'liquid-glass-btn flex items-center gap-3 px-3 py-2 text-sm group',
                        active ? 'active text-yt-text' : 'text-yt-text-secondary hover:text-yt-text'
                      )}
                    >
                      {/* Thumbnail / placeholder */}
                      <div className="w-6 h-6 rounded flex-shrink-0 overflow-hidden bg-yt-secondary flex items-center justify-center z-10 relative">
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumb} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <ListMusic className="w-3.5 h-3.5 text-yt-text-muted" />
                        )}
                      </div>
                      <span className={cn('hidden xl:block truncate text-sm z-10 relative', active ? 'text-yt-text' : 'text-yt-text-secondary group-hover:text-yt-text')}>
                        {p.name}
                      </span>
                    </Link>
                  )
                })}

                {playlists.length > PLAYLIST_PREVIEW && (
                  <button
                    onClick={() => setShowAllPlaylists((v) => !v)}
                    className="liquid-glass-btn hidden xl:flex items-center gap-3 px-3 py-1.5 text-xs text-yt-text-muted hover:text-yt-text"
                  >
                    <span className="z-10 relative flex items-center gap-1.5">
                      {showAllPlaylists
                        ? <><ChevronUp className="w-3.5 h-3.5" /> {t('home_show_less')}</>
                        : <><ChevronDown className="w-3.5 h-3.5" /> +{playlists.length - PLAYLIST_PREVIEW} {t('music_see_all').toLowerCase()}</>}
                    </span>
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        <div className="border-t border-white/8 my-3 mx-3" />
        <nav className="px-2">
          <Link
            href="/"
            title={t('music_back')}
            className="liquid-glass-btn flex items-center gap-4 px-3 py-2.5 text-sm font-medium text-yt-text-secondary hover:text-yt-text group"
          >
            <ChevronLeft className="w-5 h-5 flex-shrink-0 group-hover:text-yt-text transition-colors z-10 relative" />
            <span className="hidden xl:block truncate z-10 relative">{t('music_back')}</span>
          </Link>
        </nav>
      </aside>

      {/* ── Mobile bottom nav — floating pill ───────────────── */}
      <nav
        className="fixed left-1/2 -translate-x-1/2 z-40 md:hidden flex items-center justify-around h-16 px-4 rounded-2xl bg-yt-bg/95 backdrop-blur-xl border border-yt-border/30 shadow-[0_8px_32px_rgba(0,0,0,0.45)] w-[340px] max-w-[calc(100vw-24px)]"
        style={{ bottom: currentTrack ? 'calc(env(safe-area-inset-bottom) + 96px)' : 'calc(env(safe-area-inset-bottom) + 12px)' }}
      >
        {NAV_KEYS.slice(0, 4).map(({ icon: Icon, labelKey, href }) => {
          const active = isActive(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center gap-0.5 py-1 px-2 rounded-xl text-[10px] transition-colors flex-1',
                active ? 'text-yt-red' : 'text-yt-text-muted hover:text-yt-text'
              )}
            >
              <Icon className="w-5 h-5" />
              <span className="truncate max-w-[52px] text-center leading-tight">{t(labelKey)}</span>
            </Link>
          )
        })}
        {/* "Plus" button — opens drawer with playlists + remaining nav items */}
        <button
          onClick={() => setShowMoreDrawer((v) => !v)}
          className={cn(
            'flex flex-col items-center gap-0.5 py-1 px-2 rounded-xl text-[10px] transition-colors flex-1',
            showMoreDrawer ? 'text-yt-red' : 'text-yt-text-muted hover:text-yt-text'
          )}
        >
          <MoreHorizontal className="w-5 h-5" />
          <span>Plus</span>
        </button>
      </nav>

      {/* ── Mobile "Plus" drawer ─────────────────────────────── */}
      {showMoreDrawer && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-[45] md:hidden" onClick={() => setShowMoreDrawer(false)} />
          {/* Drawer — sits just above the floating nav */}
          <div
            className="fixed left-0 right-0 z-[46] md:hidden bg-yt-bg rounded-t-2xl shadow-2xl max-h-[80vh] overflow-y-auto"
            style={{ bottom: currentTrack ? 'calc(env(safe-area-inset-bottom) + 168px)' : 'calc(env(safe-area-inset-bottom) + 84px)' }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-yt-border/40">
              <p className="text-sm font-semibold text-yt-text">MyTube Music</p>
              <button onClick={() => setShowMoreDrawer(false)} className="text-yt-text-muted hover:text-yt-text">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-2">
              {/* ALL nav items */}
              {NAV_KEYS.map(({ icon: Icon, labelKey, href }) => {
                const active = isActive(href)
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

              {/* Playlists */}
              {playlists.length > 0 && (
                <>
                  <div className="border-t border-yt-border/40 my-2 mx-4" />
                  <p className="px-4 pb-1 text-xs font-semibold text-yt-text-muted uppercase tracking-wider">
                    {t('music_my_playlists')}
                  </p>
                  {playlists.map((p) => {
                    const active = pathname === `/music/playlists/${p.id}`
                    const thumb = p.tracks[0]?.thumbnail
                    return (
                      <Link
                        key={p.id}
                        href={`/music/playlists/${p.id}`}
                        className={cn(
                          'flex items-center gap-3 px-4 py-2.5 text-sm transition-colors',
                          active ? 'text-yt-text font-medium' : 'text-yt-text-secondary hover:bg-yt-hover hover:text-yt-text'
                        )}
                      >
                        <div className="w-7 h-7 rounded flex-shrink-0 overflow-hidden bg-yt-secondary flex items-center justify-center">
                          {thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={thumb} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <ListMusic className="w-4 h-4 text-yt-text-muted" />
                          )}
                        </div>
                        <span className="truncate">{p.name}</span>
                      </Link>
                    )
                  })}
                </>
              )}

              {/* Back to MyTube */}
              <div className="border-t border-yt-border/40 my-2 mx-4" />
              <Link
                href="/"
                className="flex items-center gap-4 px-4 py-3 text-sm text-yt-text-secondary hover:bg-yt-hover hover:text-yt-text transition-colors"
              >
                <ChevronLeft className="w-5 h-5 flex-shrink-0" />
                {t('music_back')}
              </Link>
            </div>
          </div>
        </>
      )}

    </>
  )
}
