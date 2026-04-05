'use client'

import { useState, useRef, useEffect } from 'react'
import { Server, ChevronDown, Check, RefreshCw } from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface Instance {
  url: string
  healthy: boolean
  preferred: boolean
}

export default function InvidiousSelector() {
  const [open, setOpen] = useState(false)
  const [instances, setInstances] = useState<Instance[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  async function fetchInstances() {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/invidious/instances`)
      const data: Instance[] = await res.json()
      setInstances(data)
      const pref = data.find((i) => i.preferred)
      if (pref) setSelected(pref.url)
    } catch {}
    finally { setLoading(false) }
  }

  function handleOpen() {
    setOpen((v) => {
      if (!v) fetchInstances()
      return !v
    })
  }

  async function handleSelect(url: string) {
    const next = selected === url ? null : url
    setSelected(next)
    try {
      await fetch(`${API_BASE}/api/invidious/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: next ?? '' }),
      })
      setInstances((prev) => prev.map((i) => ({ ...i, preferred: i.url === next })))
    } catch {}
    setOpen(false)
  }

  const hostname = (url: string) => url.replace('https://', '')

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleOpen}
        title="Choisir une instance Invidious"
        className="flex items-center gap-1.5 px-2.5 h-8 rounded-full bg-yt-secondary border border-yt-border text-yt-text-secondary hover:text-yt-text hover:bg-yt-hover transition-colors"
      >
        <Server className="w-3.5 h-3.5" />
        <span className="hidden sm:block text-xs font-medium truncate max-w-[90px]">
          {selected ? hostname(selected) : 'Invidious'}
        </span>
        <ChevronDown className={`w-3 h-3 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 bg-yt-secondary border border-yt-border rounded-xl shadow-2xl z-50 w-80 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-yt-border/50">
            <span className="text-xs font-semibold text-yt-text-muted uppercase tracking-wide">Instance Invidious</span>
            <button
              onClick={fetchInstances}
              className="p-1 rounded-full hover:bg-yt-hover text-yt-text-muted hover:text-yt-text transition-colors"
              title="Rafraîchir"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {loading && instances.length === 0 ? (
            <div className="flex items-center justify-center py-8 gap-2 text-yt-text-muted text-sm">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Vérification...
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto py-1">
              {/* Auto option */}
              <button
                onClick={() => handleSelect('')}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-yt-hover transition-colors group"
              >
                <span className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
                <span className="flex-1 text-sm text-left text-yt-text">Automatique</span>
                <span className="text-xs text-yt-text-muted">meilleure disponible</span>
                {!selected && <Check className="w-3.5 h-3.5 text-yt-red flex-shrink-0" />}
              </button>

              <div className="border-t border-yt-border/30 my-1" />

              {instances.map((inst) => (
                <button
                  key={inst.url}
                  onClick={() => handleSelect(inst.url)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-yt-hover transition-colors group"
                >
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      inst.healthy ? 'bg-green-400' : 'bg-red-500'
                    }`}
                    title={inst.healthy ? 'Accessible' : 'Inaccessible'}
                  />
                  <span className={`flex-1 text-sm text-left truncate ${inst.healthy ? 'text-yt-text' : 'text-yt-text-muted'}`}>
                    {hostname(inst.url)}
                  </span>
                  {selected === inst.url && <Check className="w-3.5 h-3.5 text-yt-red flex-shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
