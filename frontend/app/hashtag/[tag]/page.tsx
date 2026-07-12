'use client'

import { useState, useEffect } from 'react'
import { Hash } from 'lucide-react'
import VideoGrid from '@/components/video/VideoGrid'
import type { VideoCard } from '@/lib/api'
import { useRegion } from '@/lib/regionContext'

export default function HashtagPage({ params }: { params: { tag: string } }) {
  const { t } = useRegion()
  const tag = decodeURIComponent(params.tag).replace(/^#/, '')
  const [videos, setVideos] = useState<VideoCard[]>([])
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/yt/hashtag/${encodeURIComponent(tag)}`)
      .then(r => r.json())
      .then(data => {
        setVideos(data.videos ?? [])
        setInfo(data.info ?? '')
      })
      .finally(() => setLoading(false))
  }, [tag])

  return (
    <div className="min-h-screen">
      <div className="px-4 pt-6 pb-4 border-b border-yt-border/40">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-yt-secondary flex items-center justify-center">
            <Hash className="w-6 h-6 text-yt-text" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-yt-text">#{tag}</h1>
            {info && <p className="text-sm text-yt-text-muted mt-0.5">{info}</p>}
          </div>
        </div>
      </div>

      <div className="px-4 py-6">
        <VideoGrid videos={videos} loading={loading} emptyMessage={t('hashtag_empty')} />
      </div>
    </div>
  )
}
