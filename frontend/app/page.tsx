'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import VideoGrid from '@/components/video/VideoGrid'
import { getTrending, searchVideos, getChannelVideos } from '@/lib/api'
import HeroBanner, { HeroBannerSkeleton } from '@/components/home/HeroBanner'
import { Compass } from 'lucide-react'
import type { VideoCard } from '@/lib/api'
import { useRegion } from '@/lib/regionContext'
import { useSubscriptions } from '@/lib/subscriptionsContext'
import { getSearchHistory } from '@/lib/searchHistory'
import { getHistory } from '@/lib/history'
import { getResumeVideoIds, getPosition } from '@/lib/resumePosition'
import { ytThumbnail } from '@/lib/thumbnails'

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

    // No activity yet → open on what is trending instead of an empty page
    if (!hasSearches && !hasSubs) {
      try {
        const trending = await getTrending(region.code, 'all', lang)
        setVideos(trending.videos)
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

  const [featured, ...rest] = videos
  const visibleResume = showAllResume ? resumeVideos : resumeVideos.slice(0, 8)

  return (
    <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-5 sm:py-7 max-w-[1920px] mx-auto">
      {loading ? <HeroBannerSkeleton /> : featured && !error ? <HeroBanner video={featured} /> : null}

      {/* Continue watching */}
      {resumeVideos.length > 0 && (
        <section className="mt-10">
          <div className="flex items-end justify-between mb-4">
            <h2 className="section-title">{t('home_continue_watching')}</h2>
            {resumeVideos.length > 4 && (
              <button
                onClick={() => setShowAllResume((p) => !p)}
                className="text-sm font-medium text-yt-text-muted hover:text-yt-red transition-colors"
              >
                {showAllResume ? t('home_show_less') : t('home_see_all')}
              </button>
            )}
          </div>
          <div className="stagger -mx-4 px-4 sm:mx-0 sm:px-0 flex gap-4 overflow-x-auto snap-x snap-mandatory scrollbar-none pb-2">
            {visibleResume.map((v) => (
              <Link key={v.id} href={`/watch/${v.id}`} className="group snap-start flex-shrink-0 w-[240px] sm:w-[280px]">
                <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-yt-secondary ring-1 ring-inset ring-white/5 transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-card">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={ytThumbnail(v.id, 'mq')}
                    alt=""
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.06]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                  <span className="absolute bottom-3 left-3 rounded-md glass-chip px-1.5 py-0.5 text-[11px] font-semibold tabular-nums">
                    {Math.floor(v.position / 60)}:{String(Math.floor(v.position % 60)).padStart(2, '0')}
                  </span>
                  <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/20">
                    <div className="h-full bg-accent-gradient" style={{ width: `${v.progress}%` }} />
                  </div>
                </div>
                <p className="mt-2.5 text-yt-text text-sm font-semibold line-clamp-2 leading-snug">{v.title}</p>
                <p className="text-yt-text-muted text-xs mt-1 truncate">{v.channel}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Feed */}
      <section className="mt-10">
        <div className="mb-5">
          <h2 className="section-title text-2xl">{hasActivity ? t('home_forYou') : t('home_trending_now')}</h2>
          {hasActivity && <p className="text-yt-text-muted text-sm mt-1">{t('home_basedOn')}</p>}
        </div>

        {!hasActivity && !loading && !error && (
          <div className="mb-8 flex items-start gap-3 rounded-2xl border border-yt-border/50 bg-yt-secondary/40 px-4 py-3.5 text-sm text-yt-text-secondary animate-fade-up">
            <Compass className="w-5 h-5 flex-shrink-0 text-yt-red mt-px" />
            <p>{t('home_discover')}</p>
          </div>
        )}

        {error ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-yt-text-muted text-lg mb-5">{error}</p>
            <button onClick={load} className="btn-accent">
              {t('retry')}
            </button>
          </div>
        ) : !loading && videos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center max-w-sm mx-auto">
            <p className="text-yt-text-muted text-sm">{t('home_noActivity')}</p>
          </div>
        ) : (
          <VideoGrid videos={rest} loading={loading} emptyMessage={t('home_noActivity')} />
        )}
      </section>
    </div>
  )
}
