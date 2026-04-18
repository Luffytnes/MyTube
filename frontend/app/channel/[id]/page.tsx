'use client'

import { useState, useEffect, useCallback } from 'react'
import { getChannel, getChannelVideos } from '@/lib/api'
import type { ChannelInfo, VideoCard } from '@/lib/api'
import VideoGrid from '@/components/video/VideoGrid'
import { VideoGridSkeleton } from '@/components/ui/Skeleton'
import { Skeleton } from '@/components/ui/Skeleton'
import { formatSubscribers } from '@/lib/utils'
import { Bell, BellOff } from 'lucide-react'
import { useRegion } from '@/lib/regionContext'
import { useSubscriptions } from '@/lib/subscriptionsContext'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

type TabKey = 'videos' | 'playlists' | 'about'
const TABS: { key: TabKey; labelKey: 'tab_videos' | 'tab_playlists' | 'tab_about' }[] = [
  { key: 'videos', labelKey: 'tab_videos' },
  { key: 'playlists', labelKey: 'tab_playlists' },
  { key: 'about', labelKey: 'tab_about' },
]

function ChannelHeaderSkeleton() {
  return (
    <div className="animate-pulse">
      <Skeleton className="w-full h-32 sm:h-48 rounded-none" />
      <div className="px-4 py-6 flex items-start gap-4">
        <Skeleton className="w-20 h-20 rounded-full flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
    </div>
  )
}

interface ChannelPageProps {
  params: { id: string }
}

