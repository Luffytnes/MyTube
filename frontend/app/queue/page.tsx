'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ListVideo, Trash2, X, Play, ChevronUp, ChevronDown } from 'lucide-react'
import { getQueue, removeFromQueue, clearQueue, moveUp, moveDown, type QueueItem } from '@/lib/queue'
import { useRegion } from '@/lib/regionContext'

export default function QueuePage() {
  const { t } = useRegion()
  const [queue, setQueue] = useState<QueueItem[]>([])

  useEffect(() => {
    setQueue(getQueue())
  }, [])

  function handleRemove(id: string) {
    setQueue(removeFromQueue(id))
  }

  function handleClear() {
    clearQueue()
    setQueue([])
  }

  function handleMoveUp(id: string) {
    setQueue(moveUp(id))
  }

  function handleMoveDown(id: string) {
    setQueue(moveDown(id))
  }

  return (
    <div className="px-4 py-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-yt-text">{t('queue_title')}</h1>
        {queue.length > 0 && (
          <button
            onClick={handleClear}
            className="flex items-center gap-2 text-sm text-yt-text-muted hover:text-yt-text transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            {t('queue_clear')}
          </button>
        )}
      </div>

      {queue.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <ListVideo className="w-14 h-14 text-yt-text-muted mb-4" />
          <p className="text-yt-text text-lg font-medium mb-1">{t('queue_empty')}</p>
          <p className="text-yt-text-muted text-sm">{t('queue_empty_desc')}</p>
        </div>
      ) : (
        <>
          {/* Play all */}
          <Link
            href={`/watch/${queue[0].id}?queue=1`}
            className="flex items-center gap-2 px-5 py-2.5 mb-6 bg-yt-red hover:bg-yt-red-hover text-white rounded-full text-sm font-semibold w-fit transition-colors"
          >
            <Play className="w-4 h-4 fill-white" />
            {t('queue_play_all')}
          </Link>

          <div className="flex flex-col gap-2">
            {queue.map((item, idx) => (
              <div key={item.id} className="flex items-center gap-3 bg-yt-secondary border border-yt-border/60 rounded-xl p-2 group">
                <span className="text-yt-text-muted text-xs w-5 text-center flex-shrink-0">{idx + 1}</span>

                {/* Thumbnail */}
                <Link href={`/watch/${item.id}`} className="flex-shrink-0">
                  <div className="relative w-24 h-14 rounded-lg overflow-hidden bg-yt-bg">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.thumbnail} alt={item.title} className="w-full h-full object-cover" />
                    {item.duration && (
                      <span className="absolute bottom-1 right-1 bg-black/80 text-white text-[10px] px-1 py-0.5 rounded font-medium">
                        {item.duration}
                      </span>
                    )}
                  </div>
                </Link>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <Link href={`/watch/${item.id}`}>
                    <p className="text-yt-text text-sm font-medium line-clamp-2 leading-snug hover:text-yt-red transition-colors">{item.title}</p>
                  </Link>
                  <Link
                    href={item.channelId ? `/channel/${item.channelId}` : '#'}
                    className="text-yt-text-muted text-xs hover:text-yt-text transition-colors truncate block mt-0.5"
                  >
                    {item.channel}
                  </Link>
                </div>

                {/* Controls */}
                <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <button
                    onClick={() => handleMoveUp(item.id)}
                    disabled={idx === 0}
                    className="p-1 rounded hover:bg-yt-hover text-yt-text-muted hover:text-yt-text disabled:opacity-30 transition-colors"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleMoveDown(item.id)}
                    disabled={idx === queue.length - 1}
                    className="p-1 rounded hover:bg-yt-hover text-yt-text-muted hover:text-yt-text disabled:opacity-30 transition-colors"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>

                <button
                  onClick={() => handleRemove(item.id)}
                  className="p-1.5 rounded-full text-yt-text-muted hover:text-yt-text hover:bg-yt-hover opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
