'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Loader2, AlertCircle } from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

interface Props {
  videoId: string
  title: string
  onClose: () => void
}

export default function TrailerModal({ videoId, title, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

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
    setLoading(true)
    setError(false)
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
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-30 p-2 rounded-full bg-black/60 hover:bg-black/90 text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {loading && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white bg-black z-[2] pointer-events-none">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-sm text-white/60">Chargement…</p>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/60 bg-black z-[2]">
            <AlertCircle className="w-8 h-8" />
            <p className="text-sm">Vidéo non disponible dans votre région</p>
          </div>
        )}

        {!error && (
          <video
            ref={videoRef}
            key={videoId}
            src={`${API_BASE}/api/trailer/${videoId}`}
            controls
            autoPlay
            title={title}
            className="w-full h-full"
            onCanPlay={() => setLoading(false)}
            onError={() => { setLoading(false); setError(true) }}
          />
        )}
      </div>
    </div>
  )
}
