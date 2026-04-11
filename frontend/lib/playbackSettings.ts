const KEY = 'mytube-playback-settings'

export interface PlaybackSettings {
  historyEnabled: boolean
  searchHistoryEnabled: boolean
  defaultQuality: 'auto' | '1080p' | '720p' | '480p' | '360p' | '240p'
  autoplay: boolean
  defaultSpeed: number
  defaultVolume: number
  resumePlayback: boolean
}

const DEFAULTS: PlaybackSettings = {
  historyEnabled: true,
  searchHistoryEnabled: true,
  defaultQuality: 'auto',
  autoplay: true,
  defaultSpeed: 1,
  defaultVolume: 1,
  resumePlayback: false,
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
    return updated
  } catch {
    return getPlaybackSettings()
  }
}
