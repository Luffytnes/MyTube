'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bookmark, BookmarkCheck, Play, Sparkles } from 'lucide-react'
import type { VideoCard } from '@/lib/api'
import { ytThumbnail } from '@/lib/thumbnails'
import { isInWatchLater, toggleWatchLater } from '@/lib/watchLater'
import { useRegion } from '@/lib/regionContext'

export function HeroBannerSkeleton() {
  return <div className="skeleton w-full h-[340px] sm:h-[420px] lg:h-[480px] rounded-[28px]" />
}

export default function HeroBanner({ video }: { video: VideoCard }) {
  const { t } = useRegion()
  const [saved, setSaved] = useState(false)
  // maxresdefault is missing for some videos: the proxy falls back to hq
  const backdrop = ytThumbnail(video.id, 'maxres')

  useEffect(() => { setSaved(isInWatchLater(video.id)) }, [video.id])

  function onWatchLater() {
    setSaved(toggleWatchLater({
      id: video.id,
      title: video.title,
      channel: video.channel.name,
      channelId: video.channel.id,
    }))
  }

  const meta = [video.channel.name, video.views, video.published !== 'Unknown date' ? video.published : null, video.duration]
    .filter(Boolean)

  return (
    <section className="relative w-full h-[340px] sm:h-[420px] lg:h-[480px] overflow-hidden rounded-[28px] ring-1 ring-inset ring-white/[0.06] bg-yt-secondary animate-fade-in">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={backdrop}
        alt=""
        className="absolute inset-0 w-full h-full object-cover animate-ken-burns will-change-transform"
      />
      {/* Cinematic scrims: readable copy on the left/bottom, light leak on the right */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/55 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
      <div className="absolute -right-24 -top-24 w-[420px] h-[420px] rounded-full bg-yt-red/25 blur-[90px]" />

      <div className="relative h-full flex flex-col justify-end p-6 sm:p-10 lg:p-12 max-w-3xl">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full glass-chip px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]">
          <Sparkles className="w-3.5 h-3.5 text-red-400" />
          {t('home_featured')}
        </span>

        <h1 className="mt-4 font-display text-[28px] sm:text-4xl lg:text-[44px] font-bold leading-[1.05] text-white line-clamp-2 [text-wrap:balance] drop-shadow-[0_2px_24px_rgba(0,0,0,0.5)]">
          {video.title}
        </h1>

        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/75">
          {meta.map((part, i) => (
            <span key={i} className="flex items-center gap-2">
              {i > 0 && <span className="w-1 h-1 rounded-full bg-white/40" />}
              {part}
            </span>
          ))}
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link href={`/watch/${video.id}`} className="btn-accent h-12 px-7 text-[15px]">
            <Play className="w-[18px] h-[18px] fill-white" />
            {t('home_watch_now')}
          </Link>
          <button
            onClick={onWatchLater}
            className="inline-flex items-center gap-2 h-12 px-5 rounded-full glass-chip text-sm font-semibold transition-all hover:bg-white/15 active:scale-[0.97]"
          >
            {saved ? <BookmarkCheck className="w-[18px] h-[18px] text-red-400" /> : <Bookmark className="w-[18px] h-[18px]" />}
            {t('nav_watchLater')}
          </button>
        </div>
      </div>
    </section>
  )
}
