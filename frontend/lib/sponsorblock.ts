'use client'

import { useEffect, useState } from 'react'
import type { SponsorCategory } from '@/lib/extensions'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export interface SponsorSegment {
  category: SponsorCategory | 'poi_highlight'
  actionType: 'skip' | 'mute' | 'poi'
  start: number
  end: number
}

const cache = new Map<string, Promise<SponsorSegment[]>>()

export function getSponsorSegments(videoId: string): Promise<SponsorSegment[]> {
  let pending = cache.get(videoId)
  if (!pending) {
    pending = fetch(`${API_BASE}/api/sponsorblock/${videoId}`)
      .then(r => (r.ok ? r.json() : { segments: [] }))
      .then((d: { segments?: SponsorSegment[] }) => d.segments ?? [])
      .catch(() => { cache.delete(videoId); return [] })
    cache.set(videoId, pending)
  }
  return pending
}

export function useSponsorSegments(videoId: string | null | undefined, enabled: boolean): SponsorSegment[] {
  const [segments, setSegments] = useState<SponsorSegment[]>([])
  useEffect(() => {
    setSegments([])
    if (!videoId || !enabled) return
    let cancelled = false
    getSponsorSegments(videoId).then(s => { if (!cancelled) setSegments(s) })
    return () => { cancelled = true }
  }, [videoId, enabled])
  return segments
}

/** Segment to act on at `time`: a skip or mute segment of an enabled category,
 *  not yet handled (or undone) during this playback. */
export function activeSegment(
  segments: SponsorSegment[],
  time: number,
  enabled: Record<string, boolean>,
  handled: Set<number>,
): { segment: SponsorSegment; index: number } | null {
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]
    if (s.actionType === 'poi' || !enabled[s.category] || handled.has(i)) continue
    // Within the segment, with a small margin so a skip landing on `end` stays out
    if (time >= s.start && time < s.end - 0.5) return { segment: s, index: i }
  }
  return null
}
