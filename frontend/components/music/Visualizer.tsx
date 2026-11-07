'use client'

import { useEffect, useRef } from 'react'
import { getAnalyser } from '@/lib/audioEffects'

/** Frequency bars of what is playing (needs the audio effects chain). */
export default function Visualizer({ color, className = '' }: { color?: string | null; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const g = canvas.getContext('2d')
    if (!g) return
    let frame = 0
    let bins: Uint8Array<ArrayBuffer> | null = null
    const draw = () => {
      frame = requestAnimationFrame(draw)
      const { clientWidth: w, clientHeight: h } = canvas
      const dpr = window.devicePixelRatio || 1
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr }
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      const analyser = getAnalyser()
      if (!analyser) return
      if (!bins || bins.length !== analyser.frequencyBinCount) bins = new Uint8Array(analyser.frequencyBinCount)
      analyser.getByteFrequencyData(bins)
      const bars = Math.max(16, Math.floor(w / 7))
      const barWidth = w / bars
      g.fillStyle = color ? `rgb(${color})` : 'rgba(255,255,255,0.85)'
      for (let i = 0; i < bars; i++) {
        // Logarithmic spread: each bar covers more bins towards the treble
        const from = Math.floor(Math.pow(bins.length, i / bars)) - 1
        const to = Math.max(from + 1, Math.floor(Math.pow(bins.length, (i + 1) / bars)) - 1)
        let peak = 0
        for (let j = Math.max(0, from); j < to; j++) peak = Math.max(peak, bins[j])
        const barHeight = Math.max(2, (peak / 255) * h)
        g.globalAlpha = 0.45 + (peak / 255) * 0.55
        g.beginPath()
        g.roundRect(i * barWidth + 1, h - barHeight, Math.max(1, barWidth - 2), barHeight, 2)
        g.fill()
      }
      g.globalAlpha = 1
    }
    draw()
    return () => cancelAnimationFrame(frame)
  }, [color])

  return <canvas ref={canvasRef} className={`w-full ${className}`} aria-hidden="true" />
}
