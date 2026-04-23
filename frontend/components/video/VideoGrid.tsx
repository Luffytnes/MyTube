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
  compact: 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-3 gap-y-5',
  normal:  'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8',
  comfortable: 'grid grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-10',
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
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-yt-text-muted text-lg">{emptyMessage}</p>
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
