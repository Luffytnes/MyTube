'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Sun, Moon, Monitor, Upload, Wifi, WifiOff, AlertCircle, Loader2, Shield, RefreshCw, MapPin, Trash2, Check, Globe, Network, Play } from 'lucide-react'
import { useTheme, type ThemeMode } from '@/lib/themeContext'
import { useRegion, REGIONS } from '@/lib/regionContext'
import { getPlaybackSettings, setPlaybackSettings, type PlaybackSettings } from '@/lib/playbackSettings'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

type VpnStatus = 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'error'
type Tab = 'general' | 'playback' | 'wireproxy'

interface VpnState {
  status: VpnStatus
  conf_loaded: boolean
  conf_name: string | null
  error: string | null
}

interface IpInfo {
  ip: string
  city?: string
  country?: string
  org?: string
}

interface SettingsPanelProps {
  open: boolean
  onClose: () => void
}

export default function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const { mode, setMode } = useTheme()
  const { region, setRegion, t } = useRegion()
  const [tab, setTab] = useState<Tab>('general')
  const [pbSettings, setPbSettings] = useState<PlaybackSettings>(() => getPlaybackSettings())
  const [vpn, setVpn] = useState<VpnState>({ status: 'disconnected', conf_loaded: false, conf_name: null, error: null })
  const [vpnLoading, setVpnLoading] = useState(false)
  const [savedConfigs, setSavedConfigs] = useState<string[]>([])
  const [ipInfo, setIpInfo] = useState<IpInfo | null>(null)
  const [ipLoading, setIpLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  const fetchIpInfo = useCallback(async () => {
    setIpLoading(true)
    setIpInfo(null)
    try {
      const res = await fetch(`${API_BASE}/api/vpn/myip`)
      if (res.ok) setIpInfo(await res.json())
    } catch {}
    setIpLoading(false)
  }, [])

  const fetchConfigs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/vpn/configs`)
      if (res.ok) {
        const data = await res.json()
        setSavedConfigs(data.configs ?? [])
      }
    } catch {}
  }, [])

  function updatePbSetting<K extends keyof PlaybackSettings>(key: K, value: PlaybackSettings[K]) {
    const updated = setPlaybackSettings({ [key]: value })
    setPbSettings(updated)
  }

  const fetchVpnStatus = useCallback(async () => {
    setVpnLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/vpn/status`)
      if (res.ok) {
        const data = await res.json()
        setVpn({
          status: data.running ? 'connected' : 'disconnected',
          conf_loaded: data.conf_loaded,
          conf_name: data.conf_name ?? null,
          error: data.error ?? null,
        })
      }
    } catch {}
    setVpnLoading(false)
  }, [])

  // Refresh everything when panel opens
  useEffect(() => {
    if (!open) return
    fetchVpnStatus()
    fetchIpInfo()
    fetchConfigs()
  }, [open, fetchVpnStatus, fetchIpInfo, fetchConfigs])

  // Refresh VPN status every time the Wireproxy tab becomes active
  useEffect(() => {
    if (!open || tab !== 'wireproxy') return
    fetchVpnStatus()
    fetchConfigs()
  }, [tab, open, fetchVpnStatus, fetchConfigs])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open, onClose])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  async function handleUploadConf(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await fetch(`${API_BASE}/api/vpn/upload`, { method: 'POST', body: formData })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setVpn((prev) => ({ ...prev, conf_loaded: true, conf_name: data.conf_name ?? file.name, error: null }))
        if (data.configs) setSavedConfigs(data.configs)
      } else {
        setVpn((prev) => ({ ...prev, error: data.detail ?? t('settings_vpn_error') }))
      }
    } catch {
      setVpn((prev) => ({ ...prev, error: t('settings_vpn_error') }))
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSelectConf(name: string) {
    if (vpn.conf_name === name) return
    try {
      const res = await fetch(`${API_BASE}/api/vpn/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setVpn((prev) => ({ ...prev, conf_loaded: true, conf_name: name, error: null }))
      } else {
        setVpn((prev) => ({ ...prev, error: data.detail ?? t('settings_vpn_error') }))
        fetchVpnStatus() // resync in case of state mismatch
      }
    } catch {
      setVpn((prev) => ({ ...prev, error: t('settings_vpn_error') }))
    }
  }

  async function handleDeleteConf(name: string) {
    try {
      const res = await fetch(`${API_BASE}/api/vpn/configs/${encodeURIComponent(name)}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setSavedConfigs(data.configs ?? [])
        if (vpn.conf_name === name) {
          setVpn((prev) => ({ ...prev, conf_loaded: false, conf_name: null, error: null }))
        }
      } else {
        setVpn((prev) => ({ ...prev, error: data.detail ?? t('settings_vpn_error') }))
      }
    } catch {
      setVpn((prev) => ({ ...prev, error: t('settings_vpn_error') }))
    }
  }

  async function handleVpnToggle() {
    if (vpn.status === 'connected') {
      setVpn((prev) => ({ ...prev, status: 'disconnecting', error: null }))
      try {
        const res = await fetch(`${API_BASE}/api/vpn/stop`, { method: 'POST' })
        const data = await res.json().catch(() => ({}))
        setVpn((prev) => ({ ...prev, status: 'disconnected', error: data.error ?? null }))
        fetchIpInfo()
      } catch {
        setVpn((prev) => ({ ...prev, status: 'error', error: t('settings_vpn_error') }))
      }
    } else if (vpn.status === 'disconnected' && vpn.conf_loaded) {
      setVpn((prev) => ({ ...prev, status: 'connecting', error: null }))
      try {
        const res = await fetch(`${API_BASE}/api/vpn/start`, { method: 'POST' })
        const data = await res.json().catch(() => ({}))
        if (res.ok && data.running) {
          setVpn((prev) => ({ ...prev, status: 'connected', error: null }))
          fetchIpInfo()
        } else {
          setVpn((prev) => ({ ...prev, status: 'error', error: data.detail ?? data.error ?? t('settings_vpn_error') }))
        }
      } catch {
        setVpn((prev) => ({ ...prev, status: 'error', error: t('settings_vpn_error') }))
      }
    }
  }

  const vpnConnected = vpn.status === 'connected'
  const vpnBusy = vpn.status === 'connecting' || vpn.status === 'disconnecting'

  const TABS: { id: Tab; label: string; icon: React.ReactNode; badge?: React.ReactNode }[] = [
    {
      id: 'general',
      label: 'Général',
      icon: <Globe className="w-4 h-4" />,
    },
    {
      id: 'playback',
      label: t('settings_tab_playback'),
      icon: <Play className="w-4 h-4" />,
    },
    {
      id: 'wireproxy',
      label: 'Wireproxy',
      icon: <Network className="w-4 h-4" />,
      badge: vpnConnected ? (
        <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
      ) : (
        <span className="w-2 h-2 rounded-full bg-yt-text-muted/40 flex-shrink-0" />
      ),
    },
  ]

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" aria-hidden="true" />

      {/* Modal */}
      <div
        ref={modalRef}
        className="relative z-10 flex w-full max-w-2xl h-[560px] bg-yt-bg border border-yt-border rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Left tab bar */}
        <div className="w-44 flex-shrink-0 bg-yt-secondary border-r border-yt-border flex flex-col pt-4 pb-4">
          <p className="px-4 pb-3 text-xs font-semibold text-yt-text-muted uppercase tracking-widest">
            {t('settings_title')}
          </p>
          <nav className="flex flex-col gap-0.5 px-2">
            {TABS.map(({ id, label, icon, badge }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-left transition-colors ${
                  tab === id
                    ? 'bg-yt-hover text-yt-text'
                    : 'text-yt-text-secondary hover:bg-yt-hover hover:text-yt-text'
                }`}
              >
                <span className={tab === id ? 'text-yt-red' : 'text-yt-text-muted'}>{icon}</span>
                <span className="flex-1">{label}</span>
                {badge}
              </button>
            ))}
          </nav>
        </div>

        {/* Right content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-yt-border/50">
            <h2 className="text-yt-text font-semibold text-base">
              {tab === 'general' ? 'Général' : tab === 'playback' ? t('settings_tab_playback') : 'Wireproxy'}
            </h2>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-yt-hover text-yt-text-secondary hover:text-yt-text transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

            {/* ── GÉNÉRAL ── */}
            {tab === 'general' && (
              <>
                <section>
                  <p className="text-xs font-semibold text-yt-text-muted uppercase tracking-widest mb-3">{t('settings_appearance')}</p>
                  <div className="flex items-center gap-3">
                    {mode === 'light' ? <Sun className="w-4 h-4 text-yt-text-muted flex-shrink-0" />
                      : mode === 'dark' ? <Moon className="w-4 h-4 text-yt-text-muted flex-shrink-0" />
                      : <Monitor className="w-4 h-4 text-yt-text-muted flex-shrink-0" />}
                    <select
                      value={mode}
                      onChange={(e) => setMode(e.target.value as ThemeMode)}
                      className="flex-1 bg-yt-secondary border border-yt-border text-yt-text text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-yt-red cursor-pointer"
                    >
                      <option value="light">{t('theme_light')}</option>
                      <option value="dark">{t('theme_dark')}</option>
                      <option value="auto">{t('theme_auto')}</option>
                    </select>
                  </div>
                </section>

                <div className="border-t border-yt-border/40" />

                <section>
                  <p className="text-xs font-semibold text-yt-text-muted uppercase tracking-widest mb-3">{t('settings_language')}</p>
                  <select
                    value={region.code}
                    onChange={(e) => {
                      const r = REGIONS.find((r) => r.code === e.target.value)
                      if (r) setRegion(r)
                    }}
                    className="w-full bg-yt-secondary border border-yt-border text-yt-text text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-yt-red cursor-pointer"
                  >
                    {REGIONS.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.flag} {r.name} ({r.code})
                      </option>
                    ))}
                  </select>
                </section>

                <div className="border-t border-yt-border/40" />

                <section>
                  <p className="text-xs font-semibold text-yt-text-muted uppercase tracking-widest mb-3">Historique</p>
                  <div className="space-y-2">
                    {([
                      { key: 'historyEnabled', label: t('settings_history_watch') },
                      { key: 'searchHistoryEnabled', label: t('settings_history_search') },
                    ] as { key: 'historyEnabled' | 'searchHistoryEnabled'; label: string }[]).map(({ key, label }) => (
                      <div key={key} className="flex items-center justify-between gap-3 py-1">
                        <span className="text-sm text-yt-text">{label}</span>
                        <button
                          onClick={() => updatePbSetting(key, !pbSettings[key])}
                          className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 overflow-hidden ${pbSettings[key] ? 'bg-yt-red' : 'bg-yt-border'}`}
                        >
                          <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${pbSettings[key] ? 'translate-x-4' : 'translate-x-0'}`} />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}

            {/* ── LECTURE ── */}
            {tab === 'playback' && (
              <div className="space-y-0">
                {/* Toggles */}
                {([
                  { key: 'autoplay' as const, label: t('settings_playback_autoplay') },
                  { key: 'resumePlayback' as const, label: t('settings_playback_resume') },
                ] ).map(({ key, label }) => (
                  <div key={key} className="flex items-center justify-between gap-3 py-2.5 border-b border-yt-border/40">
                    <span className="text-sm text-yt-text">{label}</span>
                    <button
                      onClick={() => updatePbSetting(key, !pbSettings[key])}
                      className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 overflow-hidden ${pbSettings[key] ? 'bg-yt-red' : 'bg-yt-border'}`}
                    >
                      <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${pbSettings[key] ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>
                ))}

                {/* Quality */}
                <div className="py-2.5 border-b border-yt-border/40">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-yt-text flex-shrink-0">{t('settings_playback_quality')}</span>
                    <select
                      value={pbSettings.defaultQuality}
                      onChange={(e) => updatePbSetting('defaultQuality', e.target.value as PlaybackSettings['defaultQuality'])}
                      className="bg-yt-secondary border border-yt-border text-yt-text text-sm rounded-lg px-2 py-1.5 focus:outline-none focus:border-yt-red cursor-pointer"
                    >
                      <option value="auto">{t('settings_quality_auto')}</option>
                      <option value="1080p">1080p</option>
                      <option value="720p">720p</option>
                      <option value="480p">480p</option>
                      <option value="360p">360p</option>
                      <option value="240p">240p</option>
                    </select>
                  </div>
                </div>

                {/* Speed */}
                <div className="py-2.5 border-b border-yt-border/40">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-yt-text flex-shrink-0">{t('settings_playback_speed')}</span>
                    <select
                      value={pbSettings.defaultSpeed}
                      onChange={(e) => updatePbSetting('defaultSpeed', parseFloat(e.target.value))}
                      className="bg-yt-secondary border border-yt-border text-yt-text text-sm rounded-lg px-2 py-1.5 focus:outline-none focus:border-yt-red cursor-pointer"
                    >
                      {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((s) => (
                        <option key={s} value={s}>{s === 1 ? '1× (normal)' : `${s}×`}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Volume */}
                <div className="py-2.5">
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-yt-text flex-shrink-0">{t('settings_playback_volume')}</span>
                    <input
                      type="range" min="0" max="1" step="0.05"
                      value={pbSettings.defaultVolume}
                      onChange={(e) => updatePbSetting('defaultVolume', parseFloat(e.target.value))}
                      className="flex-1 h-1.5 cursor-pointer accent-yt-red"
                    />
                    <span className="text-sm text-yt-text w-10 text-right tabular-nums">
                      {Math.round(pbSettings.defaultVolume * 100)}%
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* ── WIREPROXY ── */}
            {tab === 'wireproxy' && (
              <>
                <section>
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-xs font-semibold text-yt-text-muted uppercase tracking-widest">{t('settings_vpn')}</p>
                    {vpnConnected && <Shield className="w-3.5 h-3.5 text-green-400" />}
                  </div>
                  <p className="text-xs text-yt-text-muted mb-4 leading-relaxed">{t('settings_vpn_desc')}</p>

                  {/* Saved configs list */}
                  <div className="mb-4 space-y-1.5">
                    <p className="text-xs font-semibold text-yt-text-muted uppercase tracking-widest mb-2">{t('settings_vpn_saved_configs')}</p>
                    {savedConfigs.length === 0 && (
                      <p className="text-xs text-yt-text-muted px-1 mb-2">{t('settings_vpn_no_saved')}</p>
                    )}
                    {savedConfigs.map((name) => {
                      const isActive = vpn.conf_name === name
                      const isRunning = vpnConnected && isActive
                      return (
                        <div
                          key={name}
                          className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm transition-colors ${
                            isActive && isRunning
                              ? 'border-green-500 bg-green-500/10 text-yt-text'
                              : isActive
                              ? 'border-yt-border bg-yt-hover text-yt-text'
                              : 'border-yt-border/60 text-yt-text-secondary hover:bg-yt-hover hover:text-yt-text'
                          }`}
                        >
                          {isActive && <Check className={`w-3.5 h-3.5 flex-shrink-0 ${isRunning ? 'text-green-400' : 'text-yt-text-muted'}`} />}
                          <span className="flex-1 truncate font-mono text-xs">{name}</span>
                          {!isActive && (
                            <button
                              onClick={() => handleSelectConf(name)}
                              disabled={vpnConnected || vpnLoading}
                              className="text-xs px-2 py-0.5 rounded-lg bg-yt-secondary hover:bg-yt-hover border border-yt-border disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                              title={vpnConnected ? t('settings_vpn_switch_stop') : t('settings_vpn_select')}
                            >
                              {t('settings_vpn_select')}
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteConf(name)}
                            disabled={isRunning}
                            className="p-1 rounded-lg text-yt-text-muted hover:text-red-400 hover:bg-red-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            title={t('settings_vpn_delete')}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )
                    })}

                    <input ref={fileInputRef} type="file" accept=".conf" className="hidden" onChange={handleUploadConf} />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-yt-border/60 text-sm text-yt-text-secondary hover:bg-yt-hover hover:text-yt-text hover:border-yt-border transition-colors"
                    >
                      <Upload className="w-4 h-4 flex-shrink-0" />
                      <span>{t('settings_vpn_upload')}</span>
                    </button>
                  </div>

                  <div className="border-t border-yt-border/40 mb-4" />

                  {/* Status + toggle */}
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`flex items-center gap-1.5 text-xs font-medium flex-1 ${
                      vpnConnected ? 'text-green-400' : vpn.status === 'error' ? 'text-red-400' : 'text-yt-text-muted'
                    }`}>
                      {vpnBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : vpnConnected ? <Wifi className="w-3.5 h-3.5" />
                        : vpn.status === 'error' ? <AlertCircle className="w-3.5 h-3.5" />
                        : <WifiOff className="w-3.5 h-3.5" />}
                      <span>
                        {vpn.status === 'connecting' ? t('settings_vpn_starting')
                          : vpn.status === 'disconnecting' ? t('settings_vpn_stopping')
                          : vpnConnected ? t('settings_vpn_connected')
                          : vpn.status === 'error' ? t('settings_vpn_error')
                          : t('settings_vpn_disconnected')}
                      </span>
                    </div>
                    <button
                      onClick={handleVpnToggle}
                      disabled={vpnLoading || vpnBusy || (!vpn.conf_loaded && !vpnConnected)}
                      className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                        vpnConnected
                          ? 'bg-yt-hover border border-yt-border text-yt-text hover:border-red-400 hover:text-red-400'
                          : 'bg-yt-red hover:bg-yt-red-hover text-white'
                      }`}
                    >
                      {vpnConnected ? t('settings_vpn_disconnect') : t('settings_vpn_connect')}
                    </button>
                  </div>

                  {vpn.error && <p className="text-xs text-red-400 mb-3 px-1">{vpn.error}</p>}

                  {/* IP visible */}
                  <div className="pt-3 border-t border-yt-border/40">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-yt-text-muted uppercase tracking-widest">{t('settings_vpn_myip')}</p>
                      <button
                        onClick={fetchIpInfo}
                        disabled={ipLoading}
                        className="p-1 rounded-full hover:bg-yt-hover text-yt-text-muted hover:text-yt-text transition-colors disabled:opacity-40"
                        title={t('settings_vpn_myip_refresh')}
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${ipLoading ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                    {ipLoading ? (
                      <div className="flex items-center gap-2 text-xs text-yt-text-muted">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>...</span>
                      </div>
                    ) : ipInfo ? (
                      <div className={`flex items-start gap-2 text-xs rounded-xl px-3 py-2.5 ${vpnConnected ? 'bg-green-400/10 text-green-400' : 'bg-yt-secondary text-yt-text-secondary'}`}>
                        <MapPin className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                        <div>
                          <span className="font-mono font-semibold">{ipInfo.ip}</span>
                          {(ipInfo.city || ipInfo.country) && (
                            <span className="ml-1 opacity-80">— {[ipInfo.city, ipInfo.country].filter(Boolean).join(', ')}</span>
                          )}
                          {ipInfo.org && <div className="opacity-60 mt-0.5">{ipInfo.org}</div>}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-yt-text-muted">{t('settings_vpn_myip_error')}</p>
                    )}
                  </div>
                </section>
              </>
            )}

          </div>
        </div>
      </div>
    </div>
  )
}
