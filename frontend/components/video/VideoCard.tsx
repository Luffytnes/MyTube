'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Bookmark, BookmarkCheck, ListPlus, ListChecks } from 'lucide-react'
import { VideoCard as VideoCardType } from '@/lib/api'
import { cn } from '@/lib/utils'
import { isInWatchLater, toggleWatchLater } from '@/lib/watchLater'
import { isInQueue, addToQueue, removeFromQueue } from '@/lib/queue'

interface VideoCardProps {
  video: VideoCardType
  layout?: 'grid' | 'list'
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

function ChannelAvatar({
  name,
  src,
  size = 'md',
}: {
  name: string
  src?: string | null
  size?: 'sm' | 'md'
}) {
  const [imgFailed, setImgFailed] = useState(false)
  const letter = name ? name[0].toUpperCase() : '?'
  const sizeClass = size === 'sm' ? 'w-6 h-6 text-xs' : 'w-9 h-9 text-sm'

  if (src && !imgFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`${API_BASE}${src.startsWith('/') ? src : '/' + src}`}
        alt={name}
        className={cn('rounded-full object-cover flex-shrink-0', sizeClass)}
        onError={() => setImgFailed(true)}
      />
    )
  }

  return (
    <div
      className={cn(
        'rounded-full flex-shrink-0 flex items-center justify-center font-medium text-white',
        sizeClass
      )}
      style={{ background: stringToColor(name) }}
    >
      {letter}
    </div>
  )
}

function stringToColor(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  const colors = [
    '#1a73e8', '#d93025', '#188038', '#e37400',
    '#8430ce', '#007b83', '#c5221f', '#0d652d',
  ]
  return colors[Math.abs(hash) % colors.length]
}

export default function VideoCard({ video, layout = 'grid' }: VideoCardProps) {
  const [saved, setSaved] = useState(false)
  const [inQueue, setInQueue] = useState(false)

  useEffect(() => {
    setSaved(isInWatchLater(video.id))
    setInQueue(isInQueue(video.id))
  }, [video.id])

  function handleWatchLater(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const isNowSaved = toggleWatchLater({
      id: video.id,
      title: video.title,
      channel: video.channel.name,
      channelId: video.channel.id,
    })
    setSaved(isNowSaved)
  }

  function handleQueue(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (inQueue) {
      removeFromQueue(video.id)
      setInQueue(false)
    } else {
      addToQueue({
        id: video.id,
        title: video.title,
        thumbnail: `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`,
        duration: video.duration,
        channel: video.channel.name,
        channelId: video.channel.id,
      })
      setInQueue(true)
    }
  }

  if (layout === 'list') {
    return (
      <div className="flex gap-2 group">
        {/* Thumbnail */}
        <Link href={`/watch/${video.id}`} className="flex-shrink-0">
          <div className="relative w-[168px] h-[94px] rounded-xl overflow-hidden bg-yt-secondary thumbnail-wrapper">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${API_BASE}/api/thumbnail/${video.id}`}
              alt={video.title}
              className="w-full h-full object-cover"
              loading="lazy"
            />
            {/* Duration badge */}
            {video.duration && (
              <span className="absolute bottom-1 right-1 bg-black/80 text-white text-xs px-1 py-0.5 rounded font-medium">
                {video.duration}
              </span>
            )}
          </div>
        </Link>

        {/* Text content */}
        <div className="flex flex-col flex-1 min-w-0 py-0.5">
          <Link href={`/watch/${video.id}`}>
            <h3 className="text-yt-text text-sm font-medium leading-snug line-clamp-2 group-hover:text-yt-text transition-colors">
              {video.title}
            </h3>
          </Link>
          <Link
            href={video.channel.id ? `/channel/${video.channel.id}` : '#'}
            className="mt-1 text-xs text-yt-text-muted hover:text-yt-text transition-colors truncate"
          >
            {video.channel.name}
          </Link>
          <p className="mt-0.5 text-xs text-yt-text-muted">
            {video.views}{video.published && video.published !== 'Unknown date' ? ` • ${video.published}` : ''}
          </p>
        </div>
      </div>
    )
  }

  // Grid layout (default)
  return (
    <div className="flex flex-col group cursor-pointer">
      {/* Thumbnail */}
      <Link href={`/watch/${video.id}`} className="block">
        <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-yt-secondary thumbnail-wrapper">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`}
            alt={video.title}
            className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
            loading="lazy"
          />
          {/* Duration badge */}
          {video.duration && (
            <span className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-1.5 py-0.5 rounded font-medium">
              {video.duration}
            </span>
          )}
          {/* Watch Later button */}
          <button
            onClick={handleWatchLater}
            className={cn(
              'absolute top-2 right-2 p-1.5 rounded-full transition-all',
              'opacity-0 group-hover:opacity-100',
              saved
                ? 'bg-blue-600 text-white opacity-100'
                : 'bg-black/70 text-white hover:bg-black/90'
            )}
            aria-label={saved ? 'Remove from Watch Later' : 'Save to Watch Later'}
          >
            {saved ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
          </button>
          {/* Queue button */}
          <button
            onClick={handleQueue}
            className={cn(
              'absolute top-2 left-2 p-1.5 rounded-full transition-all',
              'opacity-0 group-hover:opacity-100',
              inQueue
                ? 'bg-yt-red text-white opacity-100'
                : 'bg-black/70 text-white hover:bg-black/90'
            )}
            aria-label={inQueue ? 'Remove from queue' : 'Add to queue'}
          >
            {inQueue ? <ListChecks className="w-4 h-4" /> : <ListPlus className="w-4 h-4" />}
          </button>
        </div>
      </Link>

      {/* Video info */}
      <div className="flex gap-3 mt-3 px-0">
        {/* Channel avatar */}
        <Link
          href={video.channel.id ? `/channel/${video.channel.id}` : '#'}
          className="flex-shrink-0 mt-0.5"
        >
          <ChannelAvatar
            name={video.channel.name}
            src={video.channel.thumbnail}
          />
        </Link>

        {/* Text */}
        <div className="flex flex-col min-w-0 flex-1">
          <Link href={`/watch/${video.id}`}>
            <h3 className="text-yt-text text-sm font-medium leading-snug line-clamp-2 group-hover:text-yt-text transition-colors">
              {video.title}
            </h3>
          </Link>
          <Link
            href={video.channel.id ? `/channel/${video.channel.id}` : '#'}
            className="mt-1 text-xs text-yt-text-muted hover:text-yt-text transition-colors truncate"
          >
            {video.channel.name}
          </Link>
          <p className="mt-0.5 text-xs text-yt-text-muted">
            {video.views}{video.published && video.published !== 'Unknown date' ? ` • ${video.published}` : ''}
          </p>
        </div>
      </div>
    </div>
  )
}
