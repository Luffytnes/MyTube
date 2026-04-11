'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { UserCheck, UserPlus } from 'lucide-react'
import type { ChannelSearchResult } from '@/lib/api'
import { isSubscribed, toggleSubscription } from '@/lib/subscriptions'
import { useRegion } from '@/lib/regionContext'

interface Props {
  channel: ChannelSearchResult
}

export default function ChannelCard({ channel }: Props) {
  const { t } = useRegion()
  const [subscribed, setSubscribed] = useState(false)

  useEffect(() => {
    setSubscribed(isSubscribed(channel.id))
  }, [channel.id])

  function handleSubscribe(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const next = toggleSubscription({
      id: channel.id,
      name: channel.name,
      thumbnail: channel.thumbnail,
    })
    setSubscribed(next)
  }

  return (
    <div className="flex flex-col items-center text-center gap-3 p-4 rounded-xl bg-yt-secondary hover:bg-yt-hover transition-colors">
      {/* Circular avatar — links to channel */}
      <Link href={`/channel/${channel.id}`} className="flex-shrink-0">
        {channel.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={channel.thumbnail}
            alt={channel.name}
            className="w-24 h-24 rounded-full object-cover bg-yt-bg"
            onError={(e) => {
              const el = e.target as HTMLImageElement
              el.style.display = 'none'
              el.nextElementSibling?.classList.remove('hidden')
            }}
          />
        ) : null}
        <div className={`w-24 h-24 rounded-full bg-yt-bg flex items-center justify-center text-3xl font-bold text-yt-text-muted ${channel.thumbnail ? 'hidden' : ''}`}>
          {channel.name.charAt(0).toUpperCase()}
        </div>
      </Link>

      {/* Name + meta */}
      <div className="min-w-0 w-full">
        <Link
          href={`/channel/${channel.id}`}
          className="text-yt-text font-semibold text-sm truncate block hover:text-yt-red transition-colors"
        >
          {channel.name}
        </Link>
        {(channel.subscriberText || channel.videoCountText) && (
          <p className="text-yt-text-muted text-xs mt-0.5 truncate">
            {[channel.subscriberText, channel.videoCountText].filter(Boolean).join(' • ')}
          </p>
        )}
        {channel.description && (
          <p className="text-yt-text-secondary text-xs mt-1.5 line-clamp-2 leading-snug text-left">
            {channel.description}
          </p>
        )}
      </div>

      {/* Subscribe button — outside any Link so no navigation on click */}
      <button
        onClick={handleSubscribe}
        className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
          subscribed
            ? 'bg-yt-bg text-yt-text hover:bg-yt-hover border border-yt-border'
            : 'bg-yt-text text-yt-bg hover:bg-yt-text/90'
        }`}
      >
        {subscribed ? (
          <>
            <UserCheck className="w-4 h-4" />
            {t('subscribe_active')}
          </>
        ) : (
          <>
            <UserPlus className="w-4 h-4" />
            {t('subscribe')}
          </>
        )}
      </button>
    </div>
  )
}
