const KEY = 'mytube-playback-settings'

export interface PlaybackSettings {
  historyEnabled: boolean
  searchHistoryEnabled: boolean
  defaultQuality: 'auto' | '1080p' | '720p' | '480p' | '360p' | '240p'
  autoplay: boolean
  autoplayNext: boolean
  loop: boolean
  defaultSpeed: number
  defaultVolume: number
  resumePlayback: boolean
  subtitleLang: string
  gridDensity: 'compact' | 'normal' | 'comfortable'
  hideWatched: boolean
  historyTTL: number // days, 0 = forever
}

const DEFAULTS: PlaybackSettings = {
  historyEnabled: true,
  searchHistoryEnabled: true,
  defaultQuality: 'auto',
  autoplay: true,
  autoplayNext: true,
  loop: false,
  defaultSpeed: 1,
  defaultVolume: 1,
  resumePlayback: true,
  subtitleLang: 'off',
  gridDensity: 'normal',
  hideWatched: false,
  historyTTL: 0,
}

export function getPlaybackSettings(): PlaybackSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function setPlaybackSettings(settings: Partial<PlaybackSettings>): PlaybackSettings {
  try {
    const current = getPlaybackSettings()
    const updated = { ...current, ...settings }
    localStorage.setItem(KEY, JSON.stringify(updated))
    window.dispatchEvent(new CustomEvent('mytube-settings-change', { detail: updated }))
    return updated
  } catch {
    return getPlaybackSettings()
  }
}
