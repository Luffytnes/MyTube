'use client'

import {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
  ChangeEvent,
} from 'react'
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Settings,
  Radio,
  SkipBack,
  SkipForward,
  Subtitles,
  RotateCcw,
  RotateCw,
  Check,
  Languages,
  PictureInPicture2,
  X,
} from 'lucide-react'
import { formatDuration } from '@/lib/utils'
import { getStreamUrl, getAudioUrl, getAudioTracks, getSubtitles, getSubtitleUrl, type AudioTrack, type VideoFormat, type SubtitleTrack } from '@/lib/api'
import VolumeSlider from '@/components/ui/VolumeSlider'
import { useRegion } from '@/lib/regionContext'
import { getPlaybackSettings, setPlaybackSettings } from '@/lib/playbackSettings'
import { savePosition, getPosition } from '@/lib/resumePosition'
import { adaptiveFallback, pickInitialFormat, rankedVideoFormats } from '@/lib/videoFormats'
import { getStoryboard } from '@/lib/api'
import { storyboardTile, type Storyboard } from '@/lib/storyboard'
import { useExtensions, onExtensionsChange, SPONSOR_COLORS, stepVolume, volumeToSlider, type SponsorCategory } from '@/lib/extensions'
import { useSponsorSegments, activeSegment } from '@/lib/sponsorblock'
import { claimMediaSession, releaseMediaSession, updateMediaSession } from '@/lib/mediaSession'
import { attachAudioEffects, needsAudioGraph } from '@/lib/audioEffects'
import { useWheelVolume } from '@/lib/useWheelVolume'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

const pendingStops = new Map<string, Promise<void>>()

/** Kill server-side HLS sessions for this video+format (also drops its cached
 *  stream URLs). Tracked so a new session can wait for it: a DELETE landing
 *  after the new playlist request (e.g. delayed by a CORS preflight) would kill
 *  the fresh session. */
function stopHlsSession(videoId: string, itag: string): Promise<void> {
  const key = `${videoId}:${itag}`
  const stop: Promise<void> = fetch(`${API_BASE}/api/hls/${videoId}/${itag}`, { method: 'DELETE' })
    .then(() => {}, () => {})
    .finally(() => { if (pendingStops.get(key) === stop) pendingStops.delete(key) })
  pendingStops.set(key, stop)
  return stop
}

/** Resolves once no DELETE for this video+format is in flight. A fresh start
 *  sends none of its own, so the URLs prefetched on hover stay cached. */
function afterPendingStop(videoId: string, itag: string): Promise<void> {
  return pendingStops.get(`${videoId}:${itag}`) ?? Promise.resolve()
}

export interface Chapter {
  time: number
  title: string
}

interface VideoPlayerProps {
  videoId: string
  formats: VideoFormat[]
  title: string
  isLive?: boolean
  knownDuration?: number
  onEnded?: () => void
  onNext?: () => void
  onPrev?: () => void
  hasNext?: boolean
  hasPrev?: boolean
  chapters?: Chapter[]
  seekToRef?: React.MutableRefObject<((t: number) => void) | null>
  /** Media Session (media keys, Control Center): channel name and artwork URL */
  artist?: string
  artwork?: string
}

// Panel wrapper — Vidking-style dark floating card
function Panel({
  title, icon, children,
}: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="w-64 bg-black/70 backdrop-blur-2xl border border-white/10 rounded-2xl overflow-hidden shadow-elevated animate-fade-up" onClick={e => e.stopPropagation()}>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.07]">
        <div className="w-7 h-7 bg-accent-gradient rounded-lg flex items-center justify-center text-white shrink-0">
          {icon}
        </div>
        <span className="text-white text-sm font-semibold">{title}</span>
      </div>
      <div className="max-h-56 overflow-y-auto">
        {children}
      </div>
    </div>
  )
}

function PanelItem({
  label, sublabel, active, onClick,
}: { label: string; sublabel?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
    >
      <div className="text-left">
        <span className={`text-sm ${active ? 'text-white font-medium' : 'text-white/55'}`}>{label}</span>
        {sublabel && <span className="text-[10px] text-white/35 ml-2">{sublabel}</span>}
      </div>
      {active && (
        <div className="w-5 h-5 rounded-full bg-accent-gradient flex items-center justify-center shrink-0 ml-2">
          <Check className="w-3 h-3 text-white" />
        </div>
      )}
    </button>
  )
}

