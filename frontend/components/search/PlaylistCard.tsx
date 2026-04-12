'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ListVideo, BookmarkPlus, BookmarkCheck } from 'lucide-react'
import type { PlaylistSearchResult } from '@/lib/api'
import { isPlaylistSaved, toggleSavedPlaylist } from '@/lib/savedPlaylists'
import { useRegion } from '@/lib/regionContext'

interface Props {
  playlist: PlaylistSearchResult
}

export default function PlaylistCard({ playlist }: Props) {
  const { t } = useRegion()
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setSaved(isPlaylistSaved(playlist.id))
  }, [playlist.id])

  function handleSave(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const next = toggleSavedPlaylist({
      id: playlist.id,
      title: playlist.title,
      thumbnail: playlist.thumbnail,
      videoCount: playlist.videoCount,
      channelName: playlist.channelName,
      channelId: playlist.channelId,
      firstVideoId: playlist.firstVideoId,
    })
    setSaved(next)
  }

  const watchUrl = playlist.firstVideoId
    ? `/watch/${playlist.firstVideoId}?list=${playlist.id}`
    : `https://www.youtube.com/playlist?list=${playlist.id}`

  const isExternal = !playlist.firstVideoId

  return (
    <div className="flex flex-col gap-2">
      {/* Thumbnail — YouTube playlist style */}
      <Link
        href={watchUrl}
        {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        className="relative w-full aspect-video rounded-xl overflow-hidden bg-yt-secondary block"
      >
        {playlist.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={playlist.thumbnail}
            alt={playlist.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ListVideo className="w-10 h-10 text-yt-text-muted" />
          </div>
        )}

        {/* Video count stripe on the right — YouTube style */}
        <div className="absolute inset-y-0 right-0 w-14 bg-black/80 flex flex-col items-center justify-center gap-1">
          <ListVideo className="w-4 h-4 text-white" />
          <span className="text-white text-[11px] font-bold leading-none">
            {playlist.videoCount}
          </span>
        </div>
      </Link>

      {/* Info */}
      <div className="flex flex-col gap-1 px-1">
        <Link
          href={watchUrl}
          {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          className="text-yt-text font-medium text-sm leading-snug line-clamp-2 hover:text-yt-red transition-colors"
        >
          {playlist.title}
        </Link>

        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            {playlist.channelName && (
              <Link
                href={playlist.channelId ? `/channel/${playlist.channelId}` : '#'}
                className="text-yt-text-muted text-xs hover:text-yt-text transition-colors truncate block"
              >
                {playlist.channelName}
              </Link>
            )}
            <p className="text-yt-text-muted text-xs">
              {playlist.videoCount} {t('playlist_videos')}
            </p>
          </div>

          {/* Save button */}
          <button
            onClick={handleSave}
            className={`flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors border ${
              saved
                ? 'border-green-500 text-green-500 bg-green-500/10'
                : 'border-yt-border text-yt-text-muted hover:border-yt-text hover:text-yt-text'
            }`}
          >
            {saved ? (
              <BookmarkCheck className="w-3 h-3" />
            ) : (
              <BookmarkPlus className="w-3 h-3" />
            )}
            {saved ? t('playlist_saved') : t('playlist_save')}
          </button>
        </div>
      </div>
    </div>
  )
}
