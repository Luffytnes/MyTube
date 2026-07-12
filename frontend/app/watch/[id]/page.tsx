'use client'

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { getVideo, getPlaylist, type PlaylistDetail, type PlaylistVideo } from '@/lib/api'
import { getPlaybackSettings } from '@/lib/playbackSettings'
import { getQueue, isInQueue, addToQueue, removeFromQueue } from '@/lib/queue'
import { saveToHistory } from '@/lib/history'
import { useRegion } from '@/lib/regionContext'
import type { VideoDetail } from '@/lib/api'
import VideoPlayer, { type Chapter } from '@/components/video/VideoPlayer'
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
  ListPlus,
  ListChecks,
  ArrowLeft,
} from 'lucide-react'
import { formatSubscribers } from '@/lib/utils'
import { isInWatchLater, toggleWatchLater } from '@/lib/watchLater'
import { isLiked, toggleLike, removeLike } from '@/lib/likes'
import { useSubscriptions } from '@/lib/subscriptionsContext'
import { BellOff, Copy, Check, ExternalLink } from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

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
  const safeName = name ?? ''
  const letter = safeName ? safeName[0].toUpperCase() : '?'

  const colors = [
    '#1a73e8', '#d93025', '#188038', '#e37400',
    '#8430ce', '#007b83', '#c5221f', '#0d652d',
  ]
  let hash = 0
  for (let i = 0; i < safeName.length; i++) {
    hash = safeName.charCodeAt(i) + ((hash << 5) - hash)
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

function RelatedChannelCard({ id, name }: { id: string; name: string }) {
  return (
    <Link
      href={`/channel/${id}`}
      className="flex items-center gap-3 p-2.5 rounded-xl bg-yt-secondary hover:bg-yt-hover transition-colors group"
    >
      <div className="flex-shrink-0 w-12 h-12 rounded-full overflow-hidden bg-yt-hover">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`${API_BASE}/api/channel_thumbnail/${id}`}
          alt={name}
          className="w-full h-full object-cover"
          onError={(e) => {
            const el = e.target as HTMLImageElement
            el.style.display = 'none'
            el.nextElementSibling?.classList.remove('hidden')
          }}
        />
        <div className="hidden w-full h-full items-center justify-center text-yt-text-muted font-bold text-lg">
          {name[0]?.toUpperCase()}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-yt-text text-sm font-medium truncate group-hover:text-yt-red transition-colors">{name}</p>
        <p className="text-yt-text-muted text-xs mt-0.5">Chaîne</p>
      </div>
    </Link>
  )
}

function parseChapters(description: string): Chapter[] {
  const lines = description.split('\n')
  const chapters: Chapter[] = []
  // Match timestamps like 0:00, 1:23, 1:23:45
  const re = /(?:^|\s)((\d+:)?\d{1,2}:\d{2})\s+(.+)/
  for (const line of lines) {
    const m = line.match(re)
    if (!m) continue
    const timeStr = m[1]
    const parts = timeStr.split(':').map(Number)
    let seconds = 0
    if (parts.length === 2) seconds = parts[0] * 60 + parts[1]
    else if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2]
    const chTitle = m[3].trim()
    if (chTitle) chapters.push({ time: seconds, title: chTitle })
  }
  return chapters.length >= 2 ? chapters : []
}

interface WatchPageProps {
  params: { id: string }
}

