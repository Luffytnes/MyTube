'use client'

import {
  createContext, useContext, useState, useRef,
  useEffect, useCallback, type ReactNode,
} from 'react'
import { savePosition, getPosition } from '@/lib/resumePosition'
import { imageSrc } from '@/lib/thumbnails'
import { getExtensions, onExtensionsChange } from '@/lib/extensions'
import { attachAudioEffects, currentLevelDb, isAudioEffectsAttached, needsAudioGraph } from '@/lib/audioEffects'
import { activeSegment, getSponsorSegments, type SponsorSegment } from '@/lib/sponsorblock'
import { claimMediaSession, MEDIA_SESSION_RELEASED, ownsMediaSession, updateMediaSession } from '@/lib/mediaSession'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

// 0.1 s of silence: played once from a click so the second player is allowed
// to start the next song on its own later (strict autoplay policies)
const SILENCE = 'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA=='

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

// Build src URL for a track
function trackSrc(track: MusicTrack): string | null {
  if (track.radioStreamUrl) return track.radioStreamUrl
  if (track.directUrl) return `${API_BASE}/api/podcasts/audio/proxy?url=${encodeURIComponent(track.directUrl)}`
  if (track.videoId) return `${API_BASE}/api/stream/${track.videoId}/audio`
  return null
}

// Attached to the DOM so iOS treats it as a real media element
// (new Audio() objects get suspended by iOS in background/lock screen mode)
function makePlayer(): HTMLAudioElement {
  const audio = document.createElement('audio')
  audio.preload = 'auto'
  // CORS-mode requests (the API allows them) let the equalizer and the
  // silence detection read the sound
  audio.crossOrigin = 'anonymous'
  audio.setAttribute('playsinline', '')        // prevent iOS fullscreen hijack
  audio.setAttribute('webkit-playsinline', '') // older iOS
  audio.style.display = 'none'
  document.body.appendChild(audio)
  return audio
}

/** iOS ignores `volume` (always 1): fading there would play two songs at full volume. */
function volumeIsSettable(): boolean {
  const probe = document.createElement('audio')
  probe.volume = 0.5
  return probe.volume === 0.5
}

interface Fade {
  from: HTMLAudioElement
  to: HTMLAudioElement
  timer: ReturnType<typeof setInterval> | null  // null while the next song is starting
}

