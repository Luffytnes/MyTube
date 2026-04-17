'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { Mic2, Play, Pause, Clock, Bell, BellOff } from 'lucide-react'
import { useMusic } from '@/lib/musicContext'
import { useRegion } from '@/lib/regionContext'
import { isPodcastSubscribed, togglePodcastSubscription } from '@/lib/podcastSubscriptions'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface Episode {
  id: string
  title: string
  description?: string
  thumbnail?: string
  duration?: string
  date?: string
  enclosureUrl: string
}

interface Podcast {
  id: string
  title: string
  author?: string
  description?: string
  thumbnail?: string
  episodeCount?: number
  episodes: Episode[]
}

export default function PodcastPage() {
  const { id } = useParams<{ id: string }>()
  const [podcast, setPodcast] = useState<Podcast | null>(null)
  const [loading, setLoading] = useState(true)
  const [subscribed, setSubscribed] = useState(false)
  const { playTrack, playPause, currentTrack, playing } = useMusic()
  const { t } = useRegion()

  useEffect(() => {
    if (!id) return
    setSubscribed(isPodcastSubscribed(id))
    fetch(`${API_BASE}/api/podcasts/${id}`)
      .then((r) => r.json())
      .then((data) => setPodcast({ ...data, episodes: data?.episodes || [] }))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id])

  function episodeAsTrack(ep: Episode) {
    return {
      videoId: ep.id,
      directUrl: ep.enclosureUrl,
      title: ep.title,
      artists: podcast?.author ? [{ name: podcast.author }] : [],
      thumbnail: ep.thumbnail || podcast?.thumbnail || null,
      duration: ep.duration || null,
    }
  }

  function handleToggleSubscription() {
    if (!podcast) return
    const nowSubscribed = togglePodcastSubscription({
      id: podcast.id,
      title: podcast.title,
      author: podcast.author,
      thumbnail: podcast.thumbnail,
    })
    setSubscribed(nowSubscribed)
  }

  if (loading) {
    return (
      <div className="px-4 py-6 max-w-4xl mx-auto min-h-screen space-y-4">
        <div className="flex gap-6">
          <div className="w-48 h-48 rounded-2xl bg-yt-secondary animate-pulse flex-shrink-0" />
          <div className="flex-1 space-y-3 py-4">
            {[1, 2, 3].map((i) => <div key={i} className="h-5 bg-yt-secondary rounded animate-pulse" />)}
          </div>
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-20 bg-yt-secondary rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  if (!podcast) {
    return (
      <div className="flex flex-col items-center justify-center py-32 min-h-screen">
        <Mic2 className="w-16 h-16 text-yt-text-muted mb-4" />
        <p className="text-yt-text-muted">{t('podcast_not_found')}</p>
      </div>
    )
  }

  const allTracks = podcast.episodes.map(episodeAsTrack)

  return (
    <div className="px-4 py-6 max-w-4xl mx-auto min-h-screen">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-6 mb-8">
        <div className="w-48 h-48 rounded-2xl overflow-hidden bg-yt-secondary flex-shrink-0 shadow-2xl self-center sm:self-start">
          {podcast.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={podcast.thumbnail} alt={podcast.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Mic2 className="w-16 h-16 text-yt-text-muted" />
            </div>
          )}
        </div>

        <div className="flex flex-col justify-end min-w-0">
          <p className="text-yt-text-muted text-xs uppercase tracking-widest mb-1">{t('podcast_label')}</p>
          <h1 className="text-yt-text text-3xl font-bold mb-2 leading-tight">{podcast.title}</h1>
          {podcast.author && (
            <p className="text-yt-text-secondary text-sm mb-1">{podcast.author}</p>
          )}
          <p className="text-yt-text-muted text-xs mb-4">
            {podcast.episodes.length} {podcast.episodes.length !== 1 ? t('podcast_episodes') : t('podcast_episode')}
          </p>
          <div className="flex items-center gap-3 mt-5 flex-wrap">
            {podcast.episodes.length > 0 && (() => {
              const firstActive = currentTrack?.videoId === allTracks[0]?.videoId
              return (
                <button
                  onClick={() => firstActive ? playPause() : playTrack(allTracks[0], allTracks)}
                  className="flex items-center gap-2 px-6 py-2.5 bg-yt-red hover:bg-yt-red-hover text-white rounded-full text-sm font-medium transition-colors"
                >
                  {firstActive && playing ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white" />}
                  {t('music_listen')}
                </button>
              )
            })()}
            <button
              onClick={handleToggleSubscription}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium border transition-colors ${
                subscribed
                  ? 'bg-yt-hover border-yt-border text-yt-text hover:border-red-400 hover:text-red-400'
                  : 'bg-yt-secondary border-yt-border text-yt-text-secondary hover:border-yt-text hover:text-yt-text'
              }`}
            >
              {subscribed
                ? <><BellOff className="w-4 h-4" />{t('podcast_unfollow')}</>
                : <><Bell className="w-4 h-4" />{t('podcast_follow')}</>
              }
            </button>
          </div>
        </div>
      </div>

      {/* Description */}
      {podcast.description && (
        <p className="text-yt-text-muted text-sm leading-relaxed mb-8 line-clamp-3">{podcast.description}</p>
      )}

      {/* Episodes */}
      <h2 className="text-yt-text text-lg font-semibold mb-3">{t('podcast_episodes_title')}</h2>

      {podcast.episodes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Mic2 className="w-10 h-10 text-yt-text-muted mb-3" />
          <p className="text-yt-text-muted text-sm">{t('podcast_no_episodes')}</p>
        </div>
      ) : (
        <div className="space-y-1">
          {podcast.episodes.map((ep) => {
            const track = episodeAsTrack(ep)
            const isActive = currentTrack?.videoId === track.videoId
            const isPlaying = isActive && playing
            return (
              <button
                key={ep.id}
                onClick={() => isActive ? playPause() : playTrack(track, allTracks)}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors group text-left ${isActive ? 'bg-yt-secondary' : 'hover:bg-yt-secondary'}`}
              >
                <div className="w-14 h-14 rounded-lg overflow-hidden bg-yt-secondary flex-shrink-0">
                  {ep.thumbnail || podcast.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={ep.thumbnail || podcast.thumbnail!} alt={ep.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Mic2 className="w-6 h-6 text-yt-text-muted" />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate transition-colors ${isActive ? 'text-yt-red' : 'text-yt-text group-hover:text-yt-red'}`}>
                    {ep.title}
                  </p>
                  {ep.description && (
                    <p className="text-xs text-yt-text-muted truncate mt-0.5">{ep.description}</p>
                  )}
                  {ep.date && (
                    <p className="text-xs text-yt-text-muted mt-0.5">{ep.date}</p>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {ep.duration && (
                    <span className="flex items-center gap-1 text-xs text-yt-text-muted">
                      <Clock className="w-3 h-3" />
                      {ep.duration}
                    </span>
                  )}
                  <div className={`w-8 h-8 rounded-full bg-yt-red flex items-center justify-center transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                    {isPlaying
                      ? <Pause className="w-3.5 h-3.5 fill-white text-white" />
                      : <Play className="w-3.5 h-3.5 fill-white text-white" />
                    }
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
