'use client'

import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

interface Props {
  title?: string
}

export default function MusicPageHeader({ title }: Props) {
  const router = useRouter()
  return (
    <div className="flex items-center gap-3 mb-6">
      <button
        onClick={() => router.back()}
        className="flex items-center justify-center w-9 h-9 rounded-full bg-yt-secondary hover:bg-yt-hover border border-yt-border text-yt-text-secondary hover:text-yt-text transition-colors flex-shrink-0"
        aria-label="Retour"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      {title && <h1 className="text-yt-text text-xl font-semibold truncate">{title}</h1>}
    </div>
  )
}
