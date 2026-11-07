'use client'

import { useEffect, useState } from 'react'

/** Optional player features (Settings → Extensions). */

export const SPONSOR_CATEGORIES = [
  'sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'preview', 'filler', 'music_offtopic',
] as const
export type SponsorCategory = typeof SPONSOR_CATEGORIES[number]

// SponsorBlock's own colours, so segments look the same as in its extension
export const SPONSOR_COLORS: Record<SponsorCategory, string> = {
  sponsor: '#00d400',
  selfpromo: '#ffff00',
  interaction: '#cc00ff',
  intro: '#00ffff',
  outro: '#0202ed',
  preview: '#008fd6',
  filler: '#7300ff',
  music_offtopic: '#ff9900',
}

export const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const

export const EQ_PRESETS = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  treble: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  vocal: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  rock: [4, 3, 1, 0, -1, 0, 1, 3, 4, 4],
  electronic: [5, 4, 1, 0, -2, 1, 0, 2, 4, 5],
  acoustic: [3, 2, 1, 1, 2, 2, 3, 3, 2, 1],
} satisfies Record<string, number[]>
export type EqPreset = keyof typeof EQ_PRESETS

export interface ExtensionSettings {
  sponsorBlock: boolean
  sponsorCategories: Record<SponsorCategory, boolean>
  seekPreview: boolean
  crossfade: boolean
  crossfadeSeconds: number
  skipSilences: boolean
  equalizer: boolean
  eqGains: number[]
  normalize: boolean
  albumColors: boolean
  visualizer: boolean
  exponentialVolume: boolean
  wheelVolume: boolean
}

const DEFAULTS: ExtensionSettings = {
  sponsorBlock: true,
  sponsorCategories: {
    sponsor: true, selfpromo: true, interaction: true, intro: false,
    outro: false, preview: false, filler: false, music_offtopic: true,
  },
  seekPreview: true,
  crossfade: false,
  crossfadeSeconds: 6,
  skipSilences: false,
  equalizer: false,
  eqGains: [...EQ_PRESETS.flat],
  normalize: false,
  albumColors: true,
  visualizer: false,
  exponentialVolume: true,
  wheelVolume: true,
}

const KEY = 'mytube-extensions'
const EVENT = 'mytube-extensions-change'

let cached: ExtensionSettings | null = null

export function getExtensions(): ExtensionSettings {
  if (cached) return cached
  if (typeof window === 'undefined') return DEFAULTS
  let stored: Partial<ExtensionSettings> = {}
  try { stored = JSON.parse(localStorage.getItem(KEY) || '{}') } catch { /* corrupted: defaults */ }
  const gains = Array.isArray(stored.eqGains) && stored.eqGains.length === EQ_BANDS.length
    ? stored.eqGains.map(g => Math.max(-12, Math.min(12, Number(g) || 0)))
    : DEFAULTS.eqGains
  cached = {
    ...DEFAULTS,
    ...stored,
    sponsorCategories: { ...DEFAULTS.sponsorCategories, ...stored.sponsorCategories },
    eqGains: gains,
  }
  return cached
}

export function setExtensions(patch: Partial<ExtensionSettings>): ExtensionSettings {
  const next = { ...getExtensions(), ...patch }
  cached = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private mode: in memory only */ }
  window.dispatchEvent(new Event(EVENT))
  return next
}

export function onExtensionsChange(listener: () => void): () => void {
  // Another tab, or a restore from the server copy, wrote new settings
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) { cached = null; listener() } }
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useExtensions(): ExtensionSettings {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULTS)
  useEffect(() => {
    setSettings(getExtensions())
    return onExtensionsChange(() => setSettings(getExtensions()))
  }, [])
  return settings
}

/** Volume slider position (0..1) ↔ media volume. The cubic curve gives the
 *  quiet end of the slider far more room, like a hi-fi volume knob. */
export function sliderToVolume(position: number): number {
  return getExtensions().exponentialVolume ? position ** 3 : position
}

export function volumeToSlider(volume: number): number {
  return getExtensions().exponentialVolume ? Math.cbrt(volume) : volume
}

/** Next volume for a wheel or arrow-key step, moving the slider by 5 %. */
export function stepVolume(volume: number, direction: 1 | -1): number {
  const position = Math.max(0, Math.min(1, volumeToSlider(volume) + direction * 0.05))
  return Math.round(sliderToVolume(position) * 1000) / 1000
}