export default function VideoPlayer({ videoId, formats, title, isLive, knownDuration, onEnded, onNext, onPrev, hasNext, hasPrev, chapters = [], seekToRef, artist, artwork }: VideoPlayerProps) {
  const { t, lang: uiLang } = useRegion()
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hlsRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hdHlsRef = useRef<any>(null)
  const effectiveDurationRef = useRef<number>(0)
  const hlsStartOffsetRef = useRef<number>(0)
  const justShowedControlsRef = useRef(false)
  const seekBarRef = useRef<HTMLDivElement>(null)
  const seekDragging = useRef(false)
  const hlsRestartRef = useRef(0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const startHdHlsRef = useRef<((startOffset: number, autoplay: boolean, isErrorRestart?: boolean) => void) | null>(null)
  const isVideoOnlyRef = useRef(false)
  const aligningRef = useRef(false)

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolume] = useState(() => getPlaybackSettings().defaultVolume)
  const [muted, setMuted] = useState(false)
  const [speed, setSpeed] = useState(() => getPlaybackSettings().defaultSpeed)
  const [showSpeedMenu, setShowSpeedMenu] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [showQualityMenu, setShowQualityMenu] = useState(false)
  const [selectedFormat, setSelectedFormat] = useState<VideoFormat | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const savePositionTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([])
  const [selectedSubtitle, setSelectedSubtitle] = useState<string>(() => getPlaybackSettings().subtitleLang)
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false)
  // Audio language: null = the video's original track (the backend default)
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([])
  const [audioLang, setAudioLang] = useState<string | null>(null)
  const audioLangRef = useRef<string | null>(null)
  const [showAudioMenu, setShowAudioMenu] = useState(false)
  const [scrubRatio, setScrubRatio] = useState<number | null>(null)
  const [hoverRatio, setHoverRatio] = useState<number | null>(null)
  const [subCues, setSubCues] = useState<Array<{ start: number; end: number; lines: string[] }>>([])
  const [activeCue, setActiveCue] = useState<string[] | null>(null)
  // Strict browsers (LibreWolf, Safari's "Stop media") refuse play() that is not
  // a direct reaction to a click; we then need an explicit play button.
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)
  const ext = useExtensions()
  const volumeGroupRef = useRef<HTMLDivElement>(null)
  const [volumeHud, setVolumeHud] = useState<number | null>(null)
  const volumeHudTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [storyboard, setStoryboard] = useState<Storyboard | null>(null)
  const [pipSupported, setPipSupported] = useState(false)
  const mediaSessionId = useRef(Symbol('youtube-player'))
  const lastSessionUpdate = useRef(0)
  // SponsorBlock: segments handled (skipped, muted or undone) during this playback
  const segments = useSponsorSegments(isLive ? null : videoId, ext.sponsorBlock)
  const handledSegments = useRef<Set<number>>(new Set())
  const segmentMuted = useRef<number | null>(null)
  const [skipNotice, setSkipNotice] = useState<{ category: string; start: number } | null>(null)
  const skipNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const allVideoFormats = useMemo(() => rankedVideoFormats(formats), [formats])

  useEffect(() => {
    handledSegments.current = new Set()
    segmentMuted.current = null
    setSkipNotice(null)
  }, [videoId])

  useEffect(() => {
    setStoryboard(null)
    if (isLive || !ext.seekPreview) return
    let cancelled = false
    getStoryboard(videoId).then(board => { if (!cancelled) setStoryboard(board) })
    return () => { cancelled = true }
  }, [videoId, isLive, ext.seekPreview])

  // Firefox/LibreWolf have no Picture-in-Picture API (they offer their own button on the video)
  useEffect(() => { setPipSupported(!!document.pictureInPictureEnabled) }, [])

  // An effect switched on during playback applies at once
  useEffect(() => onExtensionsChange(() => {
    const v = videoRef.current
    if (v && !v.paused && needsAudioGraph()) void attachAudioEffects(v)
  }), [])

  useEffect(() => {
    const id = mediaSessionId.current
    return () => {
      releaseMediaSession(id)
      if (volumeHudTimer.current) clearTimeout(volumeHudTimer.current)
      if (skipNoticeTimer.current) clearTimeout(skipNoticeTimer.current)
    }
  }, [])

  useEffect(() => {
    if (duration > 0) effectiveDurationRef.current = duration
  }, [duration])

  useEffect(() => {
    setSubtitleTracks([])
    const settings = getPlaybackSettings()
    if (settings.subtitleLang !== 'off') {
      getSubtitles(videoId).then(setSubtitleTracks).catch(() => {})
    }
    setSelectedSubtitle(settings.subtitleLang)
  }, [videoId])

  // Audio languages (YouTube's AI dubs): fetched once per video, original by default
  useEffect(() => {
    setAudioTracks([])
    setAudioLang(null)
    audioLangRef.current = null
    let cancelled = false
    getAudioTracks(videoId).then(tracks => { if (!cancelled) setAudioTracks(tracks) }).catch(() => {})
    return () => { cancelled = true }
  }, [videoId])

  const originalLang = audioTracks.find(track => track.original)?.lang ?? null

  function languageName(track: AudioTrack): string {
    try {
      const name = new Intl.DisplayNames([uiLang], { type: 'language' }).of(track.lang)
      if (name) return name.charAt(0).toUpperCase() + name.slice(1)
    } catch { /* unsupported code: use YouTube's label */ }
    return track.label
  }

  function selectAudioLanguage(lang: string | null) {
    setShowAudioMenu(false)
    if (lang === audioLangRef.current) return
    audioLangRef.current = lang
    setAudioLang(lang)
    const video = videoRef.current
    // Restart the HLS session on the new track where playback currently is
    if (video && isVideoOnlyRef.current) startHdHlsRef.current?.(hlsStartOffsetRef.current + video.currentTime, !video.paused)
  }

  // Fetch + parse subtitle VTT
  useEffect(() => {
    setSubCues([])
    setActiveCue(null)
    if (selectedSubtitle === 'off') return
    let cancelled = false
    function toSec(t: string): number {
      const parts = t.trim().split(':').map(Number)
      return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1]
    }
    fetch(getSubtitleUrl(videoId, selectedSubtitle))
      .then(r => r.ok ? r.text() : Promise.reject())
      .then(text => {
        if (cancelled) return
        const cues: Array<{ start: number; end: number; lines: string[] }> = []
        for (const block of text.split(/\n{2,}/)) {
          const lines = block.trim().split('\n')
          const ti = lines.findIndex(l => l.includes('-->'))
          if (ti === -1) continue
          const [sPart, ePart] = lines[ti].split('-->').map(p => p.trim().split(/\s/)[0])
          const start = toSec(sPart), end = toSec(ePart)
          const rawTxt = lines.slice(ti + 1).filter(l => l.trim() && !l.startsWith('NOTE')).join('\n')
          const stripped = rawTxt.replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '')
          const txt = stripped
            .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
            .replace(/&#x([0-9a-fA-F]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&nbsp;/g, ' ')
            .trim()
          if (txt && !isNaN(start) && !isNaN(end)) cues.push({ start, end, lines: txt.split('\n') })
        }
        setSubCues(cues)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [videoId, selectedSubtitle]) // eslint-disable-line react-hooks/exhaustive-deps

  // Update active cue on timeupdate
  useEffect(() => {
    if (subCues.length === 0) { setActiveCue(null); return }
    const video = videoRef.current
    if (!video) return
    const onTime = () => {
      const t = hlsStartOffsetRef.current + (videoRef.current?.currentTime ?? 0)
      const cue = subCues.find(c => t >= c.start && t < c.end) ?? null
      setActiveCue(cue ? cue.lines : null)
    }
    video.addEventListener('timeupdate', onTime)
    return () => video.removeEventListener('timeupdate', onTime)
  }, [subCues]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const settings = getPlaybackSettings()
    const initial = pickInitialFormat(allVideoFormats, settings.defaultQuality)
    setSelectedFormat(initial)
    // Nothing to play (private or removed video, YouTube refused): say so instead of spinning
    setError(!initial && !isLive ? t('player_no_format') : null)
    setLoading(!!initial || !!isLive)
    setPlaying(false)
    setAutoplayBlocked(false)
    setCurrentTime(0)
    setSpeed(settings.defaultSpeed)
    setVolume(settings.defaultVolume)
    const video = videoRef.current
    if (video) { video.volume = settings.defaultVolume; video.playbackRate = settings.defaultSpeed }
    if (savePositionTimer.current) clearInterval(savePositionTimer.current)
    if (settings.resumePlayback) {
      savePositionTimer.current = setInterval(() => {
        const v = videoRef.current
        const dur = effectiveDurationRef.current || v?.duration || 0
        if (v && !v.paused && dur > 0) {
          const absTime = hlsStartOffsetRef.current + v.currentTime
          savePosition(videoId, absTime, dur)
        }
      }, 5000)
    }
    return () => { if (savePositionTimer.current) clearInterval(savePositionTimer.current) }
  }, [videoId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isLive) return
    const video = videoRef.current
    if (!video) return
    let cancelled = false
    async function setupLive() {
      try {
        const res = await fetch(`${API_BASE}/api/live/${videoId}`)
        if (!res.ok) throw new Error('Failed to get live URL')
        const { url: rawUrl, type } = await res.json()
        const url = rawUrl.startsWith('/') ? `${API_BASE}${rawUrl}` : rawUrl
        if (cancelled || !video) return
        if (type === 'mp4' || video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = url; setLoading(false); return
        }
        const { default: Hls } = await import('hls.js')
        if (cancelled) return
        if (!Hls.isSupported()) { setError('Live streaming is not supported in this browser.'); return }
        const hls = new Hls({ enableWorker: false })
        hlsRef.current = hls
        hls.loadSource(url); hls.attachMedia(video)
        hls.on(Hls.Events.MANIFEST_PARSED, () => { setLoading(false) })
        hls.on(Hls.Events.ERROR, (_: unknown, data: { fatal: boolean; details: string }) => {
          if (data.fatal) setError(`Live stream error: ${data.details}`)
        })
      } catch { if (!cancelled) setError('Failed to load live stream.') }
    }
    setupLive()
    return () => {
      cancelled = true
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null }
    }
  }, [videoId, isLive])

  const isVideoOnly = !!(selectedFormat && !selectedFormat.hasAudio)
  isVideoOnlyRef.current = isVideoOnly
  const streamUrl = selectedFormat ? getStreamUrl(videoId, String(selectedFormat.itag)) : getStreamUrl(videoId)
  const audioSrc = isVideoOnly ? getAudioUrl(videoId) : null

  // Expose seekTo so external components (e.g. description timestamps) can seek the video
  useEffect(() => {
    if (!seekToRef) return
    seekToRef.current = (t: number) => {
      const video = videoRef.current
      if (!video) return
      const dur = effectiveDurationRef.current || video.duration || 0
      if (dur <= 0) return
      setCurrentTime(t)
      if (isVideoOnlyRef.current) {
        startHdHlsRef.current?.(t, !video.paused)
      } else {
        video.currentTime = t
        if (audioRef.current) audioRef.current.currentTime = t
      }
    }
    return () => { if (seekToRef) seekToRef.current = null }
  }, [seekToRef]) // eslint-disable-line react-hooks/exhaustive-deps

  const startHdHls = useCallback((startOffset: number, autoplay: boolean, isErrorRestart = false) => {
    const video = videoRef.current
    if (!video || !selectedFormat) return
    if (!isErrorRestart) hlsRestartRef.current = 0
    aligningRef.current = false
    const hadPreviousSession = !!hdHlsRef.current
    if (hdHlsRef.current) { hdHlsRef.current.destroy(); hdHlsRef.current = null }
    if (hadPreviousSession || isErrorRestart) { video.removeAttribute('src'); video.load() }
    hlsStartOffsetRef.current = startOffset
    const itag = String(selectedFormat.itag)
    const audioParam = audioLangRef.current ? `&audio=${encodeURIComponent(audioLangRef.current)}` : ''
    const hlsUrl = `${API_BASE}/api/hls/${videoId}/${itag}/stream.m3u8?start=${Math.floor(startOffset)}${audioParam}`
    setLoading(true)
    import('hls.js').then(({ default: Hls }) => {
      if (!videoRef.current) return
      if (!Hls.isSupported()) { setError('Lecture HD non supportée dans ce navigateur.'); return }
      let restartQueued = false
      let sessionErrors = 0
      let playStarted = false
      let aligned = false
      let autoplayFallback: ReturnType<typeof setTimeout> | null = null
      const hls = new Hls({ enableWorker: false, maxBufferLength: 30, manifestLoadingMaxRetry: 3, manifestLoadingRetryDelay: 1000 })
      hdHlsRef.current = hls
      // The backend cuts both tracks at the keyframe before the requested time
      // and announces the gap with EXT-X-START (hls.js starts playback there):
      // re-anchor once so displayed and saved positions stay absolute.
      let anchored = false
      hls.on(Hls.Events.LEVEL_LOADED, (_: unknown, data: { details: { startTimeOffset: number | null } }) => {
        if (anchored) return
        anchored = true
        const lead = data.details.startTimeOffset
        if (lead && lead > 0) hlsStartOffsetRef.current = Math.floor(startOffset) - lead
      })
      hls.loadSource(hlsUrl); hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false)
        if (knownDuration) setDuration(knownDuration)
        if (autoplay) {
          // Safety net: if audio segment never arrives within 3s, play anyway
          autoplayFallback = setTimeout(() => {
            if (!playStarted) { playStarted = true; safePlay(video) }
          }, 3000)
        }
      })
      hls.on(Hls.Events.BUFFER_APPENDED, (_, data: any) => {
        const audioRanges: TimeRanges | undefined = data.timeRanges?.audio
        const videoRanges: TimeRanges | undefined = data.timeRanges?.video
        if (!audioRanges || audioRanges.length === 0) return
        if (!videoRanges || videoRanges.length === 0) return

        if (!aligned) {
          try {
            const audioStart = audioRanges.start(0)
            const videoStart = videoRanges.start(0)
            if (audioStart - videoStart > 0.2) {
              // Wait until both buffers have ≥1s beyond the seek target to avoid a
              // buffer stall immediately after seeking (which would restart the session).
              if (videoRanges.end(0) < audioStart + 1.0 || audioRanges.end(0) < audioStart + 1.0) return
              // Playback already past the alignment point — nothing to correct.
              if (!video.paused && video.currentTime > audioStart) { aligned = true; return }
              aligned = true
              aligningRef.current = true
              const onSeeked = () => {
                video.removeEventListener('seeked', onSeeked)
                aligningRef.current = false
                if (autoplay && playStarted) safePlay(video)
              }
              video.addEventListener('seeked', onSeeked)
              if (autoplay && !playStarted) {
                playStarted = true
                if (autoplayFallback) { clearTimeout(autoplayFallback); autoplayFallback = null }
              }
              video.currentTime = audioStart
              return
            }
          } catch { /* ignore */ }
          aligned = true
        }

        if (!autoplay || playStarted) return
        playStarted = true
        if (autoplayFallback) { clearTimeout(autoplayFallback); autoplayFallback = null }
        safePlay(video)
      })
      hls.on(Hls.Events.ERROR, (_: unknown, data: { fatal: boolean; type: string; details: string }) => {
        if (!data.fatal || restartQueued) return
        // A buffer stall during the A/V alignment seek can surface as a fatal media
        // error; recover in place rather than destroying and restarting the session.
        if (aligningRef.current && data.type === 'mediaError') {
          aligningRef.current = false
          hls.recoverMediaError()
          return
        }
        sessionErrors++
        if (sessionErrors === 1 && data.type === 'mediaError') {
          hls.recoverMediaError()
        } else if (hlsRestartRef.current < 2) {
          restartQueued = true
          hlsRestartRef.current++
          if (autoplayFallback) { clearTimeout(autoplayFallback); autoplayFallback = null }
          hls.destroy()
          hdHlsRef.current = null
          const currentPos = hlsStartOffsetRef.current + (videoRef.current?.currentTime ?? 0)
          stopHlsSession(videoId, itag).then(() => startHdHlsRef.current?.(currentPos, autoplay, true))
        } else {
          setError(`Erreur HD : ${data.details}`)
        }
      })
    })
  }, [videoId, selectedFormat, knownDuration]) // eslint-disable-line react-hooks/exhaustive-deps
  startHdHlsRef.current = startHdHls

  useEffect(() => {
    if (isLive) return
    if (hdHlsRef.current) { hdHlsRef.current.destroy(); hdHlsRef.current = null }
    if (!isVideoOnly || !selectedFormat) return
    const itag = String(selectedFormat.itag)
    const settings = getPlaybackSettings()
    const resumePos = settings.resumePlayback ? (getPosition(videoId) ?? 0) : 0
    let cancelled = false
    afterPendingStop(videoId, itag).then(() => { if (!cancelled) startHdHls(resumePos, settings.autoplay) })
    return () => {
      cancelled = true
      if (hdHlsRef.current) { hdHlsRef.current.destroy(); hdHlsRef.current = null }
      stopHlsSession(videoId, itag)
    }
  }, [isVideoOnly, selectedFormat?.itag, videoId]) // eslint-disable-line react-hooks/exhaustive-deps

  const resetHideTimer = useCallback(() => {
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current)
    setShowControls(true)
    hideControlsTimer.current = setTimeout(() => { if (playing) setShowControls(false) }, 3000)
  }, [playing])

  useEffect(() => { return () => { if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current) } }, [])

  useEffect(() => { setIsMobile('ontouchstart' in window || navigator.maxTouchPoints > 0) }, [])

  useEffect(() => {
    function onFsChange() {
      const isFs = !!(document.fullscreenElement || (document as { webkitFullscreenElement?: Element }).webkitFullscreenElement)
      setFullscreen(isFs)
    }
    document.addEventListener('fullscreenchange', onFsChange)
    document.addEventListener('webkitfullscreenchange', onFsChange)
    const video = videoRef.current
    function onIosBegin() { setFullscreen(true) }
    function onIosEnd() { setFullscreen(false) }
    video?.addEventListener('webkitbeginfullscreen', onIosBegin)
    video?.addEventListener('webkitendfullscreen', onIosEnd)
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange)
      document.removeEventListener('webkitfullscreenchange', onFsChange)
      video?.removeEventListener('webkitbeginfullscreen', onIosBegin)
      video?.removeEventListener('webkitendfullscreen', onIosEnd)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isMobile) document.body.style.overflow = fullscreen ? 'hidden' : ''
    return () => { if (isMobile) document.body.style.overflow = '' }
  }, [fullscreen, isMobile])

  useEffect(() => {
    function handleKey(e: globalThis.KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const video = videoRef.current
      if (!video) return
      switch (e.key) {
        case ' ': case 'k': e.preventDefault(); togglePlay(); break
        case 'f': e.preventDefault(); toggleFullscreen(); break
        case 'ArrowRight': e.preventDefault(); video.currentTime = Math.min(video.duration, video.currentTime + 5); break
        case 'ArrowLeft': e.preventDefault(); video.currentTime = Math.max(0, video.currentTime - 5); break
        case 'ArrowUp': e.preventDefault(); applyVolume(stepVolume(video.volume, 1)); break
        case 'ArrowDown': e.preventDefault(); applyVolume(stepVolume(video.volume, -1)); break
        case 'm': e.preventDefault(); toggleMute(); break
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  const safePlay = (el: HTMLVideoElement | HTMLAudioElement | null) => {
    el?.play().catch((e: unknown) => {
      if (el === videoRef.current && e instanceof DOMException && e.name === 'NotAllowedError') {
        setAutoplayBlocked(true)
        setLoading(false)
      }
    })
  }

  function togglePlay() {
    const video = videoRef.current
    if (!video) return
    if (video.paused) { safePlay(video); safePlay(audioRef.current) }
    else { video.pause(); audioRef.current?.pause() }
    resetHideTimer()
  }

  function toggleMute() {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    if (audioRef.current) audioRef.current.muted = video.muted
    setMuted(video.muted)
  }

  async function toggleFullscreen() {
    const container = containerRef.current
    const video = videoRef.current
    if (!container) return
    type DocExt = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void }
    type VidExt = HTMLVideoElement & { webkitEnterFullscreen?: () => void; webkitExitFullscreen?: () => void }
    const doc = document as DocExt
    const vid = video as VidExt | null
    const isCurrentlyFullscreen = !!(document.fullscreenElement || doc.webkitFullscreenElement || fullscreen)
    if (isCurrentlyFullscreen) {
      setFullscreen(false)
      if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen().catch(() => {})
      else if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) doc.webkitExitFullscreen()
      else vid?.webkitExitFullscreen?.()
      return
    }
    if (container.requestFullscreen && document.fullscreenEnabled) {
      try { await container.requestFullscreen(); return } catch { /* fall through */ }
    }
    if (vid?.webkitEnterFullscreen) { vid.webkitEnterFullscreen(); return }
    setFullscreen(true)
  }

  function handleTimeUpdate() {
    const video = videoRef.current
    if (!video) return
    const absoluteTime = hlsStartOffsetRef.current + video.currentTime
    setCurrentTime(absoluteTime)
    if (video.buffered.length > 0) setBuffered(hlsStartOffsetRef.current + video.buffered.end(video.buffered.length - 1))
    const audio = audioRef.current
    if (audio && !audio.paused && Math.abs(audio.currentTime - absoluteTime) > 0.3) audio.currentTime = absoluteTime
    handleSponsorSegments(video, absoluteTime)
    const now = Date.now()
    if (now - lastSessionUpdate.current > 1000) {
      lastSessionUpdate.current = now
      updateMediaSession(mediaSessionId.current, !video.paused, {
        duration: effectiveDurationRef.current || video.duration,
        position: absoluteTime,
        playbackRate: video.playbackRate,
      })
    }
  }

  /** Seek to an absolute time (HD formats restart their HLS session there). */
  function seekToTime(time: number) {
    const video = videoRef.current
    if (!video) return
    setCurrentTime(time)
    if (isVideoOnly) {
      startHdHls(time, !video.paused)
    } else {
      video.currentTime = time
      if (audioRef.current) audioRef.current.currentTime = time
    }
  }

  function handleSponsorSegments(video: HTMLVideoElement, time: number) {
    if (!ext.sponsorBlock || segments.length === 0) return
    if (segmentMuted.current !== null) {
      const seg = segments[segmentMuted.current]
      if (time < seg.start || time >= seg.end) { video.muted = false; segmentMuted.current = null }
    }
    if (video.paused || video.seeking) return
    const hit = activeSegment(segments, time, ext.sponsorCategories, handledSegments.current)
    if (!hit) return
    handledSegments.current.add(hit.index)
    if (hit.segment.actionType === 'mute') {
      video.muted = true
      segmentMuted.current = hit.index
      return
    }
    if (skipNoticeTimer.current) clearTimeout(skipNoticeTimer.current)
    setSkipNotice({ category: hit.segment.category, start: hit.segment.start })
    skipNoticeTimer.current = setTimeout(() => setSkipNotice(null), 6000)
    const dur = effectiveDurationRef.current || video.duration || 0
    if (dur > 0 && hit.segment.end >= dur - 1) {
      // The segment runs to the end (outro, end cards): move on like at the end
      video.pause()
      onEnded?.()
      return
    }
    seekToTime(hit.segment.end)
  }

  function undoSkip() {
    if (!skipNotice) return
    seekToTime(skipNotice.start)
    setSkipNotice(null)
  }

  function showVolumeHud(v: number) {
    // Slider position, not the raw level (they differ with the progressive curve)
    setVolumeHud(Math.round(volumeToSlider(v) * 100))
    if (volumeHudTimer.current) clearTimeout(volumeHudTimer.current)
    volumeHudTimer.current = setTimeout(() => setVolumeHud(null), 900)
  }

  /** Volume from the wheel or the keyboard: saved, unmutes, shows the level. */
  function applyVolume(v: number) {
    handleVolumeChange({ target: { value: String(v) } } as React.ChangeEvent<HTMLInputElement>)
    showVolumeHud(v)
  }

  async function togglePictureInPicture() {
    const video = videoRef.current
    if (!video) return
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else await video.requestPictureInPicture()
    } catch { /* refused (e.g. no video frame yet) */ }
  }

  function claimSession() {
    claimMediaSession(mediaSessionId.current, {
      title,
      artist: artist ?? '',
      artwork: artwork ? [{ src: artwork, sizes: '480x360', type: 'image/jpeg' }] : [],
    }, {
      play: () => { const v = videoRef.current; if (v?.paused) togglePlay() },
      pause: () => { const v = videoRef.current; if (v && !v.paused) togglePlay() },
      seekbackward: () => { const v = videoRef.current; if (v) seekToTime(Math.max(0, hlsStartOffsetRef.current + v.currentTime - 10)) },
      seekforward: () => { const v = videoRef.current; if (v) seekToTime(hlsStartOffsetRef.current + v.currentTime + 10) },
      seekto: details => { if (details.seekTime !== undefined) seekToTime(details.seekTime) },
      previoustrack: onPrev && hasPrev ? () => onPrev() : null,
      nexttrack: onNext && hasNext ? () => onNext() : null,
    })
  }

  function handleLoadedMetadata() {
    const video = videoRef.current
    if (!video) return
    const settings = getPlaybackSettings()
    const dur = (isVideoOnly && knownDuration)
      ? knownDuration
      : (isFinite(video.duration) && video.duration > 0 ? video.duration : (knownDuration ?? 0))
    setDuration(dur)
    setLoading(false)
    video.volume = settings.defaultVolume
    video.playbackRate = settings.defaultSpeed
    setVolume(settings.defaultVolume)
    setSpeed(settings.defaultSpeed)
    if (settings.resumePlayback && !isVideoOnly) {
      const pos = getPosition(videoId)
      const dur = effectiveDurationRef.current || video.duration || 0
      if (pos && pos > 0 && dur > 0 && pos < dur * 0.95) {
        video.currentTime = pos
        if (audioRef.current) audioRef.current.currentTime = pos
      }
    }
  }

  function handleVolumeChange(e: ChangeEvent<HTMLInputElement>) {
    const video = videoRef.current
    if (!video) return
    const vol = parseFloat(e.target.value)
    video.volume = vol
    if (audioRef.current) audioRef.current.volume = vol
    setVolume(vol)
    setPlaybackSettings({ defaultVolume: vol })
    if (vol === 0) { video.muted = true; if (audioRef.current) audioRef.current.muted = true; setMuted(true) }
    else if (muted) { video.muted = false; if (audioRef.current) audioRef.current.muted = false; setMuted(false) }
  }

  function selectQuality(fmt: VideoFormat) {
    const video = videoRef.current
    const wasPlaying = video && !video.paused
    const savedTime = video ? video.currentTime : 0
    setSelectedFormat(fmt)
    setShowQualityMenu(false)
    setLoading(true)
    setError(null)
    setTimeout(() => {
      if (video) {
        video.currentTime = savedTime
        if (audioRef.current) audioRef.current.currentTime = savedTime
        if (wasPlaying) { safePlay(video); safePlay(audioRef.current) }
      }
    }, 300)
  }

  function handleVideoError() {
    const video = videoRef.current
    if (video?.error?.code === 1) return
    // A pre-muxed format listed by YouTube.js may be gone server-side:
    // switch to the matching adaptive (HLS) stream before giving up.
    if (selectedFormat?.hasAudio) {
      const fallback = adaptiveFallback(formats, selectedFormat)
      if (fallback) {
        setSelectedFormat(fallback)
        setError(null)
        setLoading(true)
        return
      }
    }
    setError('Failed to load video. Try a different quality.')
    setLoading(false)
  }

  // Seek bar (pointer-based)
  function getSeekRatio(clientX: number): number {
    const bar = seekBarRef.current
    if (!bar) return 0
    const { left, width } = bar.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - left) / width))
  }

  function seekToRatio(ratio: number) {
    const video = videoRef.current
    if (!video) return
    seekToTime(ratio * (effectiveDurationRef.current || video.duration))
  }

  function onSeekPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    seekDragging.current = true
    const ratio = getSeekRatio(e.clientX)
    setScrubRatio(ratio)
    if (!isVideoOnly) seekToRatio(ratio)
  }

  function onSeekPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!seekDragging.current) return
    const ratio = getSeekRatio(e.clientX)
    setScrubRatio(ratio)
    if (!isVideoOnly) seekToRatio(ratio)
  }

  function onSeekPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    seekDragging.current = false
    const ratio = getSeekRatio(e.clientX)
    setScrubRatio(null)
    seekToRatio(ratio)
  }

  const displayRatio = scrubRatio !== null ? scrubRatio : (duration > 0 ? currentTime / duration : 0)
  const displayProgress = displayRatio * 100
  const bufferedProgress = duration > 0 ? (buffered / duration) * 100 : 0
  const displayTimeVal = scrubRatio !== null ? scrubRatio * duration : currentTime
  // Preview follows the pointer, or the finger while scrubbing on touch screens
  const previewRatio = scrubRatio ?? hoverRatio
  const hoverTimeVal = previewRatio !== null ? previewRatio * duration : 0
  const anyMenuOpen = showSpeedMenu || showQualityMenu || showSubtitleMenu || showAudioMenu
  const previewTile = storyboard && ext.seekPreview && previewRatio !== null && duration > 0
    ? storyboardTile(storyboard, hoverTimeVal, duration, 176)
    : null
  const visibleSegments = ext.sponsorBlock && duration > 0
    ? segments.filter(seg => seg.actionType !== 'poi' && ext.sponsorCategories[seg.category as SponsorCategory])
    : []

  useWheelVolume(volumeGroupRef, () => videoRef.current?.volume ?? volume, applyVolume)
  // Fullscreen: nothing to scroll, the wheel works anywhere on the video
  useWheelVolume(containerRef, () => videoRef.current?.volume ?? volume, applyVolume, fullscreen)

  // Current chapter at hover/current time
  const hoverChapter = chapters.length > 0 && duration > 0
    ? [...chapters].reverse().find(c => c.time <= hoverTimeVal)
    : null

  return (
    <div
      ref={containerRef}
      className={`relative bg-black rounded-2xl overflow-hidden select-none ${
        fullscreen ? 'fixed inset-0 z-[100] rounded-none' : 'w-full aspect-video'
      }`}
      onMouseMove={resetHideTimer}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => { if (playing && !anyMenuOpen) setShowControls(false) }}
      onTouchStart={() => {
        if (!showControls) { justShowedControlsRef.current = true; resetHideTimer() }
      }}
      onClick={() => {
        if (justShowedControlsRef.current) { justShowedControlsRef.current = false; return }
        if (anyMenuOpen) { setShowSpeedMenu(false); setShowQualityMenu(false); setShowSubtitleMenu(false); setShowAudioMenu(false); return }
        // Touch: a tap shows/hides the controls (pausing is the play button's job)
        if (isMobile) { setShowControls(v => !v); return }
        togglePlay()
      }}
      onDoubleClick={() => { if (!isMobile) toggleFullscreen() }}
    >
      {/* Hidden audio — video-only formats (unused: HLS stream already muxes audio via ffmpeg) */}
      {audioSrc && !isVideoOnly && (
        <audio ref={audioRef} src={audioSrc} preload="auto" style={{ display: 'none' }} />
      )}

      <video
        ref={videoRef}
        src={isLive || isVideoOnly || !selectedFormat ? undefined : streamUrl}
        className="w-full h-full object-contain"
        title={title}
        autoPlay={getPlaybackSettings().autoplay}
        playsInline
        preload="auto"
        // CORS-mode requests (the API allows them) let the equalizer read the sound
        crossOrigin="anonymous"
        onPlay={() => {
          setPlaying(true); setAutoplayBlocked(false); safePlay(audioRef.current)
          claimSession()
          if (needsAudioGraph(ext)) void attachAudioEffects(videoRef.current)
        }}
        onPause={() => { setPlaying(false); audioRef.current?.pause(); updateMediaSession(mediaSessionId.current, false) }}
        onSeeked={() => { if (audioRef.current && videoRef.current) audioRef.current.currentTime = hlsStartOffsetRef.current + videoRef.current.currentTime }}
        onTimeUpdate={handleTimeUpdate}
        onDurationChange={() => {
          const v = videoRef.current
          if (!v) return
          if (isVideoOnly && knownDuration) setDuration(knownDuration)
          else if (knownDuration && knownDuration > 0) setDuration(knownDuration)
          else if (isFinite(v.duration) && v.duration > 0) setDuration(prev => Math.max(prev, v.duration))
        }}
        onLoadedMetadata={handleLoadedMetadata}
        onWaiting={() => { setLoading(true); audioRef.current?.pause() }}
        onCanPlay={() => { setLoading(false); if (videoRef.current && !videoRef.current.paused) safePlay(audioRef.current) }}
        loop={getPlaybackSettings().loop}
        onEnded={() => { if (getPlaybackSettings().loop) return; setPlaying(false); audioRef.current?.pause(); onEnded?.() }}
        onError={handleVideoError}
        onVolumeChange={() => {
          const v = videoRef.current
          if (v) {
            setVolume(v.volume); setMuted(v.muted)
            if (audioRef.current) { audioRef.current.volume = v.volume; audioRef.current.muted = v.muted }
          }
        }}
      >
      </video>

      {/* Loading spinner */}
      {loading && !error && !autoplayBlocked && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-12 h-12 border-[3px] border-white/15 border-t-red-500 rounded-full animate-spin" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-white text-center px-4">
          <p className="text-base font-medium mb-2">{t('error_playback')}</p>
          <p className="text-sm text-white/60 mb-4">{error}</p>
          <button
            onClick={e => { e.stopPropagation(); setError(null); setLoading(true); videoRef.current?.load() }}
            className="btn-accent h-9"
          >
            {t('retry')}
          </button>
        </div>
      )}

      {/* Subtitle overlay */}
      {activeCue && !error && (
        <div className="absolute bottom-20 left-0 right-0 flex justify-center pointer-events-none z-20 px-6">
          <div className="bg-black/75 backdrop-blur-sm text-white text-sm sm:text-base px-4 py-2 rounded-xl text-center max-w-[85%] leading-snug">
            {activeCue.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        </div>
      )}

      {/* Controls overlay */}
      {!error && (
        <div
          className={`absolute inset-0 flex flex-col justify-between transition-opacity duration-200 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        >
          {/* Top: gradient + title */}
          <div className="relative pointer-events-none">
            <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/75 to-transparent" />
            <p className="relative text-center text-white font-bold text-sm pt-4 drop-shadow-lg px-10 truncate">
              {title}
            </p>
          </div>

          {/* Bottom zone */}
          <div className="relative" onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
            {/* Bottom gradient */}
            <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/90 to-transparent pointer-events-none" />

            {/* Floating panels */}
            <div className="absolute bottom-full right-0 mb-2 px-4 flex flex-col items-end gap-2 z-50">
              {showSpeedMenu && (
                <Panel title="Vitesse" icon={<span className="text-xs font-bold">{speed}×</span>}>
                  {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(s => (
                    <PanelItem
                      key={s}
                      label={s === 1 ? '1× (normal)' : `${s}×`}
                      active={speed === s}
                      onClick={() => {
                        const video = videoRef.current
                        if (video) video.playbackRate = s
                        if (audioRef.current) audioRef.current.playbackRate = s
                        setSpeed(s)
                        setShowSpeedMenu(false)
                      }}
                    />
                  ))}
                </Panel>
              )}
              {showQualityMenu && allVideoFormats.length > 0 && (
                <Panel title="Qualité" icon={<Settings className="w-4 h-4" />}>
                  {allVideoFormats.map(fmt => (
                    <PanelItem
                      key={fmt.itag}
                      label={fmt.quality || 'Auto'}
                      sublabel={fmt.ext?.toUpperCase()}
                      active={selectedFormat?.itag === fmt.itag}
                      onClick={() => selectQuality(fmt)}
                    />
                  ))}
                </Panel>
              )}
              {showAudioMenu && audioTracks.length > 1 && (
                <Panel title={t('player_audio_language')} icon={<Languages className="w-4 h-4" />}>
                  {audioTracks.map(track => (
                    <PanelItem
                      key={track.lang}
                      label={languageName(track)}
                      sublabel={track.original ? t('player_audio_original') : undefined}
                      active={(audioLang ?? originalLang) === track.lang}
                      onClick={() => selectAudioLanguage(track.original ? null : track.lang)}
                    />
                  ))}
                </Panel>
              )}
              {showSubtitleMenu && (
                <Panel title="Sous-titres" icon={<span className="text-[10px] font-bold">CC</span>}>
                  <PanelItem
                    label={t('settings_playback_subtitle_off')}
                    active={selectedSubtitle === 'off'}
                    onClick={() => { setSelectedSubtitle('off'); setShowSubtitleMenu(false) }}
                  />
                  {subtitleTracks.map(track => (
                    <PanelItem
                      key={track.lang}
                      label={track.label}
                      sublabel={track.auto ? 'auto' : undefined}
                      active={selectedSubtitle === track.lang}
                      onClick={() => { setSelectedSubtitle(track.lang); setShowSubtitleMenu(false) }}
                    />
                  ))}
                  {subtitleTracks.length === 0 && (
                    <p className="px-4 py-3 text-xs text-white/40">Aucun sous-titre disponible</p>
                  )}
                </Panel>
              )}
            </div>

            {/* Controls bar */}
            <div className="relative px-4 pb-4 pt-2 space-y-2 pointer-events-auto">
              {/* Seek row */}
              {!isLive ? (
                <div className="flex items-center gap-2.5">
                  <span className="text-white text-xs tabular-nums shrink-0 w-11 text-right">
                    {formatDuration(displayTimeVal)}
                  </span>
                  <div
                    ref={seekBarRef}
                    className="group/seek relative flex-1 h-1 hover:h-1.5 transition-[height] duration-150 cursor-pointer"
                    style={{ touchAction: 'none' }}
                    onPointerDown={onSeekPointerDown}
                    onPointerMove={onSeekPointerMove}
                    onPointerUp={onSeekPointerUp}
                    onMouseMove={e => setHoverRatio(getSeekRatio(e.clientX))}
                    onMouseLeave={() => setHoverRatio(null)}
                  >
                    {/* Extended hit area */}
                    <div className="absolute inset-x-0 -top-3 -bottom-3" />
                    {/* Track */}
                    <div className="absolute inset-0 bg-white/20 rounded-full" />
                    {/* Buffer */}
                    <div className="absolute inset-y-0 left-0 bg-white/30 rounded-full" style={{ width: `${bufferedProgress}%` }} />
                    {/* Played */}
                    <div className="absolute inset-y-0 left-0 bg-accent-gradient rounded-full shadow-[0_0_12px_rgb(var(--yt-red)/0.6)]" style={{ width: `${displayProgress}%` }} />
                    {/* SponsorBlock segments */}
                    {visibleSegments.map((seg, i) => (
                      <div
                        key={i}
                        className="absolute inset-y-0 pointer-events-none opacity-90"
                        style={{
                          left: `${(seg.start / duration) * 100}%`,
                          width: `${Math.max(0.4, ((seg.end - seg.start) / duration) * 100)}%`,
                          background: SPONSOR_COLORS[seg.category as SponsorCategory],
                        }}
                      />
                    ))}
                    {/* Chapter markers */}
                    {chapters.map((ch, i) => (
                      <div
                        key={i}
                        className="absolute top-1/2 -translate-y-1/2 w-0.5 h-3 bg-white/50 pointer-events-none z-10"
                        style={{ left: `${(ch.time / duration) * 100}%` }}
                      />
                    ))}
                    {/* Thumb */}
                    <div
                      className="absolute w-3.5 h-3.5 bg-white rounded-full top-1/2 -translate-y-1/2 shadow-lg ring-4 ring-red-500/35 scale-0 group-hover/seek:scale-100 transition-transform"
                      style={{ left: `calc(${displayProgress}% - 6px)` }}
                    />
                    {/* Hover time tooltip */}
                    {previewRatio !== null && duration > 0 && (
                      <div
                        className="absolute bottom-full mb-3 pointer-events-none -translate-x-1/2 flex flex-col items-center gap-1 z-20"
                        // Kept inside the player near both ends of the bar
                        style={{ left: previewTile ? `clamp(${previewTile.width / 2}px, ${previewRatio * 100}%, calc(100% - ${previewTile.width / 2}px))` : `${previewRatio * 100}%` }}
                      >
                        {previewTile && (
                          <div className="rounded-lg overflow-hidden ring-1 ring-white/25 shadow-elevated bg-black bg-no-repeat" style={previewTile.style} />
                        )}
                        {hoverChapter && (
                          <div className="bg-black/75 backdrop-blur-md text-white/80 text-[10px] px-2 py-0.5 rounded-md whitespace-nowrap max-w-[160px] truncate">
                            {hoverChapter.title}
                          </div>
                        )}
                        <div className="bg-black/75 backdrop-blur-md border border-white/10 text-white text-xs font-semibold px-2 py-1 rounded-lg tabular-nums whitespace-nowrap">
                          {formatDuration(hoverTimeVal)}
                        </div>
                      </div>
                    )}
                  </div>
                  <span className="text-white/40 text-xs tabular-nums shrink-0 w-11">
                    {duration > 0 ? formatDuration(duration) : ''}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-white text-xs font-medium">LIVE</span>
                </div>
              )}

              {/* Button row */}
              <div className="flex items-center justify-between">
                {/* Left */}
                <div className="flex items-center gap-0.5">
                  {onPrev && (
                    <button
                      onClick={e => { e.stopPropagation(); onPrev() }}
                      disabled={!hasPrev}
                      className={`w-10 h-10 flex items-center justify-center rounded-full transition-all ${hasPrev ? 'text-white hover:bg-white/10 active:scale-90' : 'text-white/25 cursor-not-allowed'}`}
                    >
                      <SkipBack className="w-5 h-5 fill-current" />
                    </button>
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); togglePlay() }}
                    className="w-10 h-10 flex items-center justify-center rounded-full text-white hover:bg-white/10 transition-all active:scale-90"
                  >
                    {playing
                      ? <Pause className="w-6 h-6 fill-current" />
                      : <Play className="w-6 h-6 fill-current translate-x-0.5" />}
                  </button>
                  {onNext && (
                    <button
                      onClick={e => { e.stopPropagation(); onNext() }}
                      disabled={!hasNext}
                      className={`w-10 h-10 flex items-center justify-center rounded-full transition-all ${hasNext ? 'text-white hover:bg-white/10 active:scale-90' : 'text-white/25 cursor-not-allowed'}`}
                    >
                      <SkipForward className="w-5 h-5 fill-current" />
                    </button>
                  )}
                  {!isLive && (
                    <>
                      <button
                        onClick={e => { e.stopPropagation(); const v = videoRef.current; if (v) v.currentTime = Math.max(0, v.currentTime - 10) }}
                        className="w-10 h-10 flex items-center justify-center rounded-full text-white hover:bg-white/10 transition-all active:scale-90"
                        title="Reculer 10s"
                      >
                        <RotateCcw className="w-5 h-5" />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); const v = videoRef.current; if (v) v.currentTime = Math.min(v.duration || 0, v.currentTime + 10) }}
                        className="w-10 h-10 flex items-center justify-center rounded-full text-white hover:bg-white/10 transition-all active:scale-90"
                        title="Avancer 10s"
                      >
                        <RotateCw className="w-5 h-5" />
                      </button>
                    </>
                  )}
                  <div ref={volumeGroupRef} className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={toggleMute}
                      className="w-10 h-10 flex items-center justify-center rounded-full text-white hover:bg-white/10 transition-all active:scale-90"
                    >
                      {muted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                    </button>
                    {(!isMobile || fullscreen) && (
                      <VolumeSlider
                        volume={volume}
                        muted={muted}
                        onChange={v => handleVolumeChange({ target: { value: String(v) } } as React.ChangeEvent<HTMLInputElement>)}
                        className="hidden sm:flex w-16"
                      />
                    )}
                  </div>
                </div>

                {/* Right */}
                <div className="flex items-center gap-0.5">
                  {!isLive && (!isMobile || fullscreen) && (
                    <button
                      onClick={e => { e.stopPropagation(); setShowSpeedMenu(v => !v); setShowQualityMenu(false); setShowSubtitleMenu(false); setShowAudioMenu(false) }}
                      className={`w-10 h-10 flex items-center justify-center rounded-full transition-colors text-xs font-bold ${showSpeedMenu ? 'bg-accent-gradient text-white shadow-glow' : 'text-white/85 hover:text-white hover:bg-white/10'}`}
                      title="Vitesse"
                    >
                      {speed === 1 ? '1×' : `${speed}×`}
                    </button>
                  )}
                  {!isLive && isVideoOnly && audioTracks.length > 1 && (!isMobile || fullscreen) && (
                    <button
                      onClick={e => { e.stopPropagation(); setShowAudioMenu(v => !v); setShowSpeedMenu(false); setShowQualityMenu(false); setShowSubtitleMenu(false) }}
                      className={`w-10 h-10 flex items-center justify-center rounded-full transition-colors ${showAudioMenu || audioLang ? 'bg-accent-gradient text-white shadow-glow' : 'text-white/85 hover:text-white hover:bg-white/10'}`}
                      title={t('player_audio_language')}
                    >
                      <Languages className="w-5 h-5" />
                    </button>
                  )}
                  {!isLive && (!isMobile || fullscreen) && (
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        if (subtitleTracks.length === 0) {
                          getSubtitles(videoId).then(tracks => { setSubtitleTracks(tracks); setShowSubtitleMenu(true) })
                        } else {
                          setShowSubtitleMenu(v => !v)
                        }
                        setShowSpeedMenu(false); setShowQualityMenu(false); setShowAudioMenu(false)
                      }}
                      className={`w-10 h-10 flex items-center justify-center rounded-full transition-colors ${showSubtitleMenu || selectedSubtitle !== 'off' ? 'bg-accent-gradient text-white shadow-glow' : 'text-white/85 hover:text-white hover:bg-white/10'}`}
                      title="Sous-titres"
                    >
                      <span className="text-xs font-bold leading-none">CC</span>
                    </button>
                  )}
                  {!isLive && allVideoFormats.length > 0 && (!isMobile || fullscreen) && (
                    <button
                      onClick={e => { e.stopPropagation(); setShowQualityMenu(v => !v); setShowSpeedMenu(false); setShowSubtitleMenu(false); setShowAudioMenu(false) }}
                      className={`w-10 h-10 flex items-center justify-center rounded-full transition-colors ${showQualityMenu ? 'bg-accent-gradient text-white shadow-glow' : 'text-white/85 hover:text-white hover:bg-white/10'}`}
                      title="Qualité"
                    >
                      <Settings className="w-5 h-5" />
                    </button>
                  )}
                  {pipSupported && !isMobile && (
                    <button
                      onClick={e => { e.stopPropagation(); void togglePictureInPicture() }}
                      className="w-10 h-10 flex items-center justify-center rounded-full text-white/85 hover:text-white hover:bg-white/10 transition-all active:scale-90"
                      title={t('player_pip')}
                    >
                      <PictureInPicture2 className="w-5 h-5" />
                    </button>
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); toggleFullscreen() }}
                    className="w-10 h-10 flex items-center justify-center rounded-full text-white/85 hover:text-white hover:bg-white/10 transition-all active:scale-90"
                  >
                    {fullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Volume level while using the wheel or the arrow keys */}
      {volumeHud !== null && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-40 pointer-events-none glass-chip rounded-full px-4 py-1.5 text-white text-sm font-semibold tabular-nums animate-fade-in">
          {t('player_volume')} {volumeHud} %
        </div>
      )}

      {/* SponsorBlock: what was skipped, with a way back */}
      {skipNotice && (
        <div
          className="absolute left-4 bottom-24 z-40 flex items-center gap-2 bg-black/80 backdrop-blur-md border border-white/10 rounded-xl pl-3 pr-1.5 py-1.5 text-white text-xs shadow-elevated animate-fade-up"
          onClick={e => e.stopPropagation()}
          onDoubleClick={e => e.stopPropagation()}
        >
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: SPONSOR_COLORS[skipNotice.category as SponsorCategory] ?? '#fff' }} />
          <span>{t('sponsor_skipped').replace('{segment}', t(`sponsor_cat_${skipNotice.category}` as Parameters<typeof t>[0]))}</span>
          <button onClick={undoSkip} className="px-2 py-1 rounded-lg font-semibold text-white hover:bg-white/10">{t('sponsor_undo')}</button>
          <button onClick={() => setSkipNotice(null)} className="p-1 rounded-lg text-white/60 hover:text-white hover:bg-white/10" aria-label="OK">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Autoplay refused by the browser: a click is always allowed to start playback */}
      {autoplayBlocked && !playing && !error && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); togglePlay() }}
          className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/40 text-white animate-fade-in"
        >
          <span className="w-20 h-20 rounded-full bg-accent-gradient shadow-glow flex items-center justify-center animate-pulse-ring">
            <Play className="w-8 h-8 fill-white ml-1" />
          </span>
          <span className="text-sm font-semibold drop-shadow">{t('player_click_to_play')}</span>
        </button>
      )}

      {/* Big play overlay */}
      {!playing && !autoplayBlocked && showControls && !loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-20 h-20 glass-chip rounded-full flex items-center justify-center shadow-elevated">
            <Play className="w-8 h-8 text-white fill-white ml-1" />
          </div>
        </div>
      )}
    </div>
  )
}
