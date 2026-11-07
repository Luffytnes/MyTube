'use client'

import { useRef } from 'react'
import { sliderToVolume, volumeToSlider } from '@/lib/extensions'

interface VolumeSliderProps {
  volume: number   // 0–1
  muted: boolean
  onChange: (v: number) => void
  className?: string
}

export default function VolumeSlider({ volume, muted, onChange, className = 'w-16' }: VolumeSliderProps) {
  const barRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const pct = (muted ? 0 : volumeToSlider(volume)) * 100

  /** Volume for a pointer position (the slider may follow a curve, see sliderToVolume) */
  function ratioFromX(clientX: number): number {
    const bar = barRef.current
    if (!bar) return volume
    const { left, width } = bar.getBoundingClientRect()
    return sliderToVolume(Math.max(0, Math.min(1, (clientX - left) / width)))
  }

  return (
    <div
      ref={barRef}
      className={`relative h-8 flex items-center cursor-pointer select-none ${className}`}
      style={{ touchAction: 'none' }}
      onClick={e => { e.stopPropagation(); onChange(ratioFromX(e.clientX)) }}
      onPointerDown={e => {
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        dragging.current = true
        onChange(ratioFromX(e.clientX))
      }}
      onPointerMove={e => { if (dragging.current) onChange(ratioFromX(e.clientX)) }}
      onPointerUp={() => { dragging.current = false }}
    >
      {/* Track (gray background) */}
      <div className="absolute inset-x-0 h-1 rounded-full bg-white/20">
        {/* Fill (white) */}
        <div className="h-full rounded-full bg-white/90" style={{ width: `${pct}%` }} />
      </div>
      {/* Thumb */}
      <div
        className="absolute w-2.5 h-2.5 rounded-full bg-white shadow pointer-events-none -translate-x-1/2"
        style={{ left: `${pct}%` }}
      />
    </div>
  )
}
