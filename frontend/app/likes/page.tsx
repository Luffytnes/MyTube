'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ThumbsUp, X, Trash2, ExternalLink } from 'lucide-react'
import { useRegion } from '@/lib/regionContext'
import { getLikes, removeLike, clearLikes, type LikeEntry } from '@/lib/likes'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export default function LikesPage() {
  const { t } = useRegion()
  const [entries, setEntries] = useState<LikeEntry[]>([])

  useEffect(() => {
    setEntries(getLikes())
  }, [])

  function handleRemove(id: string) {
    removeLike(id)
    setEntries((prev) => prev.filter((e) => e.id !== id))
  }

  function handleClearAll() {
    clearLikes()
    setEntries([])
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center px-4 max-w-4xl mx-auto">
        <ThumbsUp className="w-16 h-16 text-yt-text-muted mb-4" />
        <p className="text-yt-text text-xl font-medium mb-2">{t('likes_title')}</p>
        <p className="text-yt-text-muted text-sm">{t('likes_empty')}</p>
      </div>
    )
  }

  return (
    <div className="px-4 py-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ThumbsUp className="w-6 h-6 text-yt-text-muted" />
          <h1 className="text-yt-text text-2xl font-bold">{t('likes_title')}</h1>
          <span className="text-yt-text-muted text-sm">({entries.length})</span>
        </div>
        <button
          onClick={handleClearAll}
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-yt-secondary hover:bg-yt-hover text-yt-text-muted hover:text-yt-text border border-yt-border text-sm font-medium transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          <span className="hidden sm:block">{t('history_clear')}</span>
        </button>
      </div>

      {/* Video list */}
      <div className="flex flex-col gap-3">
        {entries.map((entry) => (
          <div key={entry.id} className="flex gap-3 group items-start">
            {/* Thumbnail */}
            <Link href={`/watch/${entry.id}`} className="flex-shrink-0">
              <div className="relative w-[160px] h-[90px] sm:w-[200px] sm:h-[112px] rounded-xl overflow-hidden bg-yt-secondary">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`${API_BASE}/api/thumbnail/${entry.id}`}
                  alt={entry.title}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
            </Link>

            {/* Info */}
            <div className="flex-1 min-w-0 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link href={`/watch/${entry.id}`}>
                  <h3 className="text-yt-text text-sm font-medium leading-snug line-clamp-2 hover:text-yt-red transition-colors">
                    {entry.title}
                  </h3>
                </Link>
                <Link
                  href={entry.channelId ? `/channel/${entry.channelId}` : '#'}
                  className="mt-1 text-xs text-yt-text-muted hover:text-yt-text transition-colors block truncate"
                >
                  {entry.channel}
                </Link>
                <a
                  href={`https://www.youtube.com/watch?v=${entry.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs text-yt-text-muted hover:text-yt-red transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  {t('likes_open_youtube')}
                </a>
              </div>

              {/* Remove button */}
              <button
                onClick={() => handleRemove(entry.id)}
                className="flex-shrink-0 p-1.5 rounded-full text-yt-text-muted hover:text-yt-text hover:bg-yt-hover transition-colors opacity-0 group-hover:opacity-100"
                aria-label="Remove"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
