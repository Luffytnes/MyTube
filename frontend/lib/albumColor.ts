'use client'

import { useEffect, useState } from 'react'
import { imageSrc } from '@/lib/thumbnails'

const cache = new Map<string, string | null>()

/** Dominant colour of a cover ("r g b", for rgb() / rgb(var())), or null.
 *  Colourful pixels count more than greys so a black-and-white border does
 *  not win over the artwork. */
function dominantColor(img: HTMLImageElement): string | null {
  const size = 24
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const g = canvas.getContext('2d', { willReadFrequently: true })
  if (!g) return null
  g.drawImage(img, 0, 0, size, size)
  const { data } = g.getImageData(0, 0, size, size)
  let r = 0, gr = 0, b = 0, total = 0
  for (let i = 0; i < data.length; i += 4) {
    const [pr, pg, pb] = [data[i], data[i + 1], data[i + 2]]
    const max = Math.max(pr, pg, pb), min = Math.min(pr, pg, pb)
    const weight = 1 + ((max - min) / 255) * 8 * (max > 40 ? 1 : 0.2)
    r += pr * weight; gr += pg * weight; b += pb * weight; total += weight
  }
  if (!total) return null
  let [cr, cg, cb] = [r / total, gr / total, b / total]
  // White text sits on the tint: bright covers (white, pastel) are toned down
  const luminance = (0.2126 * cr + 0.7152 * cg + 0.0722 * cb) / 255
  const scale = luminance > 0.45 ? 0.45 / luminance : luminance < 0.12 ? 1.6 : 1
  ;[cr, cg, cb] = [cr * scale, cg * scale, cb * scale]
  const clamp = (c: number) => Math.round(Math.max(0, Math.min(255, c)))
  return `${clamp(cr)} ${clamp(cg)} ${clamp(cb)}`
}

export function useAlbumColor(url: string | null | undefined, enabled = true): string | null {
  const [color, setColor] = useState<string | null>(null)
  useEffect(() => {
    const src = url ? imageSrc(url) : undefined
    if (!src || !enabled) { setColor(null); return }
    if (cache.has(src)) { setColor(cache.get(src) ?? null); return }
    let cancelled = false
    const img = new Image()
    // CORS: reading pixels of an image from the API is otherwise forbidden
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      let found: string | null = null
      try { found = dominantColor(img) } catch { /* tainted canvas */ }
      cache.set(src, found)
      if (!cancelled) setColor(found)
    }
    img.onerror = () => { cache.set(src, null); if (!cancelled) setColor(null) }
    img.src = src
    return () => { cancelled = true }
  }, [url, enabled])
  return color
}
