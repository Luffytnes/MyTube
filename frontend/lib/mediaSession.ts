'use client'

/** One Media Session for the whole tab (media keys, macOS Control Center,
 *  headset buttons, lock screen). The player that started playing last owns
 *  it; when it goes away the others are told so the music player can take
 *  the session back. */

type Handlers = Partial<Record<MediaSessionAction, MediaSessionActionHandler | null>>

const ACTIONS: MediaSessionAction[] = [
  'play', 'pause', 'stop', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack',
]
export const MEDIA_SESSION_RELEASED = 'mytube-media-session-released'

let owner: symbol | null = null

function supported(): boolean {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator
}

export function claimMediaSession(id: symbol, metadata: MediaMetadataInit, handlers: Handlers): void {
  if (!supported()) return
  owner = id
  try { navigator.mediaSession.metadata = new MediaMetadata(metadata) } catch { /* bad artwork URL */ }
  for (const action of ACTIONS) {
    try { navigator.mediaSession.setActionHandler(action, handlers[action] ?? null) } catch { /* action unsupported here */ }
  }
}

export function ownsMediaSession(id: symbol): boolean {
  return owner === id
}

export function updateMediaSession(id: symbol, playing: boolean, position?: { duration: number; position: number; playbackRate: number }): void {
  if (!supported() || owner !== id) return
  navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
  if (!position || !isFinite(position.duration) || position.duration <= 0) return
  try {
    navigator.mediaSession.setPositionState({
      duration: position.duration,
      position: Math.min(Math.max(0, position.position), position.duration),
      playbackRate: position.playbackRate || 1,
    })
  } catch { /* inconsistent values during a seek */ }
}

export function releaseMediaSession(id: symbol): void {
  if (!supported() || owner !== id) return
  owner = null
  navigator.mediaSession.metadata = null
  navigator.mediaSession.playbackState = 'none'
  for (const action of ACTIONS) {
    try { navigator.mediaSession.setActionHandler(action, null) } catch { /* unsupported */ }
  }
  window.dispatchEvent(new Event(MEDIA_SESSION_RELEASED))
}
