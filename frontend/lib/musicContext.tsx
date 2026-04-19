'use client'

import {
  createContext, useContext, useState, useRef,
  useEffect, useCallback, type ReactNode,
} from 'react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export interface MusicTrack {
  videoId: string
  title: string
  artists: { id?: string; name: string }[]
  album?: string | null
  thumbnail?: string | null
  duration?: string | null
  durationMs?: number
  directUrl?: string       // for podcast episodes with a direct enclosure URL
  radioStreamUrl?: string  // for live radio — stream proxied through backend
  isRadio?: boolean
}

type RepeatMode = 'none' | 'one' | 'all'

interface MusicContextType {
  queue: MusicTrack[]
  currentIndex: number
  currentTrack: MusicTrack | null
  playing: boolean
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: RepeatMode
  playTrack: (track: MusicTrack, queue?: MusicTrack[]) => void
  playRadio: (track: MusicTrack) => void
  playPause: () => void
  next: () => void
  prev: () => void
  seek: (t: number) => void
  setVolume: (v: number) => void
  toggleMute: () => void
  toggleShuffle: () => void
  toggleRepeat: () => void
  addToQueue: (track: MusicTrack) => void
}

const MusicContext = createContext<MusicContextType | null>(null)

export function MusicProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [queue, setQueue] = useState<MusicTrack[]>([])
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolumeState] = useState(1)
  const [muted, setMuted] = useState(false)
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState<RepeatMode>('none')

  const currentTrack = currentIndex >= 0 && currentIndex < queue.length
    ? queue[currentIndex]
    : null

  // Initialize audio element once
  useEffect(() => {
    const audio = new Audio()
    audio.preload = 'auto'
    audioRef.current = audio

    audio.addEventListener('timeupdate', () => setCurrentTime(audio.currentTime))
    audio.addEventListener('loadedmetadata', () => setDuration(audio.duration))
    audio.addEventListener('play', () => setPlaying(true))
    audio.addEventListener('pause', () => setPlaying(false))
    audio.addEventListener('ended', () => {
      // handled by onEnded below
    })
    audio.addEventListener('volumechange', () => {
      setVolumeState(audio.volume)
      setMuted(audio.muted)
    })

    return () => {
      audio.pause()
      audio.src = ''
    }
  }, [])

  // Handle track end
  const handleEnded = useCallback(() => {
    if (repeat === 'one') {
      const audio = audioRef.current
      if (audio) { audio.currentTime = 0; audio.play().catch(() => {}) }
      return
    }
    setCurrentIndex((prev) => {
      const len = queue.length
      if (len === 0) return prev
      if (shuffle) {
        const next = Math.floor(Math.random() * len)
        return next
      }
      if (prev + 1 < len) return prev + 1
      if (repeat === 'all') return 0
      setPlaying(false)
      return prev
    })
  }, [repeat, shuffle, queue.length])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.addEventListener('ended', handleEnded)
    return () => audio.removeEventListener('ended', handleEnded)
  }, [handleEnded])

  // Load new track when currentIndex changes
  useEffect(() => {
    const audio = audioRef.current
    const track = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null
    if (!audio || !track) return
    if (track.radioStreamUrl) {
      audio.src = track.radioStreamUrl
    } else if (track.directUrl) {
      audio.src = `${API_BASE}/api/podcasts/audio/proxy?url=${encodeURIComponent(track.directUrl)}`
    } else if (track.videoId) {
      audio.src = `${API_BASE}/api/stream/${track.videoId}/audio`
    } else {
      return
    }
    audio.play().catch(() => {})
  }, [currentIndex, queue])

  const playTrack = useCallback((track: MusicTrack, newQueue?: MusicTrack[]) => {
    const q = newQueue || [track]
    const idx = q.findIndex((t) => t.videoId === track.videoId)
    setQueue(q)
    setCurrentIndex(idx >= 0 ? idx : 0)
  }, [])

  // Play a radio station — replaces queue with single live track
  const playRadio = useCallback((track: MusicTrack) => {
    setQueue([track])
    setCurrentIndex(0)
  }, [])

  const playPause = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) audio.play().catch(() => {})
    else audio.pause()
  }, [])

  const next = useCallback(() => {
    setCurrentIndex((prev) => {
      const len = queue.length
      if (len === 0) return prev
      if (shuffle) return Math.floor(Math.random() * len)
      if (prev + 1 < len) return prev + 1
      if (repeat === 'all') return 0
      return prev
    })
  }, [queue.length, shuffle, repeat])

  const prev = useCallback(() => {
    const audio = audioRef.current
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0
      return
    }
    setCurrentIndex((prev) => {
      const len = queue.length
      if (len === 0) return prev
      if (prev - 1 >= 0) return prev - 1
      if (repeat === 'all') return len - 1
      return 0
    })
  }, [queue.length, repeat])

  const seek = useCallback((t: number) => {
    const audio = audioRef.current
    if (audio) audio.currentTime = t
  }, [])

  const setVolume = useCallback((v: number) => {
    const audio = audioRef.current
    if (audio) { audio.volume = v; audio.muted = false }
  }, [])

  const toggleMute = useCallback(() => {
    const audio = audioRef.current
    if (audio) audio.muted = !audio.muted
  }, [])

  const toggleShuffle = useCallback(() => setShuffle((v) => !v), [])

  const toggleRepeat = useCallback(() => {
    setRepeat((v) => v === 'none' ? 'all' : v === 'all' ? 'one' : 'none')
  }, [])

  const addToQueue = useCallback((track: MusicTrack) => {
    setQueue((prev) => {
      if (prev.some((t) => t.videoId === track.videoId)) return prev
      return [...prev, track]
    })
  }, [])

  return (
    <MusicContext.Provider value={{
      queue, currentIndex, currentTrack,
      playing, currentTime, duration, volume, muted, shuffle, repeat,
      playTrack, playRadio, playPause, next, prev, seek, setVolume,
      toggleMute, toggleShuffle, toggleRepeat, addToQueue,
    }}>
      {children}
    </MusicContext.Provider>
  )
}

export function useMusic() {
  const ctx = useContext(MusicContext)
  if (!ctx) throw new Error('useMusic must be used within MusicProvider')
  return ctx
}
