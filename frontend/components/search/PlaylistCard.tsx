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
    ? `/watch/${playlist.firstVideoId}`
    : `https://www.youtube.com/playlist?list=${playlist.id}`

  const isExternal = !playlist.firstVideoId

  return (
    <div className="flex gap-4 group">
      {/* Thumbnail — YouTube playlist style */}
      <Link
        href={watchUrl}
        {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        className="relative flex-shrink-0 w-48 aspect-video rounded-xl overflow-hidden bg-yt-secondary"
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

        {/* Video count overlay — right side stripe like YouTube */}
        <div className="absolute inset-y-0 right-0 w-12 bg-black/75 flex flex-col items-center justify-center gap-1">
          <ListVideo className="w-4 h-4 text-white" />
          <span className="text-white text-[10px] font-bold leading-none">
            {playlist.videoCount}
          </span>
        </div>
      </Link>

      {/* Info */}
      <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
        <div>
          <Link
            href={watchUrl}
            {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            className="text-yt-text font-semibold text-sm leading-snug line-clamp-2 hover:text-yt-text/80 transition-colors"
          >
            {playlist.title}
          </Link>
          {playlist.channelName && (
            <Link
              href={playlist.channelId ? `/channel/${playlist.channelId}` : '#'}
              className="text-yt-text-muted text-xs mt-1 hover:text-yt-text transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              {playlist.channelName}
            </Link>
          )}
          <p className="text-yt-text-muted text-xs mt-0.5">
            {playlist.videoCount} {t('playlist_videos')}
          </p>
        </div>

        {/* Save button */}
        <button
          onClick={handleSave}
          className={`mt-2 self-start flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            saved
              ? 'bg-yt-secondary text-yt-text hover:bg-yt-hover border border-yt-border'
              : 'bg-yt-secondary text-yt-text hover:bg-yt-hover border border-yt-border'
          }`}
        >
          {saved ? (
            <>
              <BookmarkCheck className="w-3.5 h-3.5 text-yt-red" />
              {t('playlist_saved')}
            </>
          ) : (
            <>
              <BookmarkPlus className="w-3.5 h-3.5" />
              {t('playlist_save')}
            </>
          )}
        </button>
      </div>
    </div>
  )
}