function WatchContent({ params }: WatchPageProps) {
  const { id } = params
  const router = useRouter()
  const searchParams = useSearchParams()
  const fromQueue = searchParams.get('queue') === '1'
  const listId = searchParams.get('list') || null
  const [playlist, setPlaylist] = useState<PlaylistDetail | null>(null)
  const [playlistLoading, setPlaylistLoading] = useState(false)
  const { t } = useRegion()
  const { isSubscribed, toggle: toggleSubscription } = useSubscriptions()
  const [video, setVideo] = useState<VideoDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [descExpanded, setDescExpanded] = useState(false)
  const [showDownload, setShowDownload] = useState(false)
  const [liked, setLiked] = useState(false)
  const [disliked, setDisliked] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showShare, setShowShare] = useState(false)
  const [copied, setCopied] = useState(false)
  const [inQueue, setInQueue] = useState(false)
  const [autoplayCountdown, setAutoplayCountdown] = useState<number | null>(null)
  const autoplayTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const [prevVideoId, setPrevVideoId] = useState<string | null>(null)

  // Load playlist if ?list= present
  useEffect(() => {
    if (!listId) { setPlaylist(null); return }
    setPlaylistLoading(true)
    getPlaylist(listId)
      .then(setPlaylist)
      .catch(() => setPlaylist(null))
      .finally(() => setPlaylistLoading(false))
  }, [listId])

  useEffect(() => {
    setSaved(isInWatchLater(id))
    setLiked(isLiked(id))
    setInQueue(isInQueue(id))
    // Retrieve previous video from sessionStorage on mount
    const stored = sessionStorage.getItem('yt_prev_video')
    setPrevVideoId(stored)
  }, [id])

  // Countdown auto-play
  useEffect(() => {
    if (autoplayCountdown === null) return
    if (autoplayCountdown <= 0) {
      const nextId = video?.related?.[0]?.id
      if (nextId) {
        sessionStorage.setItem('yt_prev_video', id)
        router.push(`/watch/${nextId}`)
      }
      setAutoplayCountdown(null)
      return
    }
    autoplayTimer.current = setInterval(() => {
      setAutoplayCountdown((v) => (v !== null ? v - 1 : null))
    }, 1000)
    return () => {
      if (autoplayTimer.current) clearInterval(autoplayTimer.current)
    }
  }, [autoplayCountdown]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleEnded() {
    if (!getPlaybackSettings().autoplayNext) return
    // Check queue first
    if (fromQueue) {
      const q = getQueue()
      const next = q.find((item) => item.id !== id)
      if (next) { setAutoplayCountdown(5); return }
    }
    const nextId = video?.related?.[0]?.id
    if (nextId) setAutoplayCountdown(5)
  }

  const nextQueueItem = fromQueue ? getQueue().find((item) => item.id !== id) : null
  const playlistIdx = playlist ? playlist.videos.findIndex((v) => v.id === id) : -1
  const nextPlaylistVideo = playlist && playlistIdx >= 0 && playlistIdx < playlist.videos.length - 1
    ? playlist.videos[playlistIdx + 1] : null
  const prevPlaylistVideo = playlist && playlistIdx > 0 ? playlist.videos[playlistIdx - 1] : null
  const nextVideoId = nextQueueItem?.id ?? nextPlaylistVideo?.id ?? video?.related?.[0]?.id

  function handleNext() {
    cancelAutoplay()
    if (fromQueue) {
      const q = getQueue()
      const next = q.find((item) => item.id !== id)
      if (next) {
        sessionStorage.setItem('yt_prev_video', id)
        router.push(`/watch/${next.id}?queue=1`)
        return
      }
    }
    if (nextPlaylistVideo && listId) {
      sessionStorage.setItem('yt_prev_video', id)
      router.push(`/watch/${nextPlaylistVideo.id}?list=${listId}`)
      return
    }
    const nextId = video?.related?.[0]?.id
    if (!nextId) return
    sessionStorage.setItem('yt_prev_video', id)
    router.push(`/watch/${nextId}`)
  }

  function handlePrev() {
    cancelAutoplay()
    if (prevPlaylistVideo && listId) {
      router.push(`/watch/${prevPlaylistVideo.id}?list=${listId}`)
      return
    }
    if (prevVideoId) {
      router.push(`/watch/${prevVideoId}`)
    } else {
      router.back()
    }
  }

  function cancelAutoplay() {
    if (autoplayTimer.current) clearInterval(autoplayTimer.current)
    setAutoplayCountdown(null)
  }

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
          <div className="relative">
            <VideoPlayer
              videoId={id}
              formats={video.formats}
              title={video.title}
              isLive={video.isLive}
              knownDuration={video.duration ? video.duration.split(':').reverse().reduce((acc, v, i) => acc + parseInt(v) * Math.pow(60, i), 0) : undefined}
              onEnded={handleEnded}
              onNext={handleNext}
              onPrev={handlePrev}
              hasNext={!!(nextQueueItem || video.related?.[0])}
              hasPrev={true}
              chapters={video.description ? parseChapters(video.description) : []}
            />

            {/* Autoplay countdown overlay */}
            {autoplayCountdown !== null && nextVideoId && (
              <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center rounded-xl z-20">
                <p className="text-white text-sm font-medium mb-3 opacity-80">{t('autoplay_next')}</p>
                <div className="flex items-center gap-3 bg-yt-secondary border border-yt-border rounded-xl p-3 max-w-xs w-full mx-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://i.ytimg.com/vi/${nextVideoId}/mqdefault.jpg`}
                    alt=""
                    className="w-20 h-12 object-cover rounded-lg flex-shrink-0"
                  />
                  <p className="text-yt-text text-sm font-medium line-clamp-2 flex-1">
                    {nextQueueItem?.title ?? video.related[0]?.title}
                  </p>
                </div>
                <div className="flex items-center gap-3 mt-4">
                  <span className="text-white text-3xl font-bold tabular-nums w-10 text-center">{autoplayCountdown}</span>
                </div>
                <button
                  onClick={cancelAutoplay}
                  className="mt-4 px-5 py-2 rounded-full border border-white/40 text-white text-sm hover:bg-white/10 transition-colors"
                >
                  {t('autoplay_cancel')}
                </button>
              </div>
            )}
          </div>

          {/* Back button */}
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 mt-4 text-yt-text-muted hover:text-yt-text transition-colors text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            {t('nav_back')}
          </button>

          {/* Title */}
          <h1 className="text-yt-text text-xl font-semibold mt-2 leading-snug">
            {video.title}
          </h1>

          {/* Action bar */}
          <div className="mt-3 pb-4 border-b border-yt-border">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-yt-text-muted text-sm">{video.views}</span>
              <span className="text-yt-text-muted text-sm">•</span>
              <span className="text-yt-text-muted text-sm">{video.published}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Like */}
              <button
                onClick={() => {
                  if (!video) return
                  const nowLiked = toggleLike({ id: video.id, title: video.title, channel: video.channel.name, channelId: video.channel.id })
                  setLiked(nowLiked)
                  if (nowLiked) setDisliked(false)
                }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium transition-colors ${
                  liked
                    ? 'bg-blue-600 text-white'
                    : 'bg-yt-secondary hover:bg-yt-hover text-yt-text border border-yt-border'
                }`}
              >
                <ThumbsUp className={`w-4 h-4 ${liked ? 'fill-white' : ''}`} />
                <span>{video.likes}</span>
              </button>

              {/* Dislike */}
              <button
                onClick={() => {
                  if (!video) return
                  setDisliked((v) => {
                    const next = !v
                    if (next && liked) {
                      removeLike(video.id)
                      setLiked(false)
                    }
                    return next
                  })
                }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium transition-colors ${
                  disliked
                    ? 'bg-red-600 text-white'
                    : 'bg-yt-secondary hover:bg-yt-hover text-yt-text border border-yt-border'
                }`}
              >
                <ThumbsDown className={`w-4 h-4 ${disliked ? 'fill-white' : ''}`} />
              </button>

              {/* Share */}
              <button
                onClick={() => setShowShare(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-yt-secondary hover:bg-yt-hover text-yt-text border border-yt-border text-sm font-medium transition-colors"
              >
                <Share2 className="w-4 h-4" />
                <span className="hidden lg:block">{t('share')}</span>
              </button>

              {/* Download */}
              <button
                onClick={() => setShowDownload(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-yt-secondary hover:bg-yt-hover text-yt-text border border-yt-border text-sm font-medium transition-colors"
              >
                <Download className="w-4 h-4" />
                <span className="hidden lg:block">{t('download')}</span>
              </button>

              {/* Add to queue */}
              <button
                onClick={() => {
                  if (!video) return
                  if (inQueue) {
                    removeFromQueue(video.id)
                    setInQueue(false)
                  } else {
                    addToQueue({
                      id: video.id,
                      title: video.title,
                      thumbnail: `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`,
                      duration: video.duration,
                      channel: video.channel.name,
                      channelId: video.channel.id,
                    })
                    setInQueue(true)
                  }
                }}
                className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors border ${
                  inQueue
                    ? 'bg-yt-red border-yt-red text-white'
                    : 'bg-yt-secondary hover:bg-yt-hover text-yt-text border-yt-border'
                }`}
              >
                {inQueue ? <ListChecks className="w-4 h-4" /> : <ListPlus className="w-4 h-4" />}
                <span className="hidden lg:block">{inQueue ? t('queue_in_queue') : t('queue_add')}</span>
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
                <span className="hidden lg:block">{t('save')}</span>
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

        {/* Right sidebar */}
        <aside className="w-full lg:w-96 flex-shrink-0">
          {/* Download buttons */}
          <button
            onClick={() => setShowDownload(true)}
            className="lg:hidden w-full flex items-center justify-center gap-2 px-4 py-3 mb-4 bg-yt-red hover:bg-yt-red-hover text-white rounded-xl text-sm font-medium transition-colors"
          >
            <Download className="w-4 h-4" />
            {t('download')}
          </button>
          <button
            onClick={() => setShowDownload(true)}
            className="hidden lg:flex w-full items-center justify-center gap-2 px-4 py-3 mb-4 bg-yt-red hover:bg-yt-red-hover text-white rounded-xl text-sm font-medium transition-colors"
          >
            <Download className="w-4 h-4" />
            {t('download')}
          </button>

          {/* Playlist panel */}
          {listId && (
            <div className="mb-4 bg-yt-secondary rounded-xl overflow-hidden border border-yt-border/60">
              <div className="px-4 py-3 border-b border-yt-border/40">
                {playlistLoading ? (
                  <p className="text-yt-text-muted text-sm">Loading playlist...</p>
                ) : playlist ? (
                  <>
                    <p className="text-yt-text font-semibold text-sm line-clamp-1">{playlist.title}</p>
                    <p className="text-yt-text-muted text-xs mt-0.5">{playlist.uploader} · {playlistIdx + 1} / {playlist.videoCount}</p>
                  </>
                ) : null}
              </div>
              {playlist && (
                <div className="max-h-72 overflow-y-auto">
                  {playlist.videos.map((v, idx) => {
                    const isCurrent = v.id === id
                    return (
                      <Link
                        key={v.id}
                        href={`/watch/${v.id}?list=${listId}`}
                        className={`flex items-center gap-2 px-3 py-2 hover:bg-yt-hover transition-colors ${isCurrent ? 'bg-yt-hover' : ''}`}
                      >
                        <span className="text-yt-text-muted text-xs w-5 text-center flex-shrink-0">{idx + 1}</span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={v.thumbnail} alt={v.title} className="w-16 h-9 object-cover rounded flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-medium line-clamp-2 leading-snug ${isCurrent ? 'text-yt-red' : 'text-yt-text'}`}>{v.title}</p>
                          <p className="text-yt-text-muted text-[10px] mt-0.5 truncate">{v.channel}</p>
                        </div>
                        {v.duration && <span className="text-yt-text-muted text-[10px] flex-shrink-0">{v.duration}</span>}
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          <h2 className="text-yt-text font-semibold mb-3">{t('upNext')}</h2>

          {video.related.length > 0 ? (
            <div className="flex flex-col gap-3">
              {video.related.map((related) =>
                (related as { type?: string }).type === 'channel' ? (
                  <RelatedChannelCard key={related.id} id={related.id} name={related.title} />
                ) : (
                  <VideoCard key={related.id} video={related as import('@/lib/api').VideoCard} layout="list" />
                )
              )}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-yt-text-muted text-sm">No related videos available.</p>
            </div>
          )}
        </aside>
      </div>

      {/* Share Modal */}
      {showShare && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-4"
          onClick={() => setShowShare(false)}
        >
          <div
            className="bg-yt-bg border border-yt-border rounded-2xl p-6 w-full max-w-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-yt-text font-semibold text-base mb-4">{t('share_modal_title')}</h3>
            <div className="flex items-center gap-2 bg-yt-secondary rounded-xl px-3 py-2.5 mb-4">
              <span className="flex-1 text-sm text-yt-text-secondary truncate font-mono">
                {`https://www.youtube.com/watch?v=${video.id}`}
              </span>
              <a
                href={`https://www.youtube.com/watch?v=${video.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 hover:text-yt-text text-yt-text-muted transition-colors flex-shrink-0"
                title={t('likes_open_youtube')}
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(`https://www.youtube.com/watch?v=${video.id}`)
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-yt-red hover:bg-yt-red-hover text-white text-sm font-medium transition-colors"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? t('share_copied') : t('share_copy')}
            </button>
          </div>
        </div>
      )}

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

export default function WatchPage({ params }: WatchPageProps) {
  return (
    <Suspense>
      <WatchContent params={params} />
    </Suspense>
  )
}
