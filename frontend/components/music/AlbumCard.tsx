'use client'

import Link from 'next/link'
import { Music } from 'lucide-react'

interface AlbumCardProps {
  browseId: string
  title: string
  artists?: { name: string }[]
  year?: string | number | null
  thumbnail?: string | null
  type?: 'album' | 'single' | 'ep' | string
}

export default function AlbumCard({ browseId, title, artists, year, thumbnail, type }: AlbumCardProps) {
  const subtitle = [
    type && type !== 'Album' ? type : null,
    year,
    artists?.map((a) => a.name).join(', '),
  ].filter(Boolean).join(' • ')

  return (
    <Link href={`/music/album/${browseId}`} className="flex flex-col gap-2 group cursor-pointer">
      <div className="relative aspect-square rounded-xl overflow-hidden bg-yt-secondary shadow-lg">
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnail}
            alt={title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Music className="w-10 h-10 text-yt-text-muted" />
          </div>
        )}
      </div>
      <div>
        <p className="text-yt-text text-sm font-medium truncate group-hover:text-yt-red transition-colors">{title}</p>
        {subtitle && <p className="text-yt-text-muted text-xs truncate mt-0.5">{subtitle}</p>}
      </div>
    </Link>
  )
}
