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
    <Link
      href={`/channel/${channel.id}`}
      className="flex items-center gap-5 px-4 py-4 rounded-xl hover:bg-yt-hover transition-colors group"
    >
      {/* Circular avatar */}
      <div className="flex-shrink-0">
        {channel.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={channel.thumbnail}
            alt={channel.name}
            className="w-20 h-20 rounded-full object-cover bg-yt-secondary"
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        ) : (
          <div className="w-20 h-20 rounded-full bg-yt-secondary flex items-center justify-center text-2xl font-bold text-yt-text-muted">
            {channel.name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-yt-text font-semibold text-base truncate">{channel.name}</p>
        <p className="text-yt-text-muted text-xs mt-0.5">
          {[channel.subscriberText, channel.videoCountText].filter(Boolean).join(' • ')}
        </p>
        {channel.description && (
          <p className="text-yt-text-secondary text-sm mt-1.5 line-clamp-2 leading-snug">
            {channel.description}
          </p>
        )}
      </div>

      {/* Subscribe button */}
      <button
        onClick={handleSubscribe}
        className={`flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
          subscribed
            ? 'bg-yt-secondary text-yt-text hover:bg-yt-hover border border-yt-border'
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
    </Link>
  )
}
