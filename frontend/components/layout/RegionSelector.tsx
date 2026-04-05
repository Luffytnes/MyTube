'use client'

import { useState, useRef, useEffect } from 'react'
import { useRegion, REGIONS } from '@/lib/regionContext'
import { ChevronDown } from 'lucide-react'

export default function RegionSelector() {
  const { region, setRegion } = useRegion()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-2.5 h-8 rounded-full bg-yt-secondary border border-yt-border text-yt-text-secondary hover:text-yt-text hover:bg-yt-hover transition-colors"
        title="Select region"
        aria-label="Select region"
      >
        <span className="text-base leading-none">{region.flag}</span>
        <span className="hidden sm:block text-xs font-medium">{region.code}</span>
        <ChevronDown className={`w-3 h-3 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 bg-yt-secondary border border-yt-border rounded-xl shadow-2xl py-1 z-50 w-56 max-h-80 overflow-y-auto">
          {REGIONS.map((r) => (
            <button
              key={r.code}
              onClick={() => { setRegion(r); setOpen(false) }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-yt-hover ${
                region.code === r.code ? 'text-yt-red font-medium' : 'text-yt-text'
              }`}
            >
              <span className="text-xl leading-none">{r.flag}</span>
              <div className="text-left flex-1">
                <div className="text-sm">{r.name}</div>
                <div className="text-xs text-yt-text-muted">{r.code}</div>
              </div>
              {region.code === r.code && <span className="text-yt-red text-sm">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