export default function ChannelPage({ params }: ChannelPageProps) {
  const { id } = params
  const { t } = useRegion()
  const { isSubscribed, toggle: toggleSubscription } = useSubscriptions()
  const [channel, setChannel] = useState<ChannelInfo | null>(null)
  const [videos, setVideos] = useState<VideoCard[]>([])
  const [channelLoading, setChannelLoading] = useState(true)
  const [videosLoading, setVideosLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('videos')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const subscribed = isSubscribed(id)

  const loadChannel = useCallback(async () => {
    setChannelLoading(true)
    try {
      const data = await getChannel(id)
      setChannel(data)
      document.title = `${data.name} - MyTube`
    } catch (err) {
      setError(t('error_channel'))
      console.error(err)
    } finally {
      setChannelLoading(false)
    }
  }, [id, t])

  const loadVideos = useCallback(
    async (p: number, reset: boolean) => {
      setVideosLoading(true)
      try {
        const data = await getChannelVideos(id, p)
        if (reset) {
          setVideos(data.videos)
        } else {
          setVideos((prev) => [...prev, ...data.videos])
        }
        setHasMore(data.videos.length > 0)
      } catch (err) {
        console.error(err)
      } finally {
        setVideosLoading(false)
      }
    },
    [id]
  )

  useEffect(() => {
    loadChannel()
    loadVideos(1, true)
    return () => {
      document.title = 'MyTube - Privacy-focused Video'
    }
  }, [loadChannel, loadVideos])

  function loadMoreVideos() {
    const nextPage = page + 1
    setPage(nextPage)
    loadVideos(nextPage, false)
  }

  if (channelLoading) {
    return (
      <div>
        <ChannelHeaderSkeleton />
        <div className="px-4 py-6">
          <VideoGridSkeleton count={8} />
        </div>
      </div>
    )
  }

  if (error || !channel) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center px-4">
        <p className="text-yt-text text-xl font-medium mb-2">{t('channelNotFound')}</p>
        <p className="text-yt-text-muted text-sm mb-6">{error}</p>
        <button
          onClick={loadChannel}
          className="px-6 py-2.5 bg-yt-red hover:bg-yt-red-hover text-white rounded-full text-sm font-medium transition-colors"
        >
          {t('retry')}
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      {/* Channel banner */}
      <div className="w-full h-32 sm:h-40 md:h-48 bg-gradient-to-br from-yt-secondary to-yt-hover overflow-hidden">
        {channel.banner && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`${API_BASE}${channel.banner.startsWith('/') ? channel.banner : '/' + channel.banner}`}
            alt="Channel banner"
            className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        )}
      </div>

      {/* Channel info */}
      <div className="px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-start gap-4 border-b border-yt-border">
        {/* Avatar */}
        <div className="flex-shrink-0">
          {channel.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`${API_BASE}${channel.thumbnail.startsWith('/') ? channel.thumbnail : '/' + channel.thumbnail}`}
              alt={channel.name}
              className="w-20 h-20 sm:w-24 sm:h-24 rounded-full object-cover border-4 border-yt-bg"
              onError={(e) => {
                const img = e.target as HTMLImageElement
                img.style.display = 'none'
              }}
            />
          ) : (
            <div
              className="w-20 h-20 sm:w-24 sm:h-24 rounded-full border-4 border-yt-bg flex items-center justify-center text-3xl font-bold text-white"
              style={{ background: '#1a73e8' }}
            >
              {channel.name[0]?.toUpperCase()}
            </div>
          )}
        </div>

        {/* Channel meta */}
        <div className="flex-1 min-w-0">
          <h1 className="text-yt-text text-2xl sm:text-3xl font-bold">{channel.name}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-1 text-sm text-yt-text-muted">
            <span>@{id}</span>
            {channel.subscriberCount > 0 && (
              <>
                <span>•</span>
                <span>{formatSubscribers(channel.subscriberCount)}</span>
              </>
            )}
            {channel.videoCount > 0 && (
              <>
                <span>•</span>
                <span>{channel.videoCount} {t('sub_videos')}</span>
              </>
            )}
          </div>
          {channel.description && (
            <p className="mt-2 text-sm text-yt-text-secondary line-clamp-2">
              {channel.description}
            </p>
          )}
        </div>

        {/* Subscribe buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => {
              if (!channel) return
              toggleSubscription({ id, name: channel.name, thumbnail: channel.thumbnail })
            }}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-colors ${
              subscribed
                ? 'bg-yt-secondary hover:bg-yt-hover text-yt-text border border-yt-border'
                : 'bg-yt-text text-yt-bg hover:bg-yt-text-secondary'
            }`}
          >
            {subscribed ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
            {subscribed ? t('nav_subscriptions') : t('subscribe')}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center border-b border-yt-border px-4 sm:px-6">
        {TABS.map(({ key, labelKey }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === key
                ? 'border-yt-text text-yt-text'
                : 'border-transparent text-yt-text-muted hover:text-yt-text hover:border-yt-text-muted'
            }`}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="px-4 sm:px-6 py-6">
        {activeTab === 'videos' && (
          <>
            <VideoGrid
              videos={videos}
              loading={videosLoading && page === 1}
              emptyMessage={t('noChannelVideos')}
            />
            {!videosLoading && hasMore && videos.length > 0 && (
              <div className="flex justify-center mt-8">
                <button
                  onClick={loadMoreVideos}
                  className="px-8 py-3 bg-yt-secondary hover:bg-yt-hover border border-yt-border text-yt-text rounded-full text-sm font-medium transition-colors"
                >
                  {t('loadMore')}
                </button>
              </div>
            )}
            {videosLoading && page > 1 && (
              <div className="flex justify-center mt-8">
                <div className="w-8 h-8 border-2 border-yt-border border-t-yt-text rounded-full animate-spin" />
              </div>
            )}
          </>
        )}

        {activeTab === 'playlists' && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-yt-text-muted text-lg">{t('noPlaylists')}</p>
          </div>
        )}

        {activeTab === 'about' && (
          <div className="max-w-2xl">
            <h2 className="text-yt-text font-semibold text-lg mb-4">{t('tab_about')}</h2>
            {channel.description ? (
              <div className="bg-yt-secondary rounded-xl p-5">
                <p className="text-yt-text text-sm leading-relaxed whitespace-pre-wrap">
                  {channel.description}
                </p>
              </div>
            ) : (
              <p className="text-yt-text-muted">{t('noDescription')}</p>
            )}

            <div className="mt-6 space-y-3">
              {channel.subscriberCount > 0 && (
                <div className="flex items-center gap-3 text-yt-text-secondary text-sm">
                  <span className="font-medium text-yt-text capitalize">{t('sub_subscribers')}:</span>
                  <span>{channel.subscriberCount.toLocaleString()}</span>
                </div>
              )}
              {channel.videoCount > 0 && (
                <div className="flex items-center gap-3 text-yt-text-secondary text-sm">
                  <span className="font-medium text-yt-text capitalize">{t('sub_videos')}:</span>
                  <span>{channel.videoCount.toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
