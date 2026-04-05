'use client'

import { cn } from '@/lib/utils'

interface SkeletonProps {
  className?: string
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse rounded bg-yt-secondary',
        className
      )}
    />
  )
}

export function VideoCardSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {/* Thumbnail */}
      <Skeleton className="w-full aspect-video rounded-xl" />
      <div className="flex gap-3 px-1">
        {/* Avatar */}
        <Skeleton className="w-9 h-9 rounded-full flex-shrink-0 mt-0.5" />
        <div className="flex flex-col gap-2 flex-1">
          {/* Title lines */}
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          {/* Channel name */}
          <Skeleton className="h-3.5 w-1/2 mt-0.5" />
          {/* Views / date */}
          <Skeleton className="h-3.5 w-2/3" />
        </div>
      </div>
    </div>
  )
}

export function VideoCardListSkeleton() {
  return (
    <div className="flex gap-2">
      {/* Thumbnail */}
      <Skeleton className="w-[168px] h-[94px] rounded-xl flex-shrink-0" />
      <div className="flex flex-col gap-2 flex-1 py-1">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-3 w-1/2 mt-1" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  )
}

export function VideoGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <VideoCardSkeleton key={i} />
      ))}
    </div>
  )
}

export function WatchPageSkeleton() {
  return (
    <div className="flex gap-6 max-w-screen-2xl mx-auto">
      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Player */}
        <Skeleton className="w-full aspect-video rounded-xl" />
        <div className="mt-4 space-y-3">
          <Skeleton className="h-6 w-3/4" />
          <div className="flex gap-4 items-center">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
          </div>
          <div className="flex gap-3 items-center pt-2">
            <Skeleton className="w-10 h-10 rounded-full" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="ml-auto h-9 w-24 rounded-full" />
          </div>
          <Skeleton className="h-24 w-full rounded-xl mt-2" />
        </div>
      </div>
      {/* Sidebar */}
      <div className="w-96 flex-shrink-0 space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <VideoCardListSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}
