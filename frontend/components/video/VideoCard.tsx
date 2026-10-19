'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Bookmark, BookmarkCheck, ListPlus, ListChecks } from 'lucide-react'
import { VideoCard as VideoCardType } from '@/lib/api'
import { cn } from '@/lib/utils'
import { isInWatchLater, toggleWatchLater } from '@/lib/watchLater'
import { isInQueue, addToQueue, removeFromQueue } from '@/lib/queue'
import { getPositionEntry } from '@/lib/resumePosition'
import { imageSrc, ytThumbnail } from '@/lib/thumbnails'

interface VideoCardProps {
  video: VideoCardType
  layout?: 'grid' | 'list'
}

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
  // Reset on src change so a previously-failed load retries when a new URL arrives
  useEffect(() => { setImgFailed(false) }, [src])
  const letter = name ? name[0].toUpperCase() : '?'
  const sizeClass = size === 'sm' ? 'w-6 h-6 text-xs' : 'w-9 h-9 text-sm'

  if (src && !imgFailed) {
    const imgSrc = imageSrc(src)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imgSrc}
        alt={name}
        className={cn('rounded-full object-cover flex-shrink-0 ring-1 ring-yt-border/60', sizeClass)}
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
    '#ff4757', '#ff8f5c', '#e0567f', '#7c6cf2',
    '#2bb3a3', '#3b82f6', '#d9822b', '#6366f1',
  ]
  return colors[Math.abs(hash) % colors.length]
}

export default function VideoCard({ video, layout = 'grid' }: VideoCardProps) {
  const [saved, setSaved] = useState(false)
  const [inQueue, setInQueue] = useState(false)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    setSaved(isInWatchLater(video.id))
    setInQueue(isInQueue(video.id))
    const entry = getPositionEntry(video.id)
    setProgress(entry && entry.duration > 0 ? Math.min(100, (entry.position / entry.duration) * 100) : 0)
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
        thumbnail: ytThumbnail(video.id, 'mq'),
        duration: video.duration,
        channel: video.channel.name,
        channelId: video.channel.id,
      })
      setInQueue(true)
    }
  }

  const badge = video.isLive ? (
    <span className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-md bg-red-600 px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-white">
      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />LIVE
    </span>
  ) : video.duration ? (
    <span className="absolute bottom-2 right-2 rounded-md glass-chip px-1.5 py-0.5 text-[11px] font-semibold tabular-nums">
      {video.duration}
    </span>
  ) : null

  const progressBar = progress > 0 ? (
    <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/20">
      <div className="h-full bg-accent-gradient" style={{ width: `${progress}%` }} />
    </div>
  ) : null

  const meta = [video.views, video.published && video.published !== 'Unknown date' ? video.published : null]
    .filter(Boolean)
    .join(' · ')

  if (layout === 'list') {
    return (
      <div className="flex gap-3 group rounded-xl p-1 -m-1 transition-colors hover:bg-yt-hover/40">
        <Link href={`/watch/${video.id}`} className="flex-shrink-0">
          <div className="relative w-[168px] aspect-video rounded-xl overflow-hidden bg-yt-secondary ring-1 ring-inset ring-white/5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={ytThumbnail(video.id, 'mq')}
              alt=""
              className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
              loading="lazy"
            />
            {badge}
            {progressBar}
          </div>
        </Link>

        <div className="flex flex-col flex-1 min-w-0 py-0.5">
          <Link href={`/watch/${video.id}`}>
            <h3 className="text-yt-text text-sm font-semibold leading-snug line-clamp-2">
              {video.title}
            </h3>
          </Link>
          <Link
            href={video.channel.id ? `/channel/${video.channel.id}` : '#'}
            className="mt-1 text-xs text-yt-text-secondary hover:text-yt-text transition-colors truncate"
          >
            {video.channel.name}
          </Link>
          {meta && <p className="mt-0.5 text-xs text-yt-text-muted">{meta}</p>}
        </div>
      </div>
    )
  }

  // Grid layout (default)
  return (
    <div className="flex flex-col group">
      <Link href={`/watch/${video.id}`} className="block rounded-2xl">
        <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-yt-secondary ring-1 ring-inset ring-white/5 transition-all duration-300 ease-out group-hover:-translate-y-1 group-hover:shadow-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={ytThumbnail(video.id)}
            alt=""
            className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.06]"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          {badge}
          {progressBar}
          <div className="absolute top-2 right-2 flex gap-1.5">
            <button
              onClick={handleQueue}
              className={cn(
                'p-2 rounded-full transition-all duration-200',
                inQueue ? 'bg-accent-gradient text-white shadow-glow' : 'glass-chip opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 hover:bg-black/70',
              )}
              aria-label={inQueue ? 'Remove from queue' : 'Add to queue'}
              title={inQueue ? 'Remove from queue' : 'Add to queue'}
            >
              {inQueue ? <ListChecks className="w-4 h-4" /> : <ListPlus className="w-4 h-4" />}
            </button>
            <button
              onClick={handleWatchLater}
              className={cn(
                'p-2 rounded-full transition-all duration-200 delay-75',
                saved ? 'bg-accent-gradient text-white shadow-glow' : 'glass-chip opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 hover:bg-black/70',
              )}
              aria-label={saved ? 'Remove from Watch Later' : 'Save to Watch Later'}
              title={saved ? 'Remove from Watch Later' : 'Save to Watch Later'}
            >
              {saved ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </Link>

      <div className="flex gap-3 mt-3">
        <Link
          href={video.channel.id ? `/channel/${video.channel.id}` : '#'}
          className="flex-shrink-0 mt-0.5"
          aria-label={video.channel.name}
        >
          <ChannelAvatar name={video.channel.name} src={video.channel.thumbnail} />
        </Link>

        <div className="flex flex-col min-w-0 flex-1">
          <Link href={`/watch/${video.id}`}>
            <h3 className="text-yt-text text-[14.5px] font-semibold leading-snug line-clamp-2">
              {video.title}
            </h3>
          </Link>
          <Link
            href={video.channel.id ? `/channel/${video.channel.id}` : '#'}
            className="mt-1 text-[13px] text-yt-text-secondary hover:text-yt-text transition-colors truncate"
          >
            {video.channel.name}
          </Link>
          {meta && <p className="mt-0.5 text-[13px] text-yt-text-muted">{meta}</p>}
        </div>
      </div>
    </div>
  )
}
