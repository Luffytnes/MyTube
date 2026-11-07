'use client'

import { useEffect, type RefObject } from 'react'
import { getExtensions, stepVolume } from '@/lib/extensions'

/** Mouse wheel over `ref` changes the volume (Settings → Extensions).
 *  A native listener: React's onWheel is passive and can't stop the page from
 *  scrolling at the same time. */
export function useWheelVolume(
  ref: RefObject<HTMLElement | null>,
  getVolume: () => number,
  setVolume: (volume: number) => void,
  enabled = true,
) {
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    function onWheel(e: WheelEvent) {
      if (!getExtensions().wheelVolume || e.deltaY === 0) return
      e.preventDefault()
      e.stopPropagation()
      setVolume(stepVolume(getVolume(), e.deltaY < 0 ? 1 : -1))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }) // eslint-disable-line react-hooks/exhaustive-deps
}
