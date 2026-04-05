'use client'

import VideoCard from './VideoCard'
import { VideoGridSkeleton } from '@/components/ui/Skeleton'
import type { VideoCard as VideoCardType } from '@/lib/api'

interface VideoGridProps {
  videos: VideoCardType[]
  loading?: boolean
  emptyMessage?: string
}

export default function VideoGrid({
  videos,
  loading = false,
  emptyMessage = 'No videos found',
}: VideoGridProps) {
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
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8">
      {videos.map((video) => (
        <VideoCard key={video.id} video={video} layout="grid" />
      ))}
    </div>
  )
}
