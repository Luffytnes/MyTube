'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Bell, Mic2, Trash2 } from 'lucide-react'
import {
  getPodcastSubscriptions, unsubscribePodcast, type PodcastSubscription,
} from '@/lib/podcastSubscriptions'
import { useRegion } from '@/lib/regionContext'

export default function PodcastSubscriptionsPage() {
  const { t } = useRegion()
  const [subs, setSubs] = useState<PodcastSubscription[]>([])

  useEffect(() => { setSubs(getPodcastSubscriptions()) }, [])

  function handleUnsubscribe(browseId: string) {
    unsubscribePodcast(browseId)
    setSubs(getPodcastSubscriptions())
  }

  return (
    <div className="px-4 py-6 max-w-3xl mx-auto min-h-screen">
      <div className="flex items-center gap-3 mb-6">
        <Bell className="w-6 h-6 text-yt-red flex-shrink-0" />
        <h1 className="text-yt-text text-2xl font-bold">{t('podcast_my_subscriptions')}</h1>
      </div>

      {subs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Mic2 className="w-16 h-16 text-yt-text-muted mb-4" />
          <p className="text-yt-text text-lg font-medium mb-1">{t('podcast_no_subscriptions')}</p>
          <p className="text-yt-text-muted text-sm">{t('podcast_no_subscriptions_desc')}</p>
          <Link
            href="/music/podcasts"
            className="mt-6 flex items-center gap-2 px-5 py-2.5 bg-yt-red hover:bg-yt-red-hover text-white rounded-full text-sm font-medium transition-colors"
          >
            {t('podcast_discover')}
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {subs.map((p) => (
            <div key={p.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-yt-secondary transition-colors group">
              <Link href={`/music/podcasts/${p.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-14 h-14 rounded-xl overflow-hidden bg-yt-hover flex-shrink-0">
                  {p.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.thumbnail} alt={p.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Mic2 className="w-6 h-6 text-yt-text-muted" />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-yt-text truncate group-hover:text-yt-red transition-colors">{p.title}</p>
                  {p.author && <p className="text-xs text-yt-text-muted truncate mt-0.5">{p.author}</p>}
                </div>
              </Link>
              <button
                onClick={() => handleUnsubscribe(p.id)}
                className="p-2 rounded-full opacity-0 group-hover:opacity-100 hover:bg-yt-hover text-yt-text-muted hover:text-red-400 transition-all flex-shrink-0"
                aria-label={t('podcast_unfollow')}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
