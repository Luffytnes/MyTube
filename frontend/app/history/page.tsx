'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Trash2, History, X } from 'lucide-react'
import { useRegion } from '@/lib/regionContext'
import { getHistory, clearHistory, removeFromHistory, type HistoryEntry } from '@/lib/history'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

function timeAgo(ts: number): string {
  const diff = (Date.now() - ts) / 1000
  if (diff < 60) return 'Just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return new Date(ts).toLocaleDateString()
}

export default function HistoryPage() {
  const { t } = useRegion()
  const [items, setItems] = useState<HistoryEntry[]>([])

  useEffect(() => {
    setItems(getHistory())
  }, [])

  function handleClear() {
    clearHistory()
    setItems([])
  }

  function handleRemove(id: string) {
    setItems(removeFromHistory(id))
  }

  return (
    <div className="px-4 py-6 max-w-4xl mx-auto min-h-screen">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-yt-text text-2xl font-bold flex items-center gap-3">
          <History className="w-7 h-7" />
          {t('history_title')}
        </h1>
        {items.length > 0 && (
          <button
            onClick={handleClear}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-yt-secondary hover:bg-yt-hover border border-yt-border text-yt-text-secondary hover:text-yt-text text-sm transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            {t('history_clear')}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <History className="w-16 h-16 text-yt-text-muted mb-4" />
          <p className="text-yt-text-muted text-lg">{t('history_empty')}</p>
        </div>
      ) : (
        <div className="space-y-1">
          {items.map((item) => (
            <div
              key={`${item.id}-${item.watchedAt}`}
              className="flex items-center gap-3 group p-2 rounded-xl hover:bg-yt-secondary transition-colors"
            >
              <Link href={`/watch/${item.id}`} className="flex-shrink-0">
                <div className="relative w-36 h-20 rounded-lg overflow-hidden bg-yt-secondary">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`${API_BASE}/api/thumbnail/${item.id}`}
                    alt={item.title}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
              </Link>

              <div className="flex-1 min-w-0">
                <Link href={`/watch/${item.id}`}>
                  <p className="text-yt-text text-sm font-medium line-clamp-2 hover:text-white transition-colors">
                    {item.title}
                  </p>
                </Link>
                <Link
                  href={item.channelId ? `/channel/${item.channelId}` : '#'}
                  className="text-xs text-yt-text-muted hover:text-yt-text transition-colors mt-0.5 block"
                >
                  {item.channel}
                </Link>
                <p className="text-xs text-yt-text-muted mt-0.5">{timeAgo(item.watchedAt)}</p>
              </div>

              <button
                onClick={() => handleRemove(item.id)}
                className="p-2 rounded-full opacity-0 group-hover:opacity-100 hover:bg-yt-hover text-yt-text-muted hover:text-yt-text transition-all flex-shrink-0"
                aria-label="Remove from history"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
