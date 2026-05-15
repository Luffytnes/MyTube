'use client'

import { useEffect, useState } from 'react'
import { X, Loader2, AlertCircle } from 'lucide-react'
import VideoPlayer from '@/components/video/VideoPlayer'
import type { VideoFormat } from '@/lib/api'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

interface Props {
  videoId: string
  title: string
  onClose: () => void
}

export default function TrailerModal({ videoId, title, onClose }: Props) {
  const [formats, setFormats] = useState<VideoFormat[] | null>(null)
  const [duration, setDuration] = useState<number | undefined>(undefined)
  const [error, setError] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  useEffect(() => {
    setFormats(null)
    setError(false)
    fetch(`${API_BASE}/api/video/${videoId}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        setFormats(data.formats ?? [])
        if (data.duration) {
          const secs = (data.duration as string).split(':').reverse()
            .reduce((acc: number, v: string, i: number) => acc + parseInt(v) * Math.pow(60, i), 0)
          setDuration(secs)
        }
      })
      .catch(() => setError(true))
  }, [videoId])

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-5xl aspect-video bg-black rounded-2xl overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Close button — always on top */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-30 p-2 rounded-full bg-black/60 hover:bg-black/90 text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Loading */}
        {!formats && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white bg-black z-[2]">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-sm text-white/60">Chargement…</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/60 bg-black z-[2]">
            <AlertCircle className="w-8 h-8" />
            <p className="text-sm">Impossible de charger la vidéo</p>
          </div>
        )}

        {/* Player — même composant que la page watch */}
        {formats && (
          <div className="w-full h-full">
            <VideoPlayer
              videoId={videoId}
              formats={formats}
              title={title}
              knownDuration={duration}
            />
          </div>
        )}
      </div>
    </div>
  )
}
