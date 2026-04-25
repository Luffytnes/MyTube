'use client'

import {
  createContext, useContext, useState, useRef,
  useEffect, useCallback, type ReactNode,
} from 'react'
import { savePosition, getPosition } from '@/lib/resumePosition'

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
  playAtIndex: (index: number) => void
  preloadTrack: (track: MusicTrack) => void
}

const MusicContext = createContext<MusicContextType | null>(null)

export function MusicProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  // Tracks when playTrack/playRadio already set the src synchronously (mobile gesture context).
  // The useEffect skips re-setting src for that track to avoid resetting playback.
  const pendingTrackIdRef = useRef<string | null>(null)
  // Last known playback position — used to restore after iOS lock screen suspend
  const lastKnownTimeRef = useRef<number>(0)
  // Always-current track ref — readable from Media Session handlers without stale closure
  const currentTrackRef = useRef<MusicTrack | null>(null)
  const savePositionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
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

  // Keep ref in sync so Media Session handlers always have the current track
  currentTrackRef.current = currentTrack

  // Initialize audio element once — attached to DOM so iOS treats it as a real media element
  // (new Audio() objects get suspended by iOS in background/lock screen mode)
  useEffect(() => {
    const audio = document.createElement('audio')
    audio.preload = 'auto'
    audio.setAttribute('playsinline', '')        // prevent iOS fullscreen hijack
    audio.setAttribute('webkit-playsinline', '') // older iOS
    audio.style.display = 'none'
    document.body.appendChild(audio)
    audioRef.current = audio

    audio.addEventListener('timeupdate', () => {
      setCurrentTime(audio.currentTime)
      if (audio.currentTime > 0) lastKnownTimeRef.current = audio.currentTime
    })
    audio.addEventListener('loadedmetadata', () => setDuration(audio.duration))
    audio.addEventListener('play', () => setPlaying(true))
    audio.addEventListener('pause', () => setPlaying(false))
    audio.addEventListener('ended', () => {})
    audio.addEventListener('volumechange', () => {
      setVolumeState(audio.volume)
      setMuted(audio.muted)
    })

    // iOS: when app comes back to foreground after lock screen, restore playback position
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !audio.paused) {
        const saved = lastKnownTimeRef.current
        if (saved > 2 && audio.currentTime < 1) {
          audio.currentTime = saved
        }
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      audio.pause()
      audio.src = ''
      document.body.removeChild(audio)
    }
  }, [])

  // Media Session API — lock screen / notification controls
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const track = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null
    if (!track) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artists.map((a) => a.name).join(', '),
      album: track.album ?? '',
      artwork: track.thumbnail ? [{ src: track.thumbnail, sizes: '512x512', type: 'image/jpeg' }] : [],
    })
  }, [currentIndex, queue])

  // Sync playbackState so iOS lock screen shows correct play/pause button
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
  }, [playing])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    // Use audioRef (not audioRef.current) so handlers always read the live element
    navigator.mediaSession.setActionHandler('play', () => {
      const audio = audioRef.current
      if (!audio) return
      const track = currentTrackRef.current
      // iOS may have cleared audio.src during background suspend — reload it
      if (!audio.src || audio.src === window.location.href) {
        if (track) {
          const src = trackSrc(track)
          if (src) {
            audio.src = src
            audio.load()
            const saved = lastKnownTimeRef.current
            audio.addEventListener('canplay', () => {
              if (saved > 2) audio.currentTime = saved
              audio.play().catch(() => {})
            }, { once: true })
            return
          }
        }
      }
      // Restore position if iOS reset currentTime to 0
      const saved = lastKnownTimeRef.current
      if (saved > 2 && audio.currentTime < 1) audio.currentTime = saved
      audio.play().catch(() => {})
    })
    navigator.mediaSession.setActionHandler('pause', () => {
      audioRef.current?.pause()
    })
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      setCurrentIndex((prev) => {
        const len = queue.length
        if (len === 0) return prev
        if (prev + 1 < len) return prev + 1
        return prev
      })
    })
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      const audio = audioRef.current
      if (audio && audio.currentTime > 3) { audio.currentTime = 0; return }
      setCurrentIndex((prev) => {
        const len = queue.length
        if (len === 0) return prev
        if (prev - 1 >= 0) return prev - 1
        return 0
      })
    })
  }, [queue.length])

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

  // Build src URL for a track
  function trackSrc(track: MusicTrack): string | null {
    if (track.radioStreamUrl) return track.radioStreamUrl
    if (track.directUrl) return `${API_BASE}/api/podcasts/audio/proxy?url=${encodeURIComponent(track.directUrl)}`
    if (track.videoId) return `${API_BASE}/api/stream/${track.videoId}/audio`
    return null
  }

  // Set audio src for a track and attempt playback.
  // Call this synchronously inside click handlers to stay within the mobile
  // user-gesture context (iOS Safari blocks audio.play() from useEffect).
  const loadAndPlay = useCallback((track: MusicTrack) => {
    const audio = audioRef.current
    if (!audio) return
    const src = trackSrc(track)
    if (!src) return

    // Clear previous save timer
    if (savePositionTimerRef.current) clearInterval(savePositionTimerRef.current)

    pendingTrackIdRef.current = track.videoId
    audio.src = src

    // Resume podcast from saved position
    if (track.directUrl) {
      const saved = getPosition(track.videoId)
      if (saved && saved > 0) {
        const onMeta = () => {
          audio.currentTime = saved
          audio.removeEventListener('loadedmetadata', onMeta)
        }
        audio.addEventListener('loadedmetadata', onMeta)
      }
      // Save position every 5s while playing
      savePositionTimerRef.current = setInterval(() => {
        if (!audio.paused && audio.duration > 0) {
          savePosition(track.videoId, audio.currentTime, audio.duration)
        }
      }, 5000)
    }

    audio.play().catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Load new track when currentIndex changes (handles next/prev/queue navigation).
  // Skips tracks already loaded synchronously by loadAndPlay to avoid resetting playback.
  useEffect(() => {
    const audio = audioRef.current
    const track = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null
    if (!audio || !track) return
    if (pendingTrackIdRef.current === track.videoId) {
      pendingTrackIdRef.current = null
      return // src already set synchronously, don't reset
    }
    pendingTrackIdRef.current = null
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
    // Load synchronously while still in the user-gesture context so iOS Safari
    // does not block audio.play() (it rejects calls made from async paths).
    loadAndPlay(track)
    setQueue(q)
    setCurrentIndex(idx >= 0 ? idx : 0)
  }, [loadAndPlay])

  // Play a radio station — replaces queue with single live track
  const playRadio = useCallback((track: MusicTrack) => {
    loadAndPlay(track)
    setQueue([track])
    setCurrentIndex(0)
  }, [loadAndPlay])

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

  const playAtIndex = useCallback((index: number) => {
    setCurrentIndex(index)
  }, [])

  // Preload a track's audio without playing — call on hover/touchstart for faster start
  const preloadTrack = useCallback((track: MusicTrack) => {
    const audio = audioRef.current
    if (!audio || audio.src.includes(track.videoId) || track.radioStreamUrl) return
    const src = trackSrc(track)
    if (!src) return
    // Use a secondary audio element to warm up the connection, don't disturb current playback
    const preloader = new Audio()
    preloader.preload = 'metadata'
    preloader.src = src
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <MusicContext.Provider value={{
      queue, currentIndex, currentTrack,
      playing, currentTime, duration, volume, muted, shuffle, repeat,
      playTrack, playRadio, playPause, next, prev, seek, setVolume,
      toggleMute, toggleShuffle, toggleRepeat, addToQueue, playAtIndex, preloadTrack,
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
