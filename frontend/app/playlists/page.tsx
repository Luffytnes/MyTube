'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ListVideo, ExternalLink, Trash2, X } from 'lucide-react'
import { getSavedPlaylists, removeSavedPlaylist, type SavedPlaylist } from '@/lib/savedPlaylists'
import { useRegion } from '@/lib/regionContext'

export default function PlaylistsPage() {
  const { t } = useRegion()
  const [playlists, setPlaylists] = useState<SavedPlaylist[]>([])

  useEffect(() => {
    setPlaylists(getSavedPlaylists())
  }, [])

  function remove(id: string) {
    removeSavedPlaylist(id)
    setPlaylists((prev) => prev.filter((p) => p.id !== id))
  }

  function clearAll() {
    playlists.forEach((p) => removeSavedPlaylist(p.id))
    setPlaylists([])
  }

  return (
    <div className="px-4 py-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-yt-text">{t('playlists_title')}</h1>
        {playlists.length > 0 && (
          <button
            onClick={clearAll}
            className="flex items-center gap-2 text-sm text-yt-text-muted hover:text-yt-text transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            {t('history_clear')}
          </button>
        )}
      </div>

      {playlists.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <ListVideo className="w-14 h-14 text-yt-text-muted mb-4" />
          <p className="text-yt-text text-lg font-medium mb-1">{t('playlists_empty')}</p>
          <p className="text-yt-text-muted text-sm">
            {t('playlist_save')} {t('filter_playlists').toLowerCase()} {t('searchResultsFor').toLowerCase()}.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8">
          {playlists.map((pl) => {
            const watchUrl = pl.firstVideoId ? `/watch/${pl.firstVideoId}?list=${pl.id}` : null
            const ytUrl = `https://www.youtube.com/playlist?list=${pl.id}`

            return (
              <div key={pl.id} className="flex flex-col gap-2 group relative">
                {/* Remove button */}
                <button
                  onClick={() => remove(pl.id)}
                  className="absolute top-2 left-2 z-10 w-7 h-7 bg-black/70 hover:bg-black/90 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  title={t('playlists_remove')}
                >
                  <X className="w-3.5 h-3.5 text-white" />
                </button>

                {/* Thumbnail */}
                <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-yt-secondary">
                  {pl.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={pl.thumbnail}
                      alt={pl.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ListVideo className="w-10 h-10 text-yt-text-muted" />
                    </div>
                  )}

                  {/* Video count stripe */}
                  {pl.videoCount && (
                    <div className="absolute inset-y-0 right-0 w-14 bg-black/80 flex flex-col items-center justify-center gap-1">
                      <ListVideo className="w-4 h-4 text-white" />
                      <span className="text-white text-[11px] font-bold leading-none">{pl.videoCount}</span>
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex flex-col gap-0.5 px-1">
                  {watchUrl ? (
                    <Link
                      href={watchUrl}
                      className="text-yt-text font-medium text-sm leading-snug line-clamp-2 hover:text-yt-red transition-colors"
                    >
                      {pl.title}
                    </Link>
                  ) : (
                    <p className="text-yt-text font-medium text-sm leading-snug line-clamp-2">{pl.title}</p>
                  )}

                  {pl.channelName && (
                    <Link
                      href={pl.channelId ? `/channel/${pl.channelId}` : '#'}
                      className="text-yt-text-muted text-xs hover:text-yt-text transition-colors truncate"
                    >
                      {pl.channelName}
                    </Link>
                  )}

                  {pl.videoCount && (
                    <p className="text-yt-text-muted text-xs">{pl.videoCount} {t('playlist_videos')}</p>
                  )}

                  <a
                    href={ytUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 flex items-center gap-1 text-xs text-yt-text-muted hover:text-yt-text transition-colors self-start"
                  >
                    <ExternalLink className="w-3 h-3" />
                    {t('playlists_open_youtube')}
                  </a>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
