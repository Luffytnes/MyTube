'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import VideoGrid from '@/components/video/VideoGrid'
import { getTrending, searchVideos, getChannelVideos } from '@/lib/api'
import type { VideoCard } from '@/lib/api'
import { useRegion } from '@/lib/regionContext'
import { useSubscriptions } from '@/lib/subscriptionsContext'
import { getSearchHistory } from '@/lib/searchHistory'
import { getHistory } from '@/lib/history'
import { getResumeVideoIds, getPosition } from '@/lib/resumePosition'

interface ResumeVideo {
  id: string
  title: string
  channel: string
  channelId: string
  progress: number // 0-100
  position: number // seconds
}

export default function HomePage() {
  const { t, region, lang } = useRegion()
  const { subscriptions } = useSubscriptions()
  const [videos, setVideos] = useState<VideoCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasActivity, setHasActivity] = useState(false)
  const [resumeVideos, setResumeVideos] = useState<ResumeVideo[]>([])
  const [showAllResume, setShowAllResume] = useState(false)


  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    // Re-read resume positions on every load so it works after coming back from a video
    const resumeIds = getResumeVideoIds().slice(0, 10)
    if (resumeIds.length > 0) {
      const history = getHistory()
      const histMap = new Map(history.map((h) => [h.id, h]))
      const raw = localStorage.getItem('mytube-resume-positions')
      const posData = raw ? JSON.parse(raw) : {}
      const items: ResumeVideo[] = []
      for (const id of resumeIds) {
        const h = histMap.get(id)
        if (!h) continue
        const pos = getPosition(id)
        if (pos === null) continue
        const entry = posData[id]
        const progress = entry?.duration > 0 ? Math.round((entry.position / entry.duration) * 100) : 0
        items.push({ id, title: h.title, channel: h.channel, channelId: h.channelId, progress, position: pos })
      }
      setResumeVideos(items)
    } else {
      setResumeVideos([])
    }

    const recentSearches = getSearchHistory().slice(0, 4).map((h) => h.query)
    const hasSearches = recentSearches.length > 0
    const hasSubs = subscriptions.length > 0
    setHasActivity(hasSearches || hasSubs)

    // No activity → trending fallback
    if (!hasSearches && !hasSubs) {
      try {
        const data = await getTrending(region.code, 'all', lang)
        setVideos(data.videos)
      } catch {
        setError(t('error_trending'))
      } finally {
        setLoading(false)
      }
      return
    }

    try {
      // Fetch in parallel: up to 4 searches + up to 3 subscribed channels
      const searchPromises = recentSearches.map((q) =>
        searchVideos(q, 1).then((r) => r.videos.slice(0, 6)).catch(() => [] as VideoCard[])
      )
      const channelPromises = subscriptions.slice(0, 3).map((sub) =>
        getChannelVideos(sub.id, 1).then((r) => r.videos.slice(0, 4)).catch(() => [] as VideoCard[])
      )

      const results = await Promise.all([...searchPromises, ...channelPromises])
      const seen = new Set<string>()
      const merged: VideoCard[] = []

      // Interleave results so they're not all from the same source
      const maxLen = Math.max(...results.map((r) => r.length))
      for (let i = 0; i < maxLen; i++) {
        for (const bucket of results) {
          const v = bucket[i]
          if (v && !seen.has(v.id)) {
            seen.add(v.id)
            merged.push(v)
          }
        }
      }

      setVideos(merged)
    } catch {
      setError(t('error_trending'))
    } finally {
      setLoading(false)
    }
  }, [region.code, lang, subscriptions, t])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="min-h-screen px-4 py-6">
      {/* Continuer à regarder */}
      {resumeVideos.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-yt-text text-lg font-semibold">{t('home_continue_watching')}</h2>
            {resumeVideos.length > 6 && (
              <button
                onClick={() => setShowAllResume((p) => !p)}
                className="text-sm text-yt-text-muted hover:text-yt-text transition-colors"
              >
                {showAllResume ? t('home_show_less') : t('home_see_all')}
              </button>
            )}
          </div>
          {showAllResume ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {resumeVideos.map((v) => (
                <Link key={v.id} href={`/watch/${v.id}`} className="group">
                  <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-yt-secondary mb-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`}
                      alt={v.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                      <div className="h-full bg-yt-red" style={{ width: `${v.progress}%` }} />
                    </div>
                  </div>
                  <p className="text-yt-text text-xs font-medium line-clamp-2 leading-snug">{v.title}</p>
                  <p className="text-yt-text-muted text-xs mt-0.5 truncate">{v.channel}</p>
                </Link>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {resumeVideos.slice(0, 6).map((v) => (
                <Link key={v.id} href={`/watch/${v.id}`} className="group">
                  <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-yt-secondary mb-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`}
                      alt={v.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                      <div className="h-full bg-yt-red" style={{ width: `${v.progress}%` }} />
                    </div>
                  </div>
                  <p className="text-yt-text text-xs font-medium line-clamp-2 leading-snug">{v.title}</p>
                  <p className="text-yt-text-muted text-xs mt-0.5 truncate">{v.channel}</p>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-yt-text text-2xl font-semibold">{t('home_forYou')}</h1>
        {hasActivity && (
          <p className="text-yt-text-muted text-sm mt-1">{t('home_basedOn')}</p>
        )}
      </div>

      {error ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-yt-text-muted text-lg mb-4">{error}</p>
          <button
            onClick={load}
            className="px-6 py-2.5 bg-yt-red hover:bg-yt-red-hover text-white rounded-full text-sm font-medium transition-colors"
          >
            {t('retry')}
          </button>
        </div>
      ) : !loading && videos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center max-w-sm mx-auto">
          <div className="w-16 h-16 rounded-full bg-yt-secondary flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-yt-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <p className="text-yt-text-muted text-sm">{t('home_noActivity')}</p>
        </div>
      ) : (
        <VideoGrid videos={videos} loading={loading} emptyMessage={t('home_noActivity')} />
      )}
    </div>
  )
}