export function MusicProvider({ children }: { children: ReactNode }) {
  // Two players take turns so a song can fade into the next one; audioRef is
  // the one currently heard (the other is idle, or fading out)
  const playersRef = useRef<HTMLAudioElement[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)
  // Tracks when playTrack/playRadio already set the src synchronously (mobile gesture context).
  // The useEffect skips re-setting src for that track to avoid resetting playback.
  const pendingTrackIdRef = useRef<string | null>(null)
  // Last known playback position — used to restore after iOS lock screen suspend
  const lastKnownTimeRef = useRef<number>(0)
  // Always-current track ref — readable from Media Session handlers without stale closure
  const currentTrackRef = useRef<MusicTrack | null>(null)
  const savePositionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fadeRef = useRef<Fade | null>(null)
  // Next song already loading on the idle player (a stream takes seconds to start)
  const preparedRef = useRef<{ index: number; src: string; el: HTMLAudioElement; after: string } | null>(null)
  const userVolumeRef = useRef(1)
  const canFadeRef = useRef(true)
  const unlockedRef = useRef(false)
  const sponsorRef = useRef<{ videoId: string; segments: SponsorSegment[]; handled: Set<number> } | null>(null)
  const mediaSessionId = useRef(Symbol('music-player'))
  const lastSessionUpdate = useRef(0)
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
  // Latest state for the element listeners, which are attached once
  const stateRef = useRef({ queue, currentIndex, shuffle, repeat })
  stateRef.current = { queue, currentIndex, shuffle, repeat }

  /** Index played after the current one when a song ends, or null at the end of the queue. */
  const nextAutoIndex = useCallback((): number | null => {
    const { queue: q, currentIndex: i, shuffle: sh, repeat: rep } = stateRef.current
    if (q.length === 0) return null
    if (sh) return Math.floor(Math.random() * q.length)
    if (i + 1 < q.length) return i + 1
    if (rep === 'all') return 0
    return null
  }, [])

  /** End a crossfade right away (user action, or the fade is over). */
  const finishFade = useCallback(() => {
    const fade = fadeRef.current
    if (!fade) return
    fadeRef.current = null
    if (fade.timer) clearInterval(fade.timer)
    if (fade.from !== audioRef.current) {
      fade.from.pause()
      fade.from.removeAttribute('src')
      fade.from.load()
    }
    if (fade.to !== audioRef.current) {
      // Cancelled before the next song started
      fade.to.pause()
      fade.to.removeAttribute('src')
      fade.to.load()
    }
    const active = audioRef.current
    if (active) active.volume = userVolumeRef.current
  }, [])

  /** Forget the preloaded next song (the queue or the current song changed). */
  const dropPrepared = useCallback(() => {
    const prepared = preparedRef.current
    preparedRef.current = null
    const fade = fadeRef.current
    if (!prepared || prepared.el === audioRef.current || prepared.el === fade?.from || prepared.el === fade?.to) return
    prepared.el.removeAttribute('src')
    prepared.el.load()
  }, [])

  /** Start loading the song that will follow, on the idle player. */
  const prepareNext = useCallback((nextIdx: number) => {
    const from = audioRef.current
    const el = playersRef.current.find(p => p !== from)
    const track = stateRef.current.queue[nextIdx]
    const src = track && trackSrc(track)
    if (!from || !el || !src || !currentTrackRef.current) return
    el.volume = 0
    el.preload = 'auto'
    el.src = src
    el.load()
    preparedRef.current = { index: nextIdx, src, el, after: currentTrackRef.current.videoId }
  }, [])

  /** Start the next song on the idle player and fade between them. */
  const startCrossfade = useCallback((nextIdx: number) => {
    const from = audioRef.current
    const track = stateRef.current.queue[nextIdx]
    const src = track && trackSrc(track)
    const prepared = preparedRef.current
    preparedRef.current = null
    const reuse = prepared && prepared.el !== from && prepared.src === src
    const to = reuse ? prepared.el : playersRef.current.find(p => p !== from)
    if (!from || !to || !src) { setCurrentIndex(nextIdx); return }
    const fade: Fade = { from, to, timer: null }
    fadeRef.current = fade
    if (!reuse) to.src = src
    to.muted = from.muted
    to.volume = 0
    void attachAudioEffects(to)
    to.play().then(() => {
      // Cancelled meanwhile, or the song ended first and moved on without us
      if (fadeRef.current !== fade || audioRef.current !== from || from.ended) {
        if (fadeRef.current === fade) finishFade()
        return
      }
      pendingTrackIdRef.current = track.videoId
      audioRef.current = to
      setCurrentIndex(nextIdx)
      setCurrentTime(0)
      // Never longer than what is left of the song, so it fades out completely
      const left = isFinite(from.duration) ? from.duration - from.currentTime : Infinity
      const length = Math.max(1, Math.min(getExtensions().crossfadeSeconds, left)) * 1000
      const startedAt = Date.now()
      // Timers, not animation frames: those stop in background tabs
      fade.timer = setInterval(() => {
        const p = Math.min(1, (Date.now() - startedAt) / length)
        const v = userVolumeRef.current
        // Equal-power curves: the overall loudness stays constant
        to.volume = v * Math.sin((p * Math.PI) / 2)
        from.volume = v * Math.cos((p * Math.PI) / 2)
        if (p >= 1) finishFade()
      }, 50)
    }).catch(() => {
      // Autoplay refused for this player: songs follow each other without fading
      canFadeRef.current = false
      if (fadeRef.current === fade) finishFade()
    })
  }, [finishFade])

  /** Move on to the next song as at its end, fading when enabled. */
  const advance = useCallback(() => {
    const track = currentTrackRef.current
    // The preloaded song, so shuffle does not pick another one at the last second
    const prepared = preparedRef.current
    const nextIdx = prepared && prepared.after === track?.videoId ? prepared.index : nextAutoIndex()
    if (nextIdx === null) return
    const s = getExtensions()
    if (s.crossfade && canFadeRef.current && track && !track.isRadio && !track.directUrl) startCrossfade(nextIdx)
    else setCurrentIndex(nextIdx)
  }, [nextAutoIndex, startCrossfade])

  const claimSession = useCallback(() => {
    const track = currentTrackRef.current
    if (!track) return
    claimMediaSession(mediaSessionId.current, {
      title: track.title,
      artist: track.artists.map((a) => a.name).join(', '),
      album: track.album ?? '',
      artwork: track.thumbnail ? [{ src: imageSrc(track.thumbnail)!, sizes: '512x512', type: 'image/jpeg' }] : [],
    }, {
      play: () => {
        const audio = audioRef.current
        if (!audio) return
        const current = currentTrackRef.current
        // iOS may have cleared audio.src during background suspend — reload it
        if (!audio.src || audio.src === window.location.href) {
          const src = current && trackSrc(current)
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
        // Restore position if iOS reset currentTime to 0
        const saved = lastKnownTimeRef.current
        if (saved > 2 && audio.currentTime < 1) audio.currentTime = saved
        audio.play().catch(() => {})
      },
      pause: () => { audioRef.current?.pause() },
      nexttrack: () => {
        finishFade()
        setCurrentIndex((prev) => (prev + 1 < stateRef.current.queue.length ? prev + 1 : prev))
      },
      previoustrack: () => {
        finishFade()
        const audio = audioRef.current
        if (audio && audio.currentTime > 3) { audio.currentTime = 0; return }
        setCurrentIndex((prev) => (prev - 1 >= 0 ? prev - 1 : 0))
      },
      seekto: details => {
        const audio = audioRef.current
        if (audio && details.seekTime !== undefined && !currentTrackRef.current?.isRadio) audio.currentTime = details.seekTime
      },
    })
    updateMediaSession(mediaSessionId.current, !audioRef.current?.paused)
  }, [finishFade])

  const claimSessionRef = useRef(claimSession)
  claimSessionRef.current = claimSession

  /** Per-tick work of the playing song: SponsorBlock and the crossfade start. */
  const onTick = useCallback((audio: HTMLAudioElement) => {
    const track = currentTrackRef.current
    if (!track || track.isRadio) return
    const s = getExtensions()
    const t = audio.currentTime
    const dur = audio.duration

    const now = Date.now()
    if (now - lastSessionUpdate.current > 1000) {
      lastSessionUpdate.current = now
      updateMediaSession(mediaSessionId.current, !audio.paused, { duration: dur, position: t, playbackRate: audio.playbackRate })
    }

    // Non-music parts of music videos (intros, sketches), and sponsors
    const sponsor = sponsorRef.current
    if (s.sponsorBlock && sponsor && sponsor.videoId === track.videoId && !audio.seeking) {
      const hit = activeSegment(sponsor.segments, t, s.sponsorCategories, sponsor.handled)
      if (hit && hit.segment.actionType === 'skip') {
        sponsor.handled.add(hit.index)
        if (isFinite(dur) && hit.segment.end >= dur - 1) advance()
        else audio.currentTime = hit.segment.end
        return
      }
    }

    if (
      s.crossfade && canFadeRef.current && !fadeRef.current && !track.directUrl
      && stateRef.current.repeat !== 'one'
      && isFinite(dur) && dur > s.crossfadeSeconds * 3
    ) {
      const left = dur - t
      if (left <= s.crossfadeSeconds) advance()
      else if (left <= s.crossfadeSeconds + 15 && preparedRef.current?.after !== track.videoId) {
        const nextIdx = nextAutoIndex()
        if (nextIdx !== null) prepareNext(nextIdx)
      }
    }
  }, [advance, nextAutoIndex, prepareNext])

  const onTickRef = useRef(onTick)
  onTickRef.current = onTick

  // Initialize both players once
  useEffect(() => {
    canFadeRef.current = volumeIsSettable()
    const players = [makePlayer(), makePlayer()]
    playersRef.current = players
    audioRef.current = players[0]

    for (const audio of players) {
      const active = () => audio === audioRef.current
      audio.addEventListener('timeupdate', () => {
        if (!active()) return
        setCurrentTime(audio.currentTime)
        if (audio.currentTime > 0) lastKnownTimeRef.current = audio.currentTime
        onTickRef.current(audio)
      })
      audio.addEventListener('loadedmetadata', () => { if (active()) setDuration(audio.duration) })
      audio.addEventListener('durationchange', () => { if (active() && isFinite(audio.duration)) setDuration(audio.duration) })
      audio.addEventListener('play', () => {
        if (!active()) return
        setPlaying(true)
        claimSessionRef.current()
        if (needsAudioGraph()) void attachAudioEffects(audio)
      })
      audio.addEventListener('pause', () => {
        if (!active()) return
        setPlaying(false)
        updateMediaSession(mediaSessionId.current, false)
      })
      audio.addEventListener('volumechange', () => {
        if (!active() || fadeRef.current) return  // fades move the volume, not the user
        setVolumeState(audio.volume)
        setMuted(audio.muted)
      })
      audio.addEventListener('ended', () => { if (active()) handleEndedRef.current() })
    }

    // iOS: when app comes back to foreground after lock screen, restore playback position
    const onVisibilityChange = () => {
      const audio = audioRef.current
      if (document.visibilityState === 'visible' && audio && !audio.paused) {
        const saved = lastKnownTimeRef.current
        if (saved > 2 && audio.currentTime < 1) {
          audio.currentTime = saved
        }
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    // A video player gave the media keys back: take them again while music plays
    const onReleased = () => { if (audioRef.current && !audioRef.current.paused) claimSessionRef.current() }
    window.addEventListener(MEDIA_SESSION_RELEASED, onReleased)
    // An effect switched on while a song plays (from a click in the settings,
    // which lets the audio context start) applies at once
    const offExtensions = onExtensionsChange(() => {
      const audio = audioRef.current
      if (audio && !audio.paused && needsAudioGraph()) void attachAudioEffects(audio)
    })

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener(MEDIA_SESSION_RELEASED, onReleased)
      offExtensions()
      if (fadeRef.current?.timer) clearInterval(fadeRef.current.timer)
      for (const audio of players) {
        audio.pause()
        audio.src = ''
        if (audio.parentNode) audio.parentNode.removeChild(audio)
      }
    }
  }, [])

  // New song: new metadata for the media keys, its SponsorBlock segments
  useEffect(() => {
    const track = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null
    if (!track) return
    if (preparedRef.current && preparedRef.current.after !== track.videoId) dropPrepared()
    if (ownsMediaSession(mediaSessionId.current)) claimSession()
    sponsorRef.current = null
    const s = getExtensions()
    if (!s.sponsorBlock || track.isRadio || track.directUrl || !/^[A-Za-z0-9_-]{11}$/.test(track.videoId)) return
    let cancelled = false
    getSponsorSegments(track.videoId).then(segments => {
      if (!cancelled) sponsorRef.current = { videoId: track.videoId, segments, handled: new Set() }
    })
    return () => { cancelled = true }
  }, [currentIndex, queue, claimSession, dropPrepared])

  // Skip silences: before the first note, and the silent tail of a song
  useEffect(() => {
    if (!playing) return
    const buffer = new Float32Array(2048)
    let trackId: string | null = null
    let heard = false
    let silentMs = 0
    const timer = setInterval(() => {
      const audio = audioRef.current
      const track = currentTrackRef.current
      if (!getExtensions().skipSilences || !audio || !track || track.isRadio) return
      if (!isAudioEffectsAttached(audio)) { void attachAudioEffects(audio); return }
      if (track.videoId !== trackId) { trackId = track.videoId; heard = false; silentMs = 0 }
      const volume = audio.muted ? 0 : audio.volume
      if (audio.paused || audio.seeking || fadeRef.current || volume < 0.01) { silentMs = 0; return }
      const db = currentLevelDb(buffer)
      if (db === null) return
      // The analyser hears the sound after the volume: compare with the source level
      if (db - 20 * Math.log10(volume) > -55) { heard = true; silentMs = 0; return }
      silentMs += 100
      const remaining = audio.duration - audio.currentTime
      if (!heard && audio.currentTime < 20 && silentMs >= 300) {
        audio.currentTime += 0.5
      } else if (heard && isFinite(remaining) && remaining < 25 && silentMs >= 1500) {
        silentMs = 0
        advance()
      }
    }, 100)
    return () => clearInterval(timer)
  }, [playing, advance])

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

  const handleEndedRef = useRef(handleEnded)
  handleEndedRef.current = handleEnded

  /** Let the idle player start songs on its own later (needs a click once). */
  const unlockSecondPlayer = useCallback(() => {
    if (unlockedRef.current) return
    const other = playersRef.current.find(p => p !== audioRef.current)
    if (!other) return
    unlockedRef.current = true
    other.src = SILENCE
    other.play().then(() => other.pause(), () => {}).finally(() => {
      if (fadeRef.current?.to === other) return
      other.removeAttribute('src')
      other.load()
    })
  }, [])

  // Set audio src for a track and attempt playback.
  // Call this synchronously inside click handlers to stay within the mobile
  // user-gesture context (iOS Safari blocks audio.play() from useEffect).
  const loadAndPlay = useCallback((track: MusicTrack) => {
    finishFade()
    const audio = audioRef.current
    if (!audio) return
    const src = trackSrc(track)
    if (!src) return

    // Clear previous save timer
    if (savePositionTimerRef.current) clearInterval(savePositionTimerRef.current)

    pendingTrackIdRef.current = track.videoId
    audio.src = src
    audio.volume = userVolumeRef.current

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
    unlockSecondPlayer()
  }, [finishFade, unlockSecondPlayer])

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
    const src = trackSrc(track)
    if (!src) return
    audio.src = src
    audio.volume = userVolumeRef.current
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
    finishFade()
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) audio.play().catch(() => {})
    else audio.pause()
    unlockSecondPlayer()
  }, [finishFade, unlockSecondPlayer])

  const next = useCallback(() => {
    finishFade()
    setCurrentIndex((prev) => {
      const len = queue.length
      if (len === 0) return prev
      if (shuffle) return Math.floor(Math.random() * len)
      if (prev + 1 < len) return prev + 1
      if (repeat === 'all') return 0
      return prev
    })
  }, [queue.length, shuffle, repeat, finishFade])

  const prev = useCallback(() => {
    finishFade()
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
  }, [queue.length, repeat, finishFade])

  const seek = useCallback((t: number) => {
    finishFade()
    const audio = audioRef.current
    if (audio) audio.currentTime = t
  }, [finishFade])

  const setVolume = useCallback((v: number) => {
    userVolumeRef.current = v
    setVolumeState(v)
    const audio = audioRef.current
    if (audio) { audio.muted = false; if (!fadeRef.current) audio.volume = v }
  }, [])

  const toggleMute = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    const nextMuted = !audio.muted
    for (const p of playersRef.current) p.muted = nextMuted
    setMuted(nextMuted)
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
    finishFade()
    setCurrentIndex(index)
  }, [finishFade])

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
  }, [])

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
