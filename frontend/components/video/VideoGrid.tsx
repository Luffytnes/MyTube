'use client'

import { useState, useEffect } from 'react'
import VideoCard from './VideoCard'
import { VideoGridSkeleton } from '@/components/ui/Skeleton'
import type { VideoCard as VideoCardType } from '@/lib/api'
import { getPlaybackSettings } from '@/lib/playbackSettings'

interface VideoGridProps {
  videos: VideoCardType[]
  loading?: boolean
  emptyMessage?: string
}

const DENSITY_CLASSES = {
  compact: 'stagger grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-x-3 gap-y-6',
  normal:  'stagger grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-x-5 gap-y-9',
  comfortable: 'stagger grid grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-x-7 gap-y-11',
}

export default function VideoGrid({
  videos,
  loading = false,
  emptyMessage = 'No videos found',
}: VideoGridProps) {
  const [density, setDensity] = useState<'compact' | 'normal' | 'comfortable'>('normal')

  useEffect(() => {
    setDensity(getPlaybackSettings().gridDensity)
    function onSettingsChange(e: Event) {
      const s = (e as CustomEvent<ReturnType<typeof getPlaybackSettings>>).detail
      setDensity(s.gridDensity)
    }
    window.addEventListener('mytube-settings-change', onSettingsChange)
    return () => window.removeEventListener('mytube-settings-change', onSettingsChange)
  }, [])

  if (loading) {
    return <VideoGridSkeleton count={12} />
  }

  if (!videos || videos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center animate-fade-up">
        <p className="font-display text-xl font-semibold text-yt-text">{emptyMessage}</p>
        <p className="text-yt-text-muted text-sm mt-2">Try a different search or check back later.</p>
      </div>
    )
  }

  return (
    <div className={DENSITY_CLASSES[density]}>
      {videos.map((video) => (
        <VideoCard key={video.id} video={video} layout="grid" />
      ))}
    </div>
  )
}
