'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { getVideo } from '@/lib/api'
import { saveToHistory } from '@/lib/history'
import { useRegion } from '@/lib/regionContext'
import type { VideoDetail } from '@/lib/api'
import VideoPlayer from '@/components/video/VideoPlayer'
import VideoCard from '@/components/video/VideoCard'
import DownloadModal from '@/components/video/DownloadModal'
import { WatchPageSkeleton } from '@/components/ui/Skeleton'
import {
  ThumbsUp,
  ThumbsDown,
  Share2,
  Download,
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  ChevronUp,
  Bell,
} from 'lucide-react'
import { formatSubscribers } from '@/lib/utils'
import { isInWatchLater, toggleWatchLater } from '@/lib/watchLater'
import { useSubscriptions } from '@/lib/subscriptionsContext'
import { BellOff } from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

function ChannelAvatar({
  name,
  src,
  size = 'md',
}: {
  name: string
  src?: string | null
  size?: 'sm' | 'md' | 'lg'
}) {
  const sizeMap = {
    sm: 'w-8 h-8 text-sm',
    md: 'w-10 h-10 text-base',
    lg: 'w-12 h-12 text-lg',
  }
  const letter = name ? name[0].toUpperCase() : '?'

  const colors = [
    '#1a73e8', '#d93025', '#188038', '#e37400',
    '#8430ce', '#007b83', '#c5221f', '#0d652d',
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const bgColor = colors[Math.abs(hash) % colors.length]

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`${API_BASE}${src.startsWith('/') ? src : '/' + src}`}
        alt={name}
        className={`rounded-full object-cover flex-shrink-0 ${sizeMap[size]}`}
        onError={(e) => {
          const img = e.target as HTMLImageElement
          img.style.display = 'none'
        }}
      />
    )
  }

  return (
    <div
      className={`rounded-full flex-shrink-0 flex items-center justify-center font-semibold text-white ${sizeMap[size]}`}
      style={{ background: bgColor }}
    >
      {letter}
    </div>
  )
}

interface WatchPageProps {
  params: { id: string }
}

export default function WatchPage({ params }: WatchPageProps) {
  const { id } = params
  const { t } = useRegion()
  const { isSubscribed, toggle: toggleSubscription } = useSubscriptions()
  const [video, setVideo] = useState<VideoDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [descExpanded, setDescExpanded] = useState(false)
  const [showDownload, setShowDownload] = useState(false)
  const [liked, setLiked] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setSaved(isInWatchLater(id))
  }, [id])

  const loadVideo = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getVideo(id)
      setVideo(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load video. The video may be unavailable.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadVideo()
  }, [loadVideo])

  // Update page title + save to history
  useEffect(() => {
    if (video) {
      document.title = `${video.title} - MyTube`
      saveToHistory({
        id: video.id,
        title: video.title,
        channel: video.channel.name,
        channelId: video.channel.id,
      })
    }
    return () => { document.title = 'MyTube - Privacy-focused Video' }
  }, [video])

  if (loading) {
    return (
      <div className="px-4 py-6 max-w-screen-2xl mx-auto">
        <WatchPageSkeleton />
      </div>
    )
  }

  if (error || !video) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center px-4">
        <p className="text-yt-text text-xl font-medium mb-2">{t('videoUnavailable')}</p>
        <p className="text-yt-text-muted text-sm mb-6 max-w-sm">
          {error || t('error_video')}
        </p>
        <button
          onClick={loadVideo}
          className="px-6 py-2.5 bg-yt-red hover:bg-yt-red-hover text-white rounded-full text-sm font-medium transition-colors"
        >
          {t('retry')}
        </button>
      </div>
    )
  }

  return (
    <div className="px-4 py-6">
      <div className="flex gap-6 max-w-screen-2xl mx-auto flex-col lg:flex-row">
        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Video Player */}
          <VideoPlayer
            videoId={id}
            formats={video.formats}
            title={video.title}
            isLive={video.isLive}
          />

          {/* Title */}
          <h1 className="text-yt-text text-xl font-semibold mt-4 leading-snug">
            {video.title}
          </h1>

          {/* Action bar */}
          <div className="flex flex-wrap items-center gap-2 mt-3 pb-4 border-b border-yt-border">
            <span className="text-yt-text-muted text-sm">
              {video.views}
            </span>
            <span className="text-yt-text-muted text-sm">•</span>
            <span className="text-yt-text-muted text-sm">
              {video.published}
            </span>

            <div className="flex items-center gap-2 ml-auto">
              {/* Like */}
              <button
                onClick={() => setLiked((v) => !v)}
                className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  liked
                    ? 'bg-blue-600 text-white'
                    : 'bg-yt-secondary hover:bg-yt-hover text-yt-text border border-yt-border'
                }`}
              >
                <ThumbsUp className={`w-4 h-4 ${liked ? 'fill-white' : ''}`} />
                <span>{video.likes}</span>
              </button>

              {/* Dislike */}
              <button className="flex items-center gap-2 px-4 py-2 rounded-full bg-yt-secondary hover:bg-yt-hover text-yt-text border border-yt-border text-sm font-medium transition-colors">
                <ThumbsDown className="w-4 h-4" />
              </button>

              {/* Share */}
              <button
                onClick={() => {
                  if (navigator.share) {
                    navigator.share({
                      title: video.title,
                      url: window.location.href,
                    })
                  } else {
                    navigator.clipboard.writeText(window.location.href)
                  }
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-yt-secondary hover:bg-yt-hover text-yt-text border border-yt-border text-sm font-medium transition-colors"
              >
                <Share2 className="w-4 h-4" />
                <span className="hidden sm:block">{t('share')}</span>
              </button>

              {/* Download */}
              <button
                onClick={() => setShowDownload(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-yt-secondary hover:bg-yt-hover text-yt-text border border-yt-border text-sm font-medium transition-colors"
              >
                <Download className="w-4 h-4" />
                <span className="hidden sm:block">{t('download')}</span>
              </button>

              {/* Save / Watch Later */}
              <button
                onClick={() => {
                  if (!video) return
                  const isNowSaved = toggleWatchLater({ id: video.id, title: video.title, channel: video.channel.name, channelId: video.channel.id })
                  setSaved(isNowSaved)
                }}
                className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors border ${
                  saved
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-yt-secondary hover:bg-yt-hover text-yt-text border-yt-border'
                }`}
              >
                {saved ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
                <span className="hidden sm:block">{t('save')}</span>
              </button>
            </div>
          </div>

          {/* Channel row */}
          <div className="flex items-start gap-4 py-4 border-b border-yt-border">
            <Link href={`/channel/${video.channel.id}`} className="flex-shrink-0">
              <ChannelAvatar
                name={video.channel.name}
                src={video.channel.thumbnail}
                size="lg"
              />
            </Link>
            <div className="flex-1 min-w-0">
              <Link
                href={`/channel/${video.channel.id}`}
                className="text-yt-text font-semibold hover:text-white transition-colors truncate block"
              >
                {video.channel.name}
              </Link>
              {video.channel.subscriberCount !== undefined && (
                <p className="text-yt-text-muted text-sm">
                  {formatSubscribers(video.channel.subscriberCount)}
                </p>
              )}
            </div>
            <button
              onClick={() => video?.channel.id && toggleSubscription({ id: video.channel.id, name: video.channel.name, thumbnail: video.channel.thumbnail ?? null })}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold transition-colors flex-shrink-0 ${
                video?.channel.id && isSubscribed(video.channel.id)
                  ? 'bg-yt-secondary hover:bg-yt-hover text-yt-text border border-yt-border'
                  : 'bg-yt-text text-yt-bg hover:bg-yt-text-secondary'
              }`}
            >
              {video?.channel.id && isSubscribed(video.channel.id)
                ? <><BellOff className="w-4 h-4" />{t('nav_subscriptions')}</>
                : <><Bell className="w-4 h-4" />{t('subscribe')}</>
              }
            </button>
          </div>

          {/* Description */}
          <div className="mt-4">
            <div
              className={`bg-yt-secondary rounded-xl p-4 cursor-pointer hover:bg-yt-hover transition-colors`}
              onClick={() => setDescExpanded((v) => !v)}
            >
              {/* Meta row */}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-medium text-yt-text">
                  {video.views}
                </span>
                <span className="text-yt-text-muted text-sm">
                  {video.published}
                </span>
                {video.uploadDate && (
                  <span className="text-yt-text-muted text-sm hidden sm:block">
                    • {video.uploadDate.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}
                  </span>
                )}
              </div>

              {/* Description text */}
              {video.description ? (
                <div
                  className={`text-sm text-yt-text leading-relaxed whitespace-pre-wrap ${
                    descExpanded ? '' : 'line-clamp-2'
                  }`}
                >
                  {video.description}
                </div>
              ) : (
                <p className="text-sm text-yt-text-muted italic">No description available.</p>
              )}

              {/* Toggle button */}
              {video.description && video.description.length > 200 && (
                <button
                  className="mt-2 text-sm font-semibold text-yt-text flex items-center gap-1 hover:text-white transition-colors"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDescExpanded((v) => !v)
                  }}
                >
                  {descExpanded ? (
                    <>
                      {t('showLess')} <ChevronUp className="w-4 h-4" />
                    </>
                  ) : (
                    <>
                      {t('showMore')} <ChevronDown className="w-4 h-4" />
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Comments placeholder */}
          <div className="mt-6">
            <h2 className="text-yt-text font-semibold text-lg mb-4">Comments</h2>
            <div className="bg-yt-secondary rounded-xl p-4 text-center">
              <p className="text-yt-text-muted text-sm">{t('comments_unavailable')}</p>
              <p className="text-yt-text-muted text-xs mt-1">{t('comments_privacy')}</p>
            </div>
          </div>
        </div>

        {/* Right sidebar - Related videos */}
        <aside className="w-full lg:w-96 flex-shrink-0">
          {/* Download button for mobile */}
          <button
            onClick={() => setShowDownload(true)}
            className="lg:hidden w-full flex items-center justify-center gap-2 px-4 py-3 mb-4 bg-yt-red hover:bg-yt-red-hover text-white rounded-xl text-sm font-medium transition-colors"
          >
            <Download className="w-4 h-4" />
            {t('download')}
          </button>

          {/* Desktop download button */}
          <button
            onClick={() => setShowDownload(true)}
            className="hidden lg:flex w-full items-center justify-center gap-2 px-4 py-3 mb-4 bg-yt-red hover:bg-yt-red-hover text-white rounded-xl text-sm font-medium transition-colors"
          >
            <Download className="w-4 h-4" />
            {t('download')}
          </button>

          <h2 className="text-yt-text font-semibold mb-3">{t('upNext')}</h2>

          {video.related.length > 0 ? (
            <div className="flex flex-col gap-3">
              {video.related.map((related) => (
                <VideoCard key={related.id} video={related} layout="list" />
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-yt-text-muted text-sm">No related videos available.</p>
            </div>
          )}
        </aside>
      </div>

      {/* Download Modal */}
      {showDownload && (
        <DownloadModal
          videoId={id}
          title={video.title}
          formats={video.formats}
          onClose={() => setShowDownload(false)}
        />
      )}
    </div>
  )
}
